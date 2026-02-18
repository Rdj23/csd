import axios from "axios";
import { parseISO, format } from "date-fns";
import { DEVREV_API, HEADERS, fetchWithRetry } from "./devrevApi.js";
import { redisGet, redisSet, redisDelete, CACHE_TTL } from "../config/database.js";
import { AnalyticsTicket, AnalyticsCache, PrecomputedDashboard } from "../models/index.js";
import { resolveOwnerName, GST_NAME_MAP, GST_MEMBERS } from "../config/constants.js";
import { sendSlackAlerts, findGSTMember } from "./slackService.js";
import { publishSocketEvent } from "../lib/pubsub.js";

// BullMQ handles concurrency (concurrency: 1) so no in-process mutex needed.
// getSyncState kept for API server to check if a sync job is active via queue inspection.
export const getSyncState = () => ({ isSyncing: false, syncQueued: false });

export const fetchAndCacheTickets = async (source = "auto") => {
  console.log(`🔄 Syncing Active Tickets (source: ${source})...`);

  try {
    let collected = [],
      cursor = null,
      loop = 0,
      consecutiveInactiveBatches = 0;

    const SOLVED_CUTOFF_DATE = new Date("2026-01-01");

    const processTickets = (tickets) => {
      return tickets
        .filter((t) => {
          const stage = t.stage?.name?.toLowerCase() || "";
          const isActive = stage.includes("waiting on assignee") ||
                          stage.includes("awaiting customer reply") ||
                          stage.includes("waiting on clevertap") ||
                          stage.includes("on hold") ||
                          stage.includes("pending") ||
                          stage.includes("open");

          if (isActive) return true;

          const isSolved = stage.includes("solved") ||
                          stage.includes("closed") ||
                          stage.includes("resolved");

          if (isSolved) {
            const createdDate = t.created_date ? parseISO(t.created_date) : null;
            return createdDate && createdDate >= SOLVED_CUTOFF_DATE;
          }
          return false;
        })
        .filter((t) => {
          const ownerName = t.owned_by?.[0]?.display_name?.toLowerCase() || "";
          return !ownerName.includes("anmol sawhney");
        })
        .map((t) => ({
          id: t.id,
          display_id: t.display_id,
          title: t.title,
          priority: t.priority,
          severity: t.severity,
          account: t.account?.display_name || t.account,
          stage: t.stage,
          owned_by: t.owned_by,
          created_date: t.created_date,
          modified_date: t.modified_date,
          custom_fields: t.custom_fields,
          tags: t.tags,
          isZendesk: t.tags?.some((tag) => tag.tag?.name === "Zendesk import"),
          actual_close_date: t.actual_close_date,
        }));
    };

    const saveProgress = async (ticketsRaw, isComplete) => {
      const processed = processTickets(ticketsRaw);
      if (!processed.length) return processed;

      if (isComplete) {
        await redisSet("tickets:active", processed, CACHE_TTL.TICKETS);
        await redisDelete("tickets:syncing");
        await redisDelete("tickets:active:initial");
      } else {
        await redisSet("tickets:syncing", processed, 1800);
      }

      // Publish socket events via Redis Pub/Sub (Worker → API Server → clients)
      await publishSocketEvent("SYNC_PROGRESS", {
        type: "tickets",
        count: processed.length,
        progress: isComplete ? 100 : Math.min(90, 10 + Math.floor((loop / 100) * 80)),
        status: isComplete ? "complete" : "loading",
      });

      if (isComplete) {
        await publishSocketEvent("DATA_UPDATED", {
          type: "tickets",
          count: processed.length,
          timestamp: new Date().toISOString(),
        });
      }

      return processed;
    };

    do {
      let response;
      try {
        response = await fetchWithRetry(
          `${DEVREV_API}/works.list?limit=50&type=ticket${
            cursor ? `&cursor=${cursor}` : ""
          }`,
          { headers: HEADERS, timeout: 60000 },
        );
      } catch (batchErr) {
        console.warn(`⚠️ Batch ${loop} failed: ${batchErr.message}. Saving ${collected.length} tickets collected so far.`);
        if (collected.length > 0) {
          const saved = await saveProgress(collected, true);
          console.log(`✅ Partial sync saved: ${saved.length} tickets cached despite error`);
        }
        break;
      }

      const newWorks = response.data.works || [];
      if (!newWorks.length) break;

      const hasActiveTickets = newWorks.some((t) => {
        const stage = t.stage?.name?.toLowerCase() || "";
        return stage.includes("waiting on assignee") ||
               stage.includes("awaiting customer reply") ||
               stage.includes("waiting on clevertap") ||
               stage.includes("on hold") ||
               stage.includes("pending") ||
               stage.includes("open");
      });

      collected.push(...newWorks);

      if (loop < 3 || loop % 3 === 0) {
        await saveProgress(collected, false);
        console.log(`📦 Incrementally cached ${processTickets(collected).length} tickets (batch ${loop + 1})`);
      }

      if (!hasActiveTickets) {
        consecutiveInactiveBatches++;
        const lastDate = parseISO(newWorks[newWorks.length - 1].created_date);
        if (lastDate < SOLVED_CUTOFF_DATE && consecutiveInactiveBatches >= 10) {
          console.log(`⏹️ Early exit after ${consecutiveInactiveBatches} consecutive inactive batches`);
          break;
        }
      } else {
        consecutiveInactiveBatches = 0;
      }

      cursor = response.data.next_cursor;
      loop++;
    } while (cursor && loop < 100);

    if (collected.length > 0) {
      const activeTickets = await saveProgress(collected, true);

      const solvedCount = activeTickets.filter((t) => {
        const stage = t.stage?.name?.toLowerCase() || "";
        return stage.includes("solved") || stage.includes("closed");
      }).length;

      collected = null;
      if (global.gc) global.gc();
      console.log(
        `✅ ${activeTickets.length} tickets cached (${activeTickets.length - solvedCount} active, ${solvedCount} recently solved)`,
      );
      // Timeline enrichment is now handled by BullMQ chain (worker dispatches timeline:enrich-all)
    } else {
      console.warn("⚠️ Sync completed with 0 tickets collected");
    }
  } catch (e) {
    console.error("❌ Sync Failed:", e.message);
    throw e; // Let BullMQ handle retry
  }
};

export const syncHistoricalToDB = async (fullHistory = false) => {
  console.log("📦 Syncing to MongoDB...");
  let cursor = null,
    loop = 0,
    processedCount = 0,
    nocCount = 0,
    skippedCount = 0;
  const TARGET_DATE = new Date("2026-01-01");
  const NOC_CHECK_DATE = new Date("2026-01-01");
  const SLACK_ALERT_START_DATE = new Date("2026-01-25");

  const alertedTickets = await AnalyticsTicket.find(
    { slack_alerted_at: { $ne: null } },
    { ticket_id: 1 }
  ).lean();
  const alertedTicketIds = new Set(alertedTickets.map(t => t.ticket_id));
  const ticketsToAlert = [];

  // Delta sync: track consecutive batches where all tickets already exist in DB
  let consecutiveKnownBatches = 0;
  const KNOWN_THRESHOLD = 5;

  do {
    try {
      const res = await axios.get(
        `${DEVREV_API}/works.list?limit=50&type=ticket${cursor ? `&cursor=${cursor}` : ""}`,
        { headers: HEADERS },
      );
      const works = res.data.works || [];
      if (!works.length) break;
      if (
        new Date(works[works.length - 1].created_date) < TARGET_DATE &&
        !fullHistory
      )
        break;

      const solved = works.filter((t) => {
        const stage = t.stage?.name?.toLowerCase() || "";
        return (
          (stage.includes("solved") ||
            stage.includes("closed") ||
            stage.includes("resolved")) &&
          t.actual_close_date
        );
      });

      // Delta sync: check if all solved tickets in this batch already exist in DB
      if (solved.length > 0 && !fullHistory) {
        const batchTicketIds = solved.map(t => t.display_id);
        const existingCount = await AnalyticsTicket.countDocuments({
          ticket_id: { $in: batchTicketIds }
        });
        if (existingCount === batchTicketIds.length) {
          consecutiveKnownBatches++;
          if (consecutiveKnownBatches >= KNOWN_THRESHOLD) {
            console.log(`⏹️ Delta sync: ${KNOWN_THRESHOLD} consecutive fully-known batches, stopping early`);
            break;
          }
        } else {
          consecutiveKnownBatches = 0;
        }
      }

      if (solved.length) {
        const ops = [];

        for (const t of solved) {
          if (new Date(t.actual_close_date) < TARGET_DATE) {
            continue;
          }
          const ownerRaw = t.owned_by?.[0]?.display_name || "";
          const owner = resolveOwnerName(ownerRaw);
          if (!owner) {
            skippedCount++;
            continue;
          }

          const csatRaw = t.custom_fields?.tnt__csatrating;
          let csatVal = 0;
          if (csatRaw == 1 || csatRaw == "1") csatVal = 1;
          if (csatRaw == 2 || csatRaw == "2") csatVal = 2;

          let frrVal = 0;
          if (t.custom_fields?.tnt__frr === true) frrVal = 1;
          const iterations = t.custom_fields?.tnt__iteration_count;
          if (iterations === 1) frrVal = 1;

          let isNoc = false;
          let nocIssueId = null;
          let nocJiraKey = null;
          let nocRca = null;
          let nocReportedBy = null;
          let nocAssignee = null;
          let nocConfirmationBy = null;
          let hasL2NocConfirmation = false;
          let nocConfirmationIssId = null;

          const closedDate = new Date(t.actual_close_date);
          if (closedDate >= NOC_CHECK_DATE) {
            try {
              const linksRes = await axios.post(
                `${DEVREV_API}/links.list`,
                {
                  object: t.id,
                  object_types: ["issue"],
                  limit: 10,
                },
                { headers: HEADERS },
              );
              const links = linksRes.data.links || [];

              for (const link of links) {
                const issueId =
                  link.target?.display_id || link.source?.display_id;
                if (!issueId || !issueId.startsWith("ISS-")) continue;

                try {
                  const issRes = await axios.post(
                    `${DEVREV_API}/works.get`,
                    { id: issueId },
                    { headers: HEADERS },
                  );
                  const issue = issRes.data.work;

                  console.log(`   🔍 ${t.display_id} → ${issueId} | issuetype: ${issue?.custom_fields?.ctype__issuetype || 'N/A'} | team_involved: ${issue?.custom_fields?.ctype__team_involved || 'N/A'}`);

                  if (!isNoc && issue?.custom_fields?.ctype__issuetype === "PSN Task") {
                    isNoc = true;
                    nocIssueId = issue.display_id;
                    nocJiraKey = issue.custom_fields?.ctype__key || null;
                    nocRca =
                      issue.custom_fields?.ctype__customfield_10169 || null;
                    nocReportedBy =
                      issue.reported_by?.[0]?.display_name || null;
                    nocAssignee = issue.owned_by?.[0]?.display_name || null;
                    nocCount++;
                    console.log(
                      `   ✓ NOC: ${t.display_id} → ${nocIssueId}, Assignee: ${nocAssignee}, RCA: ${nocRca}`,
                    );
                  }

                  if (!hasL2NocConfirmation && issue?.custom_fields?.ctype__team_involved === "L2 NOC Confirmation") {
                    hasL2NocConfirmation = true;
                    nocConfirmationBy =
                      issue.owned_by?.[0]?.display_name ||
                      issue.modified_by?.display_name || null;
                    nocConfirmationIssId = issue.display_id;
                    console.log(
                      `   ✓ L2 NOC Confirmation: ${t.display_id} → ${nocConfirmationIssId}, By: ${nocConfirmationBy}`,
                    );
                  }

                  if (isNoc && hasL2NocConfirmation) break;
                } catch (e) {
                  console.log(`   ⚠️ ${t.display_id} → ${issueId} fetch error: ${e.message}`);
                }
              }
            } catch (e) {
              // Ignore links fetch errors
            }
          }

          const isReporterGST = nocReportedBy && findGSTMember(nocReportedBy);

          if (
            nocRca &&
            nocRca.toLowerCase().includes("understanding gap - cs") &&
            isReporterGST &&
            !alertedTicketIds.has(t.display_id) &&
            closedDate >= SLACK_ALERT_START_DATE
          ) {
            ticketsToAlert.push({
              ticket_id: t.display_id,
              noc_jira_key: nocJiraKey,
              noc_rca: nocRca,
              noc_reported_by: nocReportedBy,
              noc_assignee: nocAssignee,
              noc_confirmation_by: nocConfirmationBy,
              account_name:
                t.custom_fields?.tnt__instance_account_name ||
                t.account?.display_name ||
                "Unknown",
            });
          }

          ops.push({
            updateOne: {
              filter: { ticket_id: t.display_id },
              update: {
                $set: {
                  ticket_id: t.display_id,
                  display_id: t.display_id,
                  title: t.title,
                  created_date: new Date(t.created_date),
                  closed_date: new Date(t.actual_close_date),
                  owner,
                  region: t.custom_fields?.tnt__region_salesforce || "Unknown",
                  priority: t.priority,
                  is_zendesk: t.tags?.some(
                    (tag) => tag.tag?.name === "Zendesk import",
                  ),
                  is_noc: isNoc,
                  noc_issue_id: nocIssueId,
                  noc_jira_key: nocJiraKey,
                  noc_rca: nocRca,
                  noc_reported_by: nocReportedBy,
                  noc_assignee: nocAssignee,
                  noc_confirmation_by: nocConfirmationBy,
                  has_l2_noc_confirmation: hasL2NocConfirmation,
                  noc_confirmation_iss_id: nocConfirmationIssId,
                  rwt: t.custom_fields?.tnt__rwt_business_hours ?? null,
                  frt: t.custom_fields?.tnt__frt_hours ?? null,
                  iterations: iterations ?? null,
                  csat: csatVal,
                  frr: frrVal,
                  account_name:
                    t.custom_fields?.tnt__instance_account_name ||
                    t.account?.display_name ||
                    "Unknown",
                },
              },
              upsert: true,
            },
          });
        }

        if (ops.length > 0) {
          await AnalyticsTicket.bulkWrite(ops);
          processedCount += ops.length;
          console.log(
            `   📊 Batch done: ${processedCount} synced, ${nocCount} NOC, ${skippedCount} skipped`,
          );
        }
      }
      cursor = res.data.next_cursor;
      loop++;
    } catch (e) {
      console.error("Sync Error:", e.message);
      break;
    }
  } while (cursor && loop < 1000);

  if (ticketsToAlert.length > 0) {
    console.log(`📢 Sending Slack alerts for ${ticketsToAlert.length} Understanding Gap tickets...`);
    await sendSlackAlerts(ticketsToAlert);
  }

  await Promise.all([
    AnalyticsCache.deleteMany({}),
    PrecomputedDashboard.deleteMany({}),
    redisDelete("analytics:*"),
    redisDelete("livestats:*"),
    redisDelete("bydate:*"),
    redisDelete("tickets:*"),
  ]);
  console.log(
    `✅ SYNC COMPLETE: ${processedCount} GST tickets, ${nocCount} NOC tickets, ${skippedCount} non-GST skipped. Caches cleared.`,
  );
};

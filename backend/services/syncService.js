import axios from "axios";
import { parseISO, format } from "date-fns";
import { DEVREV_API, HEADERS, fetchWithRetry } from "./devrevApi.js";
import { redisGet, redisSet, redisDelete, redisHSetBatch, CACHE_TTL } from "../config/database.js";
import { AnalyticsTicket, AnalyticsCache, PrecomputedDashboard, ActivitySyncedTicket, Remark } from "../models/index.js";
import { resolveOwnerName, GST_NAME_MAP, GST_MEMBERS, BACKFILL_CUTOFF } from "../config/constants.js";
import { fetchTicketLinks, fetchWorkItem } from "./devrevApi.js";
import { sendSlackAlerts, findGSTMember } from "./slackService.js";
import { publishSocketEvent } from "../lib/pubsub.js";
import logger from "../config/logger.js";

// BullMQ handles concurrency (concurrency: 1) so no in-process mutex needed.
// getSyncState kept for API server to check if a sync job is active via queue inspection.
export const getSyncState = () => ({ isSyncing: false, syncQueued: false });

// ── Shared ticket filtering & trimming ──────────────────────────────────
// Extracted to avoid duplication between quickFetchTickets and fetchAndCacheTickets.
// Single source of truth for what constitutes a "relevant" ticket and which
// fields the frontend needs — change once, applied everywhere.

const SOLVED_CUTOFF_DATE = new Date("2026-01-01");

// ── Agent (AI) rollout date ──
// Tickets closed on/after this date may be handled by the AI agent. Before this
// date, "unassigned" was always a data hygiene problem and we skipped them; now
// it can also legitimately mean "agent solved it without a human owner".
const AGENT_START_DATE = new Date("2026-03-01");

/**
 * Classify how a ticket was resolved.
 * Returns { resolvedBy: "agent"|"engineer", finalOwner: string|null, agentResolved: bool }.
 *  - Agent Handled  = tnt__agent_resolved === true OR (no GST owner AND solved)
 *  - Engineer Handled = has a GST owner AND tnt__agent_resolved !== true
 * `finalOwner` is the value to persist in AnalyticsTicket.owner — for unassigned
 * agent tickets we use the literal "Unassigned" so it appears in member dropdowns.
 * Returns null finalOwner when the ticket should be SKIPPED entirely.
 */
export const classifyResolution = (ticket, closedDate, gstOwner) => {
  const agentResolved = ticket.custom_fields?.tnt__agent_resolved === true;

  if (gstOwner) {
    return {
      resolvedBy: agentResolved ? "agent" : "engineer",
      finalOwner: gstOwner,
      agentResolved,
    };
  }
  // No GST owner. Only keep if this is in the agent era — otherwise it's noise
  // (non-GST owners, dropped tickets) and we preserve the legacy skip behavior.
  if (closedDate >= AGENT_START_DATE) {
    return { resolvedBy: "agent", finalOwner: "Unassigned", agentResolved };
  }
  return { resolvedBy: null, finalOwner: null, agentResolved };
};

/** Reduce a raw DevRev ticket to only the fields the frontend renders. */
const trimTicket = (t) => {
  const cf = t.custom_fields || {};
  return {
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
    custom_fields: {
      tnt__csatrating: cf.tnt__csatrating,
      tnt__region_salesforce: cf.tnt__region_salesforce,
      tnt__instance_account_name: cf.tnt__instance_account_name,
      tnt__csm_email_id: cf.tnt__csm_email_id,
      tnt__csm: cf.tnt__csm,
      tnt__tam: cf.tnt__tam,
      tnt__rwt_business_hours: cf.tnt__rwt_business_hours,
      tnt__frt_hours: cf.tnt__frt_hours,
      tnt__iteration_count: cf.tnt__iteration_count,
      tnt__frr: cf.tnt__frr,
      tnt__customer_wait_time: cf.tnt__customer_wait_time,
      tnt__last_devu_message_ts: cf.tnt__last_devu_message_ts,
      tnt__last_revu_message_ts: cf.tnt__last_revu_message_ts,
      tnt__account_cohort_fy_25: cf.tnt__account_cohort_fy_25,
      // Agent (AI) handling — surfaced to the live cache so the dashboard
      // "Resolved By" filter can classify active tickets without a backend round-trip.
      tnt__agent_resolved: cf.tnt__agent_resolved === true,
      tnt__agent_response_count: cf.tnt__agent_response_count || 0,
    },
    tags: t.tags,
    sentiment: t.sentiment,
    isZendesk: t.tags?.some((tag) => tag.tag?.name === "Zendesk import"),
    actual_close_date: t.actual_close_date,
  };
};

/** Check if a ticket's stage is "active" (open/pending/waiting). */
const isActiveStage = (stage) =>
  stage.includes("waiting on assignee") ||
  stage.includes("awaiting customer reply") ||
  stage.includes("waiting on clevertap") ||
  stage.includes("on hold") ||
  stage.includes("pending") ||
  stage.includes("open");

/** Check if a ticket should be included in the dashboard cache. */
const isRelevantTicket = (t) => {
  const stage = t.stage?.name?.toLowerCase() || "";
  if (isActiveStage(stage)) return true;
  const isSolved = stage.includes("solved") || stage.includes("closed") || stage.includes("resolved");
  if (isSolved) {
    const createdDate = t.created_date ? parseISO(t.created_date) : null;
    return createdDate && createdDate >= SOLVED_CUTOFF_DATE;
  }
  return false;
};

/** Check if ticket is owned by a GST member (excludes non-GST owners). */
const isGSTOwned = (t) => {
  const ownerName = t.owned_by?.[0]?.display_name?.toLowerCase() || "";
  return !ownerName.includes("anmol sawhney");
};

/**
 * Quick fetch: grab the first page of tickets from DevRev and return
 * immediately. Designed for cold-start HTTP requests where we can't wait
 * for a full sync (which takes minutes and would time out on Render).
 */
export const quickFetchTickets = async () => {
  let collected = [];

  // Single page, no retries, short timeout — must finish well within
  // Render's ~30s HTTP timeout so the frontend gets a response.
  try {
    const response = await axios.get(
      `${DEVREV_API}/works.list?limit=50&type=ticket`,
      { headers: HEADERS, timeout: 10000 },
    );
    collected = response.data.works || [];
  } catch (err) {
    logger.warn({ err }, "quickFetchTickets failed");
  }

  return collected.filter(isRelevantTicket).filter(isGSTOwned).map(trimTicket);
};

export const fetchAndCacheTickets = async (source = "auto") => {
  logger.info({ source }, "Syncing Active Tickets");

  try {
    // Store only trimmed/processed tickets — raw API responses are discarded
    // immediately to keep memory usage bounded.
    // Uses shared trimTicket/isRelevantTicket/isGSTOwned extracted above.
    let processed = [],
      cursor = null,
      loop = 0,
      consecutiveInactiveBatches = 0;

    const saveProgress = async (isComplete) => {
      if (!processed.length) return processed;

      if (isComplete) {
        await redisSet("tickets:active", processed, CACHE_TTL.TICKETS);
        // Populate per-ticket Hash for O(1) lookups by display_id.
        // Used by activityService.getTicketOwner / getAccountCohort to avoid
        // parsing the entire ~20MB ticket array for a single ticket lookup.
        const hashEntries = processed.map((t) => [t.display_id, t]);
        await redisHSetBatch("tickets:active:hash", hashEntries, CACHE_TTL.TICKETS);
        await redisDelete("tickets:syncing");
        await redisDelete("tickets:active:initial");
      } else {
        await redisSet("tickets:syncing", processed, 1800);
      }

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
        logger.warn({ batch: loop, err: batchErr, collectedCount: processed.length }, "Batch failed, saving collected tickets");
        if (processed.length > 0) {
          await saveProgress(true);
          logger.info({ count: processed.length }, "Partial sync saved despite error");
        }
        break;
      }

      const newWorks = response.data.works || [];
      if (!newWorks.length) break;

      const hasActiveTickets = newWorks.some((t) => isActiveStage(t.stage?.name?.toLowerCase() || ""));

      // Filter and trim immediately — raw API objects are GC'd after this loop
      for (const t of newWorks) {
        if (isRelevantTicket(t) && isGSTOwned(t)) {
          processed.push(trimTicket(t));
        }
      }

      if (loop < 3 || loop % 3 === 0) {
        await saveProgress(false);
        logger.info({ count: processed.length, batch: loop + 1 }, "Incrementally cached tickets");
      }

      if (!hasActiveTickets) {
        consecutiveInactiveBatches++;
        const lastDate = parseISO(newWorks[newWorks.length - 1].created_date);
        if (lastDate < SOLVED_CUTOFF_DATE && consecutiveInactiveBatches >= 10) {
          logger.info({ consecutiveInactiveBatches }, "Early exit after consecutive inactive batches");
          break;
        }
      } else {
        consecutiveInactiveBatches = 0;
      }

      cursor = response.data.next_cursor;
      loop++;
    } while (cursor && loop < 100);

    if (processed.length > 0) {
      await saveProgress(true);

      const solvedCount = processed.filter((t) => {
        const stage = t.stage?.name?.toLowerCase() || "";
        return stage.includes("solved") || stage.includes("closed");
      }).length;

      if (global.gc) global.gc();
      logger.info({ total: processed.length, active: processed.length - solvedCount, recentlySolved: solvedCount }, "Tickets cached");
      return processed;
    } else {
      logger.warn("Sync completed with 0 tickets collected");
      return [];
    }
  } catch (e) {
    logger.error({ err: e }, "Sync Failed");
    throw e; // Let BullMQ handle retry
  }
};

export const syncHistoricalToDB = async (fullHistory = false) => {
  logger.info("Syncing to MongoDB");
  let cursor = null,
    loop = 0,
    processedCount = 0,
    nocCount = 0,
    skippedCount = 0;
  const TARGET_DATE = new Date("2026-01-01");
  const NOC_CHECK_DATE = new Date("2026-01-01");

  const alertedTickets = await AnalyticsTicket.find(
    { slack_alerted_at: { $ne: null } },
    { ticket_id: 1 }
  ).lean();
  const alertedTicketIds = new Set(alertedTickets.map(t => t.ticket_id));
  const ticketsToAlert = [];

  // Delta sync: track consecutive batches where all tickets already exist in DB
  let consecutiveKnownBatches = 0;
  const KNOWN_THRESHOLD = 5;
  // Collect active (non-solved) ticket display_ids seen during sync
  // so we can remove them from AnalyticsTicket if they were previously solved
  const activeTicketIds = [];

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
          stage.includes("solved") ||
          stage.includes("closed") ||
          stage.includes("resolved")
        );
      });

      // Track non-solved tickets — these may have been solved before and reopened
      const nonSolved = works.filter((t) => {
        const stage = t.stage?.name?.toLowerCase() || "";
        return !(stage.includes("solved") || stage.includes("closed") || stage.includes("resolved"));
      });
      nonSolved.forEach((t) => activeTicketIds.push(t.display_id));

      // Delta sync: check if all solved tickets in this batch already exist in DB
      if (solved.length > 0 && !fullHistory) {
        const batchTicketIds = solved.map(t => t.display_id);
        const existingCount = await AnalyticsTicket.countDocuments({
          ticket_id: { $in: batchTicketIds }
        });
        if (existingCount === batchTicketIds.length) {
          consecutiveKnownBatches++;
          if (consecutiveKnownBatches >= KNOWN_THRESHOLD) {
            logger.info({ threshold: KNOWN_THRESHOLD }, "Delta sync: consecutive fully-known batches, stopping early");
            break;
          }
        } else {
          consecutiveKnownBatches = 0;
        }
      }

      if (solved.length) {
        // ── Resolve NOC links in PARALLEL batches of 5 ──────────────
        // Previously, each ticket's links were resolved sequentially (N+1 problem).
        // With 50 solved tickets per page and 2-3 links each, that was ~150
        // sequential HTTP calls. Processing 5 tickets at a time cuts this by ~80%.
        const NOC_CONCURRENCY = 5;
        const ops = [];

        // Pre-filter tickets that are valid for processing.
        // classifyResolution handles three cases:
        //   1. GST-owned ticket → kept as engineer (or agent if tnt__agent_resolved=true)
        //   2. Unassigned + closed on/after AGENT_START_DATE → kept as agent ("Unassigned")
        //   3. Unassigned + before agent era → skipped (legacy hygiene behavior)
        const candidates = solved.map((t) => {
          const closeDateRaw = t.actual_close_date || t.modified_date || t.created_date;
          if (!closeDateRaw || new Date(closeDateRaw) < TARGET_DATE) return null;
          const closedDate = new Date(closeDateRaw);
          const gstOwner = resolveOwnerName(t.owned_by?.[0]?.display_name || "");
          const { resolvedBy, finalOwner, agentResolved } = classifyResolution(t, closedDate, gstOwner);
          if (!finalOwner) { skippedCount++; return null; }
          return { ticket: t, closedDate, owner: finalOwner, resolvedBy, agentResolved };
        }).filter(Boolean);

        // Process NOC resolution in parallel batches
        for (let ci = 0; ci < candidates.length; ci += NOC_CONCURRENCY) {
          const batch = candidates.slice(ci, ci + NOC_CONCURRENCY);
          const results = await Promise.allSettled(batch.map(async ({ ticket: t, closedDate, owner, resolvedBy, agentResolved }) => {
            let noc = { isNoc: false, nocIssueId: null, nocJiraKey: null, nocRca: null,
              nocReportedBy: null, nocAssignee: null, nocConfirmationBy: null,
              hasL2NocConfirmation: false, nocConfirmationIssId: null };

            // Resolve NOC links only for tickets closed after the check date
            if (closedDate >= NOC_CHECK_DATE) {
              try {
                // Uses devrevApi.fetchTicketLinks (DI — Item 12)
                const links = await fetchTicketLinks(t.id.match(/ticket\/(\d+)/)?.[1] || t.id);

                for (const link of links) {
                  const issueId = link.target?.display_id || link.source?.display_id;
                  if (!issueId || !issueId.startsWith("ISS-")) continue;
                  try {
                    // Uses devrevApi.fetchWorkItem (DI — Item 12)
                    const issue = await fetchWorkItem(issueId);
                    if (!issue) continue;

                    if (!noc.isNoc && issue.custom_fields?.ctype__issuetype === "PSN Task") {
                      noc.isNoc = true;
                      noc.nocIssueId = issue.display_id;
                      noc.nocJiraKey = issue.custom_fields?.ctype__key || null;
                      noc.nocRca = issue.custom_fields?.ctype__customfield_10169 || null;
                      noc.nocReportedBy = issue.reported_by?.[0]?.display_name || null;
                      noc.nocAssignee = issue.owned_by?.[0]?.display_name || null;
                      nocCount++;
                    }
                    if (!noc.hasL2NocConfirmation && issue.custom_fields?.ctype__team_involved === "L2 NOC Confirmation") {
                      noc.hasL2NocConfirmation = true;
                      noc.nocConfirmationBy = issue.owned_by?.[0]?.display_name || issue.modified_by?.display_name || null;
                      noc.nocConfirmationIssId = issue.display_id;
                    }
                    if (noc.isNoc && noc.hasL2NocConfirmation) break;
                  } catch (e) {
                    logger.warn({ ticketId: t.display_id, issueId, err: e.message }, "Issue fetch error");
                  }
                }
              } catch (_) { /* links fetch error — skip NOC for this ticket */ }
            }

            return { ticket: t, closedDate, owner, resolvedBy, agentResolved, noc };
          }));

          // Build upsert ops + alert candidates from settled results
          for (const result of results) {
            if (result.status !== "fulfilled") continue;
            const { ticket: t, closedDate, owner, resolvedBy, agentResolved, noc } = result.value;

            const csatRaw = t.custom_fields?.tnt__csatrating;
            let csatVal = 0;
            if (csatRaw == 1 || csatRaw == "1") csatVal = 1;
            if (csatRaw == 2 || csatRaw == "2") csatVal = 2;

            let frrVal = 0;
            if (t.custom_fields?.tnt__frr === true) frrVal = 1;
            const iterations = t.custom_fields?.tnt__iteration_count;
            if (iterations === 1) frrVal = 1;

            // Check if this ticket should trigger a Slack alert
            if (
              noc.nocRca &&
              noc.nocRca.toLowerCase().includes("understanding gap - cs") &&
              noc.nocReportedBy && findGSTMember(noc.nocReportedBy) &&
              !alertedTicketIds.has(t.display_id) &&
              closedDate >= BACKFILL_CUTOFF
            ) {
              ticketsToAlert.push({
                ticket_id: t.display_id,
                noc_jira_key: noc.nocJiraKey,
                noc_rca: noc.nocRca,
                noc_reported_by: noc.nocReportedBy,
                noc_assignee: noc.nocAssignee,
                noc_confirmation_by: noc.nocConfirmationBy,
                account_name: t.custom_fields?.tnt__instance_account_name || t.account?.display_name || "Unknown",
              });
            }

            // Agent resolution time = full ticket lifetime in hours.
            // We only populate this for agent-resolved tickets so engineer rows
            // don't get a noisy duplicate of (closed - created); engineer SLA
            // already lives in `rwt` / `frt`.
            const agentResolutionHours = resolvedBy === "agent" && t.created_date
              ? Math.max(0, (closedDate - new Date(t.created_date)) / 3600000)
              : null;

            ops.push({
              updateOne: {
                filter: { ticket_id: t.display_id },
                update: {
                  $set: {
                    ticket_id: t.display_id, devrev_id: t.id, display_id: t.display_id,
                    title: t.title, created_date: new Date(t.created_date), closed_date: closedDate,
                    owner, owner_id: t.owned_by?.[0]?.id || null,
                    account_cohort: t.custom_fields?.tnt__account_cohort_fy_25 || null,
                    region: t.custom_fields?.tnt__region_salesforce || "Unknown",
                    priority: t.priority,
                    is_zendesk: t.tags?.some((tag) => tag.tag?.name === "Zendesk import"),
                    is_noc: noc.isNoc, noc_issue_id: noc.nocIssueId,
                    noc_jira_key: noc.nocJiraKey, noc_rca: noc.nocRca,
                    noc_reported_by: noc.nocReportedBy, noc_assignee: noc.nocAssignee,
                    noc_confirmation_by: noc.nocConfirmationBy,
                    has_l2_noc_confirmation: noc.hasL2NocConfirmation,
                    noc_confirmation_iss_id: noc.nocConfirmationIssId,
                    rwt: t.custom_fields?.tnt__rwt_business_hours ?? null,
                    frt: t.custom_fields?.tnt__frt_hours ?? null,
                    iterations: iterations ?? null, csat: csatVal, frr: frrVal,
                    account_name: t.custom_fields?.tnt__instance_account_name || t.account?.display_name || "Unknown",
                    actual_close_date: t.actual_close_date ? new Date(t.actual_close_date) : null,
                    stage_name: t.stage?.name || null,
                    // Agent (AI) handling
                    agent_resolved: agentResolved,
                    agent_response_count: t.custom_fields?.tnt__agent_response_count || 0,
                    agent_resolution_hours: agentResolutionHours,
                    resolved_by: resolvedBy,
                  },
                },
                upsert: true,
              },
            });
          }
        }

        if (ops.length > 0) {
          await AnalyticsTicket.bulkWrite(ops);
          processedCount += ops.length;
          logger.info({ processedCount, nocCount, skippedCount }, "Batch done");

          // Clean up internal remarks for solved tickets — no longer needed
          const solvedTicketIds = solved.map((t) => t.display_id);
          if (solvedTicketIds.length > 0) {
            const deleted = await Remark.deleteMany({ ticketId: { $in: solvedTicketIds } });
            if (deleted.deletedCount > 0) {
              logger.info({ count: deleted.deletedCount, tickets: solvedTicketIds.length }, "Purged remarks for solved tickets");
            }
          }
        }
      }
      cursor = res.data.next_cursor;
      loop++;
    } catch (e) {
      logger.error({ err: e }, "Sync Error");
      break;
    }
  } while (cursor && loop < 1000);

  // ── Remove reopened tickets from solved database ──
  // Tickets seen as active (non-solved) during sync that still exist in
  // AnalyticsTicket were previously solved but have since been reopened.
  if (activeTicketIds.length > 0) {
    const reopened = await AnalyticsTicket.find(
      { ticket_id: { $in: activeTicketIds } },
      { ticket_id: 1 },
    ).lean();

    if (reopened.length > 0) {
      const ids = reopened.map((t) => t.ticket_id);
      await Promise.all([
        AnalyticsTicket.deleteMany({ ticket_id: { $in: ids } }),
        ActivitySyncedTicket.deleteMany({ ticket_display_id: { $in: ids } }),
      ]);
      logger.info({ count: ids.length, ticketIds: ids }, "Removed reopened tickets from solved database");
    }
  }

  if (ticketsToAlert.length > 0) {
    logger.info({ count: ticketsToAlert.length }, "Sending Slack alerts for Understanding Gap tickets");
    await sendSlackAlerts(ticketsToAlert);
  }

  // ── Ownership refresh for recently solved tickets (last 15 days) ──
  // Tickets solved recently may have had ownership changes after being stored.
  // Re-fetch current owner from DevRev and update if changed.
  try {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    const recentTickets = await AnalyticsTicket.find(
      { closed_date: { $gte: fifteenDaysAgo } },
      { ticket_id: 1, devrev_id: 1, owner: 1, owner_id: 1 },
    ).lean();

    if (recentTickets.length > 0) {
      logger.info({ count: recentTickets.length }, "Ownership refresh: checking recently solved tickets");
      let ownerUpdated = 0;

      // Process ownership checks in parallel batches of 5 (same pattern as NOC resolution).
      // Previously sequential: 200 tickets × 1 API call each = ~200 sequential calls.
      // Now: 200 / 5 = 40 batches with 5 concurrent calls each.
      const OWNERSHIP_CONCURRENCY = 5;
      for (let i = 0; i < recentTickets.length; i += OWNERSHIP_CONCURRENCY) {
        const batch = recentTickets.slice(i, i + OWNERSHIP_CONCURRENCY);
        const results = await Promise.allSettled(batch.map(async (ticket) => {
          const work = await fetchWorkItem(ticket.devrev_id);
          if (!work) return null;
          const currentOwnerRaw = work.owned_by?.[0]?.display_name || "";
          const currentOwnerId = work.owned_by?.[0]?.id || null;
          const currentOwner = resolveOwnerName(currentOwnerRaw);

          if (currentOwner && currentOwner !== ticket.owner) {
            await AnalyticsTicket.updateOne(
              { ticket_id: ticket.ticket_id },
              { $set: { owner: currentOwner, owner_id: currentOwnerId } },
            );
            logger.info(
              { ticket_id: ticket.ticket_id, oldOwner: ticket.owner, newOwner: currentOwner },
              "Ownership updated",
            );
            return true;
          }
          return false;
        }));

        for (const r of results) {
          if (r.status === "fulfilled" && r.value) ownerUpdated++;
          if (r.status === "rejected") {
            logger.warn({ err: r.reason?.message }, "Ownership refresh: ticket fetch failed");
          }
        }
      }

      if (ownerUpdated > 0) {
        logger.info({ ownerUpdated }, "Ownership refresh complete");
      }
    }
  } catch (e) {
    logger.error({ err: e }, "Ownership refresh failed");
  }

  await Promise.all([
    AnalyticsCache.deleteMany({}),
    PrecomputedDashboard.deleteMany({}),
    redisDelete("analytics:*"),
    redisDelete("livestats:*"),
    redisDelete("bydate:*"),
    redisDelete("tickets:*"),
  ]);
  logger.info({ processedCount, nocCount, skippedCount }, "SYNC COMPLETE. Caches cleared.");
};

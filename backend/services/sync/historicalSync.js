/**
 * sync/historicalSync — The nightly solved/closed backfill into Mongo.
 *
 * Extracted from the 988-line syncService.js; logic unchanged.
 * See sync/index.js for the data-flow overview.
 */

import axios from "axios";
import logger from "../../config/logger.js";
import { BACKFILL_CUTOFF, resolveOwnerName } from "../../config/constants.js";
import { redisDelete } from "../../lib/cache.js";
import { AnalyticsCache, AnalyticsTicket, PrecomputedDashboard, Remark } from "../../models/index.js";
import { DEVREV_API, HEADERS, classifyLinkedWorkTeam, dependencyCounterpart, fetchTicketLinks, fetchWorkItem } from "../devrevApi.js";
import { createPartContext, resolveWorkPartFields } from "../partsService.js";
import { findGSTMember, sendSlackAlerts } from "../slackService.js";
import { removeReopenedFromMongo } from "./devrevFetch.js";
import { classifyResolution } from "./ticketShape.js";

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

  // Parts View: load the part-hierarchy cache ONCE for this run so each ticket's
  // ancestry resolves cache-first (a links.list walk only for parts we've never seen).
  // This tags tickets with their product/part at the SAME time they sync to Mongo.
  let partCtx = null;
  try {
    partCtx = await createPartContext();
  } catch (e) {
    logger.warn({ err: e?.message }, "Parts context init failed — tickets will sync without part tags");
  }

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

      // Track non-solved tickets — these may have been solved before and reopened.
      // Collected BEFORE the delta-mode date break below: the break fires on the
      // batch that crosses TARGET_DATE, and discarding that batch's active
      // tickets used to make their reopens invisible to delta runs forever.
      const nonSolved = works.filter((t) => {
        const stage = t.stage?.name?.toLowerCase() || "";
        return !(stage.includes("solved") || stage.includes("closed") || stage.includes("resolved"));
      });
      nonSolved.forEach((t) => activeTicketIds.push(t.display_id));

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
        //   1. GST-owned ticket → kept as engineer (or agent only if tnt__agent_resolved=true AND tnt__support_engineer_handled=false)
        //   2. No GST owner + closed on/after AGENT_START_DATE + genuinely agent-resolved → kept as agent ("Unassigned")
        //   3. Anything else without a GST owner (non-GST humans, legacy unassigned) → skipped
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
            // hasDependency stays null when links were never resolved (pre-cutoff
            // close or links.list failure) so Mongo records "not checked", never a
            // false "no dependency".
            let dep = { hasDependency: null, issueIds: [], teams: [], assignees: [] };

            // Resolve links only for tickets closed after the check date.
            // ONE links.list walk feeds both NOC classification and the
            // persisted dependency fields (same logic as the live
            // /api/tickets/dependencies endpoint: dependencyCounterpart picks
            // linked issues/tickets/tasks/custom objects, works.get enriches).
            if (closedDate >= NOC_CHECK_DATE) {
              try {
                // Uses devrevApi.fetchTicketLinks (DI — Item 12)
                const links = await fetchTicketLinks(t.id.match(/ticket\/(\d+)/)?.[1] || t.id);

                const seenDeps = new Set();
                const counterparts = [];
                for (const link of links) {
                  const cp = dependencyCounterpart(link, t.display_id);
                  if (cp && !seenDeps.has(cp.display_id)) {
                    seenDeps.add(cp.display_id);
                    counterparts.push(cp);
                  }
                }
                dep.hasDependency = counterparts.length > 0;

                for (const snapshot of counterparts) {
                  let work = null;
                  // Custom objects aren't works — works.get fails on them, so
                  // they classify from the links.list snapshot alone.
                  if (/^(ISS|TKT|TASK)-/i.test(snapshot.display_id)) {
                    try {
                      // Uses devrevApi.fetchWorkItem (DI — Item 12)
                      work = await fetchWorkItem(snapshot.display_id);
                    } catch (e) {
                      logger.warn({ ticketId: t.display_id, issueId: snapshot.display_id, err: e.message }, "Issue fetch error");
                    }
                  }
                  const item = work || snapshot;

                  dep.issueIds.push(snapshot.display_id);
                  const team = classifyLinkedWorkTeam(work, snapshot);
                  if (team && !dep.teams.includes(team)) dep.teams.push(team);
                  const assignee = item.owned_by?.[0]?.display_name;
                  if (assignee && !dep.assignees.includes(assignee)) dep.assignees.push(assignee);

                  if (!noc.isNoc && item.custom_fields?.ctype__issuetype === "PSN Task") {
                    noc.isNoc = true;
                    noc.nocIssueId = item.display_id;
                    noc.nocJiraKey = item.custom_fields?.ctype__key || null;
                    noc.nocRca = item.custom_fields?.ctype__customfield_10169 || null;
                    noc.nocReportedBy = item.reported_by?.[0]?.display_name || null;
                    noc.nocAssignee = item.owned_by?.[0]?.display_name || null;
                    nocCount++;
                  }
                  if (!noc.hasL2NocConfirmation && item.custom_fields?.ctype__team_involved === "L2 NOC Confirmation") {
                    noc.hasL2NocConfirmation = true;
                    noc.nocConfirmationBy = item.owned_by?.[0]?.display_name || item.modified_by?.display_name || null;
                    noc.nocConfirmationIssId = item.display_id;
                  }
                }
              } catch (_) { /* links fetch error — skip NOC/dependency for this ticket */ }
            }

            return { ticket: t, closedDate, owner, resolvedBy, agentResolved, noc, dep };
          }));

          // Build upsert ops + alert candidates from settled results
          for (const result of results) {
            if (result.status !== "fulfilled") continue;
            const { ticket: t, closedDate, owner, resolvedBy, agentResolved, noc, dep } = result.value;

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

            // Parts View: resolve this ticket's product/part chain (cache-first) so the
            // upsert below tags it inline. Best-effort — if resolution fails the ticket
            // still syncs (just untagged), and the next daily run retries it.
            let partFields = { applies_to_part_id: t.applies_to_part?.id || null };
            if (partCtx) {
              try {
                const { _viaWorksGet, ...pf } = await resolveWorkPartFields(t, partCtx);
                partFields = pf;
              } catch { /* leave applies_to_part_id only */ }
            }

            ops.push({
              updateOne: {
                filter: { ticket_id: t.display_id },
                update: {
                  $set: {
                    ticket_id: t.display_id, devrev_id: t.id, display_id: t.display_id,
                    // Parts View: product_id / product_name / ancestry resolved above,
                    // written at the same time the ticket lands in Mongo.
                    ...partFields,
                    title: t.title, created_date: new Date(t.created_date), closed_date: closedDate,
                    subtype: t.subtype || null,  // Parts View classification (query/bug/feature)
                    owner, owner_id: t.owned_by?.[0]?.id || null,
                    account_cohort: t.custom_fields?.tnt__account_cohort_fy_25 || null,
                    region: t.custom_fields?.tnt__region_salesforce || "Unknown",
                    // DevRev tickets carry `severity` (low/medium/high/blocker), not
                    // `priority` — stored under the existing `priority` column that the
                    // Parts View filter chain already matches on.
                    priority: t.severity || null,
                    is_zendesk: t.tags?.some((tag) => tag.tag?.name === "Zendesk import"),
                    is_noc: noc.isNoc, noc_issue_id: noc.nocIssueId,
                    noc_jira_key: noc.nocJiraKey, noc_rca: noc.nocRca,
                    noc_reported_by: noc.nocReportedBy, noc_assignee: noc.nocAssignee,
                    noc_confirmation_by: noc.nocConfirmationBy,
                    has_l2_noc_confirmation: noc.hasL2NocConfirmation,
                    noc_confirmation_iss_id: noc.nocConfirmationIssId,
                    // Dependency fields — skipped (not nulled) when links were
                    // never resolved, so a transient links.list failure can't
                    // wipe a previous successful check.
                    ...(dep.hasDependency !== null && {
                      has_dependency: dep.hasDependency,
                      dependency_issue_ids: dep.issueIds,
                      dependency_teams: dep.teams,
                      dependency_assignees: dep.assignees,
                    }),
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
  // (The live sync also does this hourly with the complete active set —
  // this pass is the nightly belt to that hourly suspenders.)
  await removeReopenedFromMongo(activeTicketIds);

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
    // Separate keyspace from tickets:* — SCAN MATCH doesn't cross the prefix,
    // so without this line the All Tickets solved bucket can serve rows the
    // sync just deleted/changed until the TTL expires.
    redisDelete("alltickets:*"),
  ]);
  logger.info({ processedCount, nocCount, skippedCount }, "SYNC COMPLETE. Caches cleared.");
};

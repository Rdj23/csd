import axios from "axios";
import { parseISO, format } from "date-fns";
import { DEVREV_API, HEADERS, fetchWithRetry } from "./devrevApi.js";
import { redisGet, redisSet, redisSetRaw, redisDelete, redisHSetBatch, CACHE_TTL } from "../config/database.js";
import { AnalyticsTicket, AnalyticsCache, PrecomputedDashboard, ActivitySyncedTicket, Remark } from "../models/index.js";
import { resolveOwnerName, GST_NAME_MAP, GST_MEMBERS, BACKFILL_CUTOFF } from "../config/constants.js";
import { fetchTicketLinks, fetchWorkItem, dependencyCounterpart, classifyLinkedWorkTeam } from "./devrevApi.js";
import { createPartContext, resolveWorkPartFields } from "./partsService.js";
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
 *  - Agent Handled  = tnt__agent_resolved === true AND tnt__support_engineer_handled !== true
 *                     (also: no GST owner AND solved post-agent-rollout)
 *  - Engineer Handled = anything else with a GST owner (engineer touched it,
 *                       even if the agent flag is also set)
 * The AND-with-NOT-engineer rule prevents tickets that an engineer co-handled
 * from being miscounted as pure agent resolutions.
 */
export const classifyResolution = (ticket, closedDate, gstOwner) => {
  const cf = ticket.custom_fields || {};
  const agentFlag = cf.tnt__agent_resolved === true;
  const engineerHandled = cf.tnt__support_engineer_handled === true;
  const agentResolved = agentFlag && !engineerHandled;

  if (gstOwner) {
    return {
      resolvedBy: agentResolved ? "agent" : "engineer",
      finalOwner: gstOwner,
      agentResolved,
    };
  }
  // No GST owner. Keep only genuinely agent-resolved tickets (flag set AND no
  // engineer co-handling) in the agent era. A non-GST HUMAN owner (e.g. a
  // Solutions/CSM engineer) previously fell through here and was stored as
  // "Unassigned"/agent, inflating GST analytics with tickets GST never solved
  // (e.g. TKT-314228, solved by a non-roster engineer with
  // tnt__agent_resolved=false). Those are now skipped entirely.
  if (closedDate >= AGENT_START_DATE && agentResolved) {
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
    // Work subtype (query / bug / feature) — carried to the live cache so the Parts
    // View classification filter can scope active tickets without a backend round-trip.
    subtype: t.subtype || null,
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
      // Both flags are needed: a ticket counts as agent-handled only when
      // tnt__agent_resolved is true AND tnt__support_engineer_handled is false.
      tnt__agent_resolved: cf.tnt__agent_resolved === true,
      tnt__support_engineer_handled: cf.tnt__support_engineer_handled === true,
      tnt__agent_response_count: cf.tnt__agent_response_count || 0,
    },
    tags: t.tags,
    sentiment: t.sentiment,
    isZendesk: t.tags?.some((tag) => tag.tag?.name === "Zendesk import"),
    actual_close_date: t.actual_close_date,
    // Parts View: carry the part this ticket is filed under so the parts-sync /
    // active-parts refresh can resolve its ancestry from cache without a works.get.
    applies_to_part_id: t.applies_to_part?.id || null,
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

// Require a resolved GST owner before caching to Redis. Unassigned tickets
// (including agent-resolved ones with finalOwner="Unassigned") are excluded
// from tickets:active to keep the cache within the free-tier Valkey 25MB cap.
// They still flow into MongoDB via syncHistoricalToDB → classifyResolution,
// so analytics, the Resolved-By filter, and agent-handled metrics are intact.
const isGSTOwned = (t) => !!resolveOwnerName(t.owned_by?.[0]?.display_name);

// Bump VALKEY_CAP_MB when the Valkey plan is upgraded — currently 25MB free tier.
// Hash key roughly doubles total memory because tickets:active and
// tickets:active:hash hold the same data shaped differently, so headroom
// thresholds are intentionally conservative.
const VALKEY_CAP_MB = 25;
const CACHE_WARN_PCT = 0.7;
const CACHE_ALERT_PCT = 0.9;

// Takes the pre-stringified payload so the caller can reuse the SAME string
// for the Redis write — stringifying a multi-MB array twice was part of the
// hourly memory spike that OOM-killed the 512MB instance (2026-08-03).
const checkCacheSize = (ticketCount, json) => {
  const bytes = Buffer.byteLength(json);
  const mb = bytes / (1024 * 1024);
  const pctOfCap = mb / VALKEY_CAP_MB;
  const meta = {
    ticketCount,
    sizeMB: Number(mb.toFixed(2)),
    capMB: VALKEY_CAP_MB,
    pctOfCap: Number((pctOfCap * 100).toFixed(1)),
  };
  if (pctOfCap >= CACHE_ALERT_PCT) {
    logger.error(meta, "tickets:active near Valkey cap — OOM imminent, upgrade or tighten filters");
  } else if (pctOfCap >= CACHE_WARN_PCT) {
    logger.warn(meta, "tickets:active past 70% of Valkey cap — investigate before it hits the limit");
  } else {
    logger.info(meta, "tickets:active size snapshot");
  }
};

// ── Complete active-ticket fetch ─────────────────────────────────────────
// works.list supports server-side `state` filters: open + in_progress covers
// every non-closed stage (Waiting on Assignee / Awaiting Customer Reply /
// Waiting on CleverTap / New / queued / ...) REGARDLESS of ticket age.
// The old approach — scanning the org's whole newest-first stream and keeping
// actives — was capped at 100 pages (5,000 tickets), so any still-active
// ticket older than the window silently disappeared from the dashboard
// (e.g. TKT-308723: created Feb 11, still pending in Aug, beyond the cap).
// Verified 2026-08-01: ~2k non-closed tickets org-wide ≈ 20 pages.
const ACTIVE_STATES = ["open", "in_progress"];

/** Fetch ALL non-closed tickets from DevRev (raw, org-wide, no owner filter). */
export const fetchAllActiveFromDevRev = async () => {
  const collected = [];
  let cursor = null,
    loop = 0;
  do {
    const params = new URLSearchParams({ limit: "100", type: "ticket" });
    for (const s of ACTIVE_STATES) params.append("state", s);
    if (cursor) params.set("cursor", cursor);
    const response = await fetchWithRetry(
      `${DEVREV_API}/works.list?${params.toString()}`,
      { headers: HEADERS, timeout: 60000 },
    );
    collected.push(...(response.data.works || []));
    cursor = response.data.next_cursor;
    loop++;
  } while (cursor && loop < 200);
  return collected;
};

/**
 * Remove previously-solved rows for tickets that are active again (reopened).
 * Called from the live sync with the COMPLETE active set, so solved→open
 * transitions leave Mongo within the hour instead of waiting for (and
 * sometimes being missed by) the nightly historical sync. Idempotent — if a
 * ticket is re-solved later, the nightly sync upserts it back.
 */
export const removeReopenedFromMongo = async (activeTicketIds) => {
  if (!activeTicketIds.length) return 0;
  try {
    const reopened = await AnalyticsTicket.find(
      { ticket_id: { $in: activeTicketIds } },
      { ticket_id: 1 },
    ).lean();
    if (!reopened.length) return 0;

    const ids = reopened.map((t) => t.ticket_id);
    await Promise.all([
      AnalyticsTicket.deleteMany({ ticket_id: { $in: ids } }),
      ActivitySyncedTicket.deleteMany({ ticket_display_id: { $in: ids } }),
    ]);
    // Solved-side caches now hold rows that no longer exist — bust them all.
    // NOTE: "alltickets:*" is a separate keyspace from "tickets:*" (SCAN MATCH
    // does not glob across the prefix), it must be listed explicitly.
    await Promise.all([
      AnalyticsCache.deleteMany({}),
      PrecomputedDashboard.deleteMany({}),
      redisDelete("alltickets:*"),
      redisDelete("analytics:*"),
      redisDelete("livestats:*"),
      redisDelete("bydate:*"),
    ]);
    logger.info({ count: ids.length, ticketIds: ids }, "Removed reopened tickets from solved database");
    return ids.length;
  } catch (e) {
    logger.warn({ err: e }, "Reopened-ticket cleanup failed (non-fatal)");
    return 0;
  }
};

/**
 * Quick fetch: grab the first page of tickets from DevRev and return
 * immediately. Designed for cold-start HTTP requests where we can't wait
 * for a full sync (which takes minutes and would time out on Render).
 */
export const quickFetchTickets = async () => {
  let collected = [];

  // Single page so we always answer well within Render's ~30s HTTP timeout.
  // We DO retry transient connection resets: a freshly-woken hibernate pod often
  // reuses a stale keep-alive socket that DevRev already closed, surfacing as
  // ECONNRESET / "aborted" mid-response. One such reset would otherwise leave the
  // cold-start request with zero tickets. Resets fail fast, so a couple of quick
  // retries (fresh socket each time) stay well within budget. We do NOT retry
  // client-side timeouts (ECONNABORTED) — those would blow the time budget.
  // Accept-Encoding: gzip drops Brotli, whose CPU-heavy decompress is throttled
  // on a cold pod and was where the aborted stream surfaced.
  const TRANSIENT = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE"]);
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await axios.get(
        `${DEVREV_API}/works.list?limit=50&type=ticket`,
        { headers: { ...HEADERS, "Accept-Encoding": "gzip" }, timeout: 8000 },
      );
      collected = response.data.works || [];
      break;
    } catch (err) {
      const transient = TRANSIENT.has(err.code) || /aborted/i.test(err.message || "");
      if (attempt === MAX_ATTEMPTS || !transient) {
        logger.warn({ err, attempt }, "quickFetchTickets failed");
        break;
      }
      logger.warn({ code: err.code, msg: err.message, attempt }, "quickFetchTickets transient reset, retrying");
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
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
      loop = 0;

    const saveProgress = async (isComplete) => {
      if (!processed.length) return processed;

      if (isComplete) {
        // Stringify ONCE — reused for the size check and the Redis write,
        // then released before the hash write so at most one extra copy of
        // the blob is alive at any moment.
        let json = JSON.stringify(processed);
        checkCacheSize(processed.length, json);
        await redisSetRaw("tickets:active", json, CACHE_TTL.TICKETS);
        json = null;
        // Populate per-ticket Hash for O(1) lookups by display_id.
        // Used by activityService.getTicketOwner / getAccountCohort to avoid
        // parsing the entire ~20MB ticket array for a single ticket lookup.
        // Written in chunked pipelines (see redisHSetBatch) so the whole
        // blob is never re-buffered in memory.
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

    // ── Phase 1: COMPLETE active set (state-filtered, age-independent) ──
    // Guarantees every open / pending / on-hold ticket assigned to a GST
    // member is in the cache, no matter how old the ticket is.
    const activeIds = new Set();
    const droppedOwners = {};
    try {
      let rawActive = await fetchAllActiveFromDevRev();
      const activeTotal = rawActive.length;
      for (const t of rawActive) {
        activeIds.add(t.display_id);
        if (isGSTOwned(t)) {
          processed.push(trimTicket(t));
        } else {
          // Observability for the silent-drop gotcha: if a roster member's
          // DevRev display_name stops matching their aliases, their tickets
          // land here instead of vanishing without a trace.
          const name = t.owned_by?.[0]?.display_name || "(unowned)";
          droppedOwners[name] = (droppedOwners[name] || 0) + 1;
        }
      }
      // Drop the raw DevRev objects BEFORE the first cache write below —
      // otherwise the untrimmed set (several × the trimmed size) is still
      // retained while saveProgress stringifies the whole processed array.
      rawActive = null;
      logger.info(
        { activeTotal, gstActive: processed.length, droppedOwnerCount: Object.keys(droppedOwners).length },
        "Complete active set fetched",
      );
      if (Object.keys(droppedOwners).length > 0) {
        logger.info({ droppedOwners }, "Active tickets excluded (owner not in GST roster — add an alias in constants.js if one of these is a GST member)");
      }
      await saveProgress(false);
    } catch (activeErr) {
      logger.error({ err: activeErr }, "Complete active fetch failed — falling back to stream scan only");
    }

    // Reopened tickets: anything currently active that still has a solved row
    // in Mongo was solved and reopened — remove it from the solved database.
    // Only when the active fetch succeeded (otherwise activeIds is partial).
    if (activeIds.size > 0) {
      await removeReopenedFromMongo([...activeIds]);
    }

    // ── Phase 2: recently-solved scan (newest-first stream) ──
    // The active cache also carries solved tickets created on/after
    // SOLVED_CUTOFF_DATE (live-stats / Resolved-By classification read them).
    // works.list streams newest-first by created_date, so once a page's last
    // ticket predates the cutoff no further page can contain a relevant
    // solved ticket and we stop. Active tickets are already covered by
    // phase 1 — dedupe via activeIds.
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

      // Filter and trim immediately — raw API objects are GC'd after this loop
      for (const t of newWorks) {
        if (!activeIds.has(t.display_id) && isRelevantTicket(t) && isGSTOwned(t)) {
          processed.push(trimTicket(t));
        }
      }

      if (loop < 3 || loop % 3 === 0) {
        await saveProgress(false);
        logger.info({ count: processed.length, batch: loop + 1 }, "Incrementally cached tickets");
      }

      const lastDate = parseISO(newWorks[newWorks.length - 1].created_date);
      if (lastDate < SOLVED_CUTOFF_DATE) {
        logger.info({ batch: loop + 1 }, "Early exit: stream is past the solved cutoff date");
        break;
      }

      cursor = response.data.next_cursor;
      loop++;
    } while (cursor && loop < 200);

    if (processed.length > 0) {
      await saveProgress(true);

      const solvedCount = processed.filter((t) => {
        const stage = t.stage?.name?.toLowerCase() || "";
        return stage.includes("solved") || stage.includes("closed");
      }).length;

      if (global.gc) global.gc();
      logger.info({ total: processed.length, active: processed.length - solvedCount, recentlySolved: solvedCount }, "Tickets cached");

      // NOTE: Parts View no longer maintains a live active-ticket snapshot — it reads
      // cold data (solved tickets in analyticstickets) only. Part tagging for those
      // happens inline in the historical sync, so nothing to refresh here.

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

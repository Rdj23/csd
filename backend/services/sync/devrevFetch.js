/**
 * sync/devrevFetch — Pulling active tickets out of DevRev (streaming, paged, no page cap).
 *
 * Extracted from the 988-line syncService.js; logic unchanged.
 * See sync/index.js for the data-flow overview.
 */

import axios from "axios";
import logger from "../../config/logger.js";
import { redisDelete } from "../../lib/cache.js";
import { ActivitySyncedTicket, AnalyticsCache, AnalyticsTicket, PrecomputedDashboard } from "../../models/index.js";
import { DEVREV_API, HEADERS, fetchWithRetry } from "../devrevApi.js";
import { isGSTOwned, isRelevantTicket, trimTicket } from "./ticketShape.js";

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

/**
 * Stream ALL non-closed tickets from DevRev one page (≤100 raw tickets) at a
 * time. `onPage(works)` is awaited per page and the raw page is discarded
 * right after — callers keep only what they need, so the complete raw set
 * (untrimmed DevRev objects, several × the cache size when parsed) is never
 * resident in memory. This matters: the process is API + all workers in
 * 512MB, and holding the whole raw set was a core OOM driver (2026-08-03).
 * Returns the total number of tickets streamed.
 */
export const streamActiveFromDevRev = async (onPage) => {
  let cursor = null,
    loop = 0,
    total = 0;
  do {
    const params = new URLSearchParams({ limit: "100", type: "ticket" });
    for (const s of ACTIVE_STATES) params.append("state", s);
    if (cursor) params.set("cursor", cursor);
    const response = await fetchWithRetry(
      `${DEVREV_API}/works.list?${params.toString()}`,
      { headers: HEADERS, timeout: 60000 },
    );
    const works = response.data.works || [];
    total += works.length;
    await onPage(works);
    cursor = response.data.next_cursor;
    loop++;
  } while (cursor && loop < 200);
  return total;
};

/**
 * Fetch ALL non-closed tickets from DevRev (raw, org-wide, no owner filter).
 * @deprecated Accumulates every raw page in memory — use streamActiveFromDevRev
 * in server code. Kept for one-off scripts only.
 */
export const fetchAllActiveFromDevRev = async () => {
  const collected = [];
  await streamActiveFromDevRev((works) => {
    collected.push(...works);
  });
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

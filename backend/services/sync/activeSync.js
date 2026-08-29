/**
 * sync/activeSync — The live active-ticket sync: single-flight lock, cache write, socket delta.
 *
 * Extracted from the 988-line syncService.js; logic unchanged.
 * See sync/index.js for the data-flow overview.
 */

import logger from "../../config/logger.js";
import { CACHE_TTL, redisDelete, redisGetRaw, redisHSetBatch, redisLock, redisSet, redisSetRaw, redisUnlock } from "../../lib/cache.js";
import { publishSocketEvent } from "../../lib/pubsub.js";
import { createHash } from "crypto";
import { promisify } from "util";
import { gzip } from "zlib";
import { removeReopenedFromMongo, streamActiveFromDevRev } from "./devrevFetch.js";
import { DELTA_MAX_TICKETS, checkCacheSize, isGSTOwned, trimTicket } from "./ticketShape.js";

const gzipAsync = promisify(gzip);

// NOTE: an earlier version of this comment claimed "BullMQ handles concurrency
// (concurrency: 1) so no mutex is needed." That was wrong, and it is why the
// guard below had to be added after the 2026-08-08 OOM. concurrency: 1 is
// per-Worker — it serialises jobs WITHIN one queue and says nothing about the
// three other entry points into fetchAndCacheTickets (activity-sync's
// self-heal, the API process's cold-start/manual/startup paths, and BullMQ
// re-dispatching a stalled job). See ACTIVE_SYNC_LOCK_KEY below.
//
// getSyncState kept for API server to check if a sync job is active via queue inspection.
export const getSyncState = () => ({ isSyncing: false, syncQueued: false });

// ── Single-flight guard for the active-ticket sync ───────────────────────
// A full active sync holds ~8k trimmed tickets, a multi-MB JSON string, a
// per-ticket signature map and a gzip buffer — roughly 100MB of headroom on a
// 384MB heap. ONE is affordable; two overlapping runs are not.
//
// concurrency:1 does NOT give us this. It is per-Worker, and three independent
// paths call fetchAndCacheTickets:
//   - the ticket-sync worker (webhook + hourly cron)
//   - the activity-sync worker's tickets:active self-heal
//   - the API process (startup warm, cold-start /api/tickets, manual refresh)
// plus BullMQ re-dispatching a job whose lock lapsed because a blocked event
// loop starved the renewal timer. On 2026-08-08 all of these stacked up and
// OOM-killed the instance.
//
// The Redis lock makes the sync single-flight across every caller AND every
// process (API + worker dyno), so memory stays O(1) in the number of callers.
// TTL > the ~90s a full crawl takes, but short enough that a hard crash
// self-heals within a couple of minutes instead of wedging the sync forever.
const ACTIVE_SYNC_LOCK_KEY = "lock:tickets:active:sync";
const ACTIVE_SYNC_LOCK_TTL = 300;

/**
 * Public entry point — serialises callers, then delegates to the real sync.
 *
 * Returns `null` when a sync was already in flight. Callers must treat that as
 * "someone else is handling it", NOT as "zero tickets". Every caller either
 * re-reads tickets:active afterwards or ignores the return value entirely.
 */
export const fetchAndCacheTickets = async (source = "auto") => {
  const lockToken = await redisLock(ACTIVE_SYNC_LOCK_KEY, ACTIVE_SYNC_LOCK_TTL);
  if (!lockToken) {
    logger.warn({ source }, "Active ticket sync already in flight — skipping duplicate run");
    return null;
  }
  try {
    return await runActiveTicketSync(source);
  } finally {
    await redisUnlock(ACTIVE_SYNC_LOCK_KEY, lockToken);
  }
};

const runActiveTicketSync = async (source) => {
  logger.info({ source }, "Syncing Active Tickets");

  try {
    // Store only trimmed/processed tickets — raw API responses are discarded
    // immediately to keep memory usage bounded.
    // `cursor`/`loop` are gone with the phase-2 stream scan: the active fetch
    // paginates inside streamActiveFromDevRev and reports one partial save.
    let processed = [];

    const saveProgress = async (isComplete) => {
      if (!processed.length) return processed;

      let delta = null;
      let currentEtag = null;
      if (isComplete) {
        // Stringify ONCE — reused for the size check and the Redis write,
        // then released before the hash write so at most one extra copy of
        // the blob is alive at any moment.
        let json = JSON.stringify(processed);
        checkCacheSize(processed.length, json);
        // Content hash doubles as the HTTP ETag for GET /api/tickets —
        // clients send it back via If-None-Match and get a 304 (no multi-MB
        // body) when a sync produced an identical payload. Stored with the
        // same TTL so the pair expires together.
        const etag = `"${createHash("sha1").update(json).digest("hex")}"`;

        // ── Delta detection ──
        // Per-ticket signatures (~55 bytes each) let DATA_UPDATED tell every
        // connected browser exactly which tickets changed, instead of each one
        // re-downloading the full multi-MB snapshot after every sync. The
        // socket patch is the steady-state path; full downloads happen only on
        // cold start or when a client's etag chain breaks.
        const newSigs = {};
        const byDisplayId = new Map();
        for (const t of processed) {
          newSigs[t.display_id] = createHash("sha1").update(JSON.stringify(t)).digest("hex");
          byDisplayId.set(t.display_id, t);
        }
        const [prevEtag, prevSigsRaw] = await Promise.all([
          redisGetRaw("tickets:active:etag"),
          redisGetRaw("tickets:active:sig"),
        ]);
        if (prevEtag && prevSigsRaw && prevEtag !== etag) {
          try {
            const prevSigs = JSON.parse(prevSigsRaw);
            const changed = [];
            for (const [id, sig] of Object.entries(newSigs)) {
              if (prevSigs[id] !== sig) changed.push(byDisplayId.get(id));
            }
            const removed = Object.keys(prevSigs).filter((id) => !(id in newSigs));
            // Only ship deltas that are genuinely small — a huge diff (cache
            // rebuild, backfill) is cheaper as one compressed full download.
            if (changed.length + removed.length <= DELTA_MAX_TICKETS) {
              delta = { fromEtag: prevEtag, changed, removed };
            }
          } catch {
            // Corrupt sig map — clients fall back to a full refresh.
          }
        }

        await redisSetRaw("tickets:active", json, CACHE_TTL.ACTIVE_TICKETS);

        // ── Pre-compressed envelope ──
        // GET /api/tickets streams these exact bytes with Content-Encoding:
        // gzip — compressing once per sync instead of once per request keeps
        // the API event loop free at 50 concurrent users AND caps egress at
        // the best compression level (9) instead of the middleware default.
        let envelope = `{"success":true,"isPartial":false,"isSyncing":false,"tickets":${json}}`;
        json = null;
        const gzBase64 = (await gzipAsync(Buffer.from(envelope), { level: 9 })).toString("base64");
        envelope = null;
        logger.info(
          { gzMB: Number((gzBase64.length / 1048576).toFixed(2)), deltaSize: delta ? delta.changed.length + delta.removed.length : null },
          "tickets:active compressed snapshot written",
        );
        await redisSetRaw("tickets:active:gz", gzBase64, CACHE_TTL.ACTIVE_TICKETS);
        await redisSetRaw("tickets:active:sig", JSON.stringify(newSigs), CACHE_TTL.ACTIVE_TICKETS);
        // Etag LAST: a client must never cache a new etag against an old body.
        await redisSetRaw("tickets:active:etag", etag, CACHE_TTL.ACTIVE_TICKETS);
        currentEtag = etag;
        // Populate per-ticket Hash for O(1) lookups by display_id.
        // Used by activityService.getTicketOwner / getAccountCohort to avoid
        // parsing the entire ~20MB ticket array for a single ticket lookup.
        // Written in chunked pipelines (see redisHSetBatch) so the whole
        // blob is never re-buffered in memory.
        const hashEntries = processed.map((t) => [t.display_id, t]);
        await redisHSetBatch("tickets:active:hash", hashEntries, CACHE_TTL.ACTIVE_TICKETS);
        await redisDelete("tickets:syncing");
        await redisDelete("tickets:active:initial");
      } else {
        await redisSet("tickets:syncing", processed, 1800);
      }

      await publishSocketEvent("SYNC_PROGRESS", {
        type: "tickets",
        count: processed.length,
        // Was derived from the phase-2 page counter. With only the active
        // fetch left there is exactly one partial save — the moment the
        // complete active set has landed — so report a flat 80%.
        progress: isComplete ? 100 : 80,
        status: isComplete ? "complete" : "loading",
        // Presence of etag tells clients the follow-up DATA_UPDATED event
        // owns the refresh decision — prevents the old double-fetch (one on
        // "complete", one on DATA_UPDATED) that doubled egress per sync.
        ...(currentEtag ? { etag: currentEtag } : {}),
      });

      if (isComplete) {
        await publishSocketEvent("DATA_UPDATED", {
          type: "tickets",
          count: processed.length,
          timestamp: new Date().toISOString(),
          // Etag chain: clients holding fromEtag apply the small patch in
          // place; anyone else (cold start, missed events) does a full fetch.
          ...(currentEtag ? { toEtag: currentEtag } : {}),
          ...(delta ? { fromEtag: delta.fromEtag, changed: delta.changed, removed: delta.removed } : {}),
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
      // Streamed page-by-page: each raw page is trimmed immediately and
      // discarded, so peak memory is one page (~100 raw tickets), not the
      // whole untrimmed org-wide set.
      const activeTotal = await streamActiveFromDevRev(async (works) => {
        for (const t of works) {
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
      });
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

    // ── Phase 2 (recently-solved stream scan) — REMOVED 2026-08-09 ──
    //
    // What it did: walked works.list newest-first, up to 200 pages × 50, and
    // kept every GST-owned SOLVED ticket created since 2026-01-01, appending
    // them to the same cache blob as the active set.
    //
    // Why it existed: it dates to the very first commit, when Redis was the
    // ONLY store — there was no analyticstickets collection and no
    // /api/tickets/all-solved, so the cache had to carry solved tickets for
    // the dashboard to show them at all.
    //
    // Why it had to go:
    //  - Mongo superseded it. getAllSolvedForRange (added much later, to fix
    //    "Q1 shows zeros") is the real solved store, keyed on closed_date with
    //    no retention limit. Two sources of truth, one of them worse.
    //  - It never honoured its own cutoff. The loop capped at 200 pages and
    //    the logs show batch:199 EVERY run — it exited on the page cap, not
    //    the date. So the cache held "the most recent ~10k org tickets", an
    //    arbitrary line that moved every sync. Jan-1 coverage was never real.
    //  - It was ~200 of the sync's ~220 DevRev calls and essentially all of
    //    its ~60s runtime, to produce 7,515 of the 8,329 cached tickets —
    //    which the All Tickets view then explicitly discards in favour of the
    //    Mongo rows whenever a date range is set.
    //
    // The cache is now exactly what it says on the tin: the complete set of
    // active (open / pending / on-hold) GST tickets. Solved data is served
    // from Mongo. Freshness of the solved store is owned by the delta
    // historical sync, which is the purpose-built writer for it and now runs
    // every 4h instead of daily.

    if (processed.length > 0) {
      await saveProgress(true);

      if (global.gc) global.gc();
      logger.info({ total: processed.length }, "Active tickets cached");

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

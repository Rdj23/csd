/**
 * Sync — getting DevRev tickets into our two stores.
 *
 * TWO PIPELINES, TWO DESTINATIONS, DIFFERENT CADENCE:
 *
 *   ACTIVE      DevRev --> Redis        every webhook + hourly safety net
 *               Open / in-progress tickets. Volatile, read on every dashboard
 *               load, so it lives in Redis as one compressed blob plus a
 *               per-ticket hash. Writers are serialised by a Redis lock
 *               because there are four independent entry points into it.
 *
 *   HISTORICAL  DevRev --> MongoDB      nightly cron
 *               Solved / closed tickets. Permanent, powers analytics. Upserted
 *               by ticket_id, so re-running it is idempotent.
 *
 * ── WHERE THE CODE LIVES ────────────────────────────────────────────────
 * In dependency order; each module may only import from those above it.
 *
 *   ticketShape.js     The shared vocabulary BOTH pipelines use — which
 *                      stages count as active, who owns a ticket, how a
 *                      resolution is classified, how a ticket is trimmed
 *                      before caching, and the Valkey size guard.
 *   devrevFetch.js     Reading active tickets out of DevRev: the paged
 *                      stream, the full fetch, the quick fetch, and removing
 *                      reopened tickets from Mongo.
 *   activeSync.js      The Redis pipeline — single-flight lock, gzip, cache
 *                      write, socket delta broadcast.
 *   historicalSync.js  The Mongo pipeline — solved backfill and delta sync.
 *
 * If a ticket looks wrong in BOTH the live board and analytics, the bug is
 * most likely in ticketShape.js. If it is wrong in only one, look at that
 * pipeline's own module.
 */

// ── Public surface ───────────────────────────────────────────────────────
// Exactly the 9 symbols services/syncService.js used to export.

export { classifyResolution, trimTicket } from "./ticketShape.js";
export {
  streamActiveFromDevRev,
  fetchAllActiveFromDevRev,
  removeReopenedFromMongo,
  quickFetchTickets,
} from "./devrevFetch.js";
export { getSyncState, fetchAndCacheTickets } from "./activeSync.js";
export { syncHistoricalToDB } from "./historicalSync.js";

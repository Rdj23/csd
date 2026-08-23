/**
 * workers.js — BullMQ Workers that PROCESS jobs from the queues.
 *
 * ANALOGY:
 * If queues.js creates the "order tickets" (jobs on the kitchen rail),
 * this file creates the "cooks" (workers) that pick up those tickets
 * and actually DO the work.
 *
 * HOW BullMQ WORKERS WORK:
 * 1. A Worker subscribes to a specific queue by name (e.g., "ticket-sync")
 * 2. It polls Redis for new jobs in that queue
 * 3. When a job is found, it calls the processor function you provide
 * 4. If the function resolves → job is marked "completed"
 * 5. If the function throws → job is marked "failed" and retried per queue config
 *
 * WHY ALL WORKERS HAVE concurrency: 1:
 * Each worker processes ONE job at a time. This prevents:
 * - Two ticket syncs running simultaneously (would duplicate API calls)
 * - Two analytics precomputes fighting over the same DB collections
 * - Overwhelming the DevRev API with parallel requests
 * Think of it as a single-lane road — orderly, predictable, no collisions.
 *
 * DATA FLOW:
 *   Redis queue → Worker polls → picks up job → calls service function
 *   → service talks to DevRev API / MongoDB → writes results
 *   → worker marks job complete → publishes event via PubSub (if needed)
 */

import { Worker, UnrecoverableError } from "bullmq";
import { admitHeavyJob } from "./memoryGuard.js";
import { fetchAndCacheTickets, syncHistoricalToDB } from "../services/syncService.js";
import { reconcileActiveCounts } from "../services/reconcileService.js";
import { precomputeAnalytics } from "../services/analyticsService.js";
import { syncRoster } from "../services/rosterService.js";
import { syncActivityBatch } from "../services/activityService.js";
import { runPartsSync } from "../services/partsService.js";
import { runAttentionSweep } from "../services/attentionService.js";
import { runCsmTamAlertSweep } from "../services/csmTamAlertService.js";
import { publishRosterUpdated } from "./pubsub.js";
import logger from "../config/logger.js";
import { getCurrentQuarterKey } from "../config/constants.js";

/**
 * Error names that mean "the code is wrong", not "the world was uncooperative".
 * A retry cannot fix any of these — the same input hits the same broken line.
 */
const CODE_DEFECT_ERRORS = new Set(["ReferenceError", "TypeError", "SyntaxError", "RangeError"]);

const isCodeDefect = (err) => {
  if (!err || !CODE_DEFECT_ERRORS.has(err.name)) return false;
  // Network stacks muddy the signal: undici surfaces connection failures as a
  // TypeError carrying a `cause`, and HTTP clients attach `code`/`response`.
  // Those are operational and SHOULD be retried — only bare defects qualify.
  if (err.cause || err.code || err.response) return false;
  return true;
};

/**
 * Wrap a job processor so a code defect fails ONCE instead of `attempts` times.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS:
 * On 2026-08-08 a missing import threw a ReferenceError at the very END of the
 * active-ticket sync — after the full ~8k-ticket DevRev crawl, before the cache
 * write. BullMQ dutifully retried it. `attempts: 3` therefore meant three full
 * crawls per trigger, each holding ~100MB at peak, for an error that could
 * never succeed. Multiply by two queues and the repeat schedule and the
 * instance ran out of memory.
 *
 * UnrecoverableError tells BullMQ to skip the remaining attempts and fail the
 * job immediately. Transient failures (DevRev 5xx, Mongo timeouts, Redis
 * blips) are untouched and still get their full retry budget — which is the
 * only thing retries were ever good for.
 */
const guardProcessor = (workerName, processor) => async (job) => {
  try {
    return await processor(job);
  } catch (err) {
    if (isCodeDefect(err)) {
      logger.fatal(
        { worker: workerName, jobName: job?.name, err },
        "Code defect in job — failing permanently without retry (fix the code, then redeploy)",
      );
      throw new UnrecoverableError(`${err.name}: ${err.message}`);
    }
    throw err;
  }
};

export const registerAllWorkers = (connection) => {
  /**
   * `connection` — Same Redis connection config used by queues.
   * Workers and Queues MUST point to the same Redis instance
   * so workers can find and pick up jobs from those queues.
   */
  const opts = { connection };

  // ─────────────────────────────────────────────────────────────────
  // WORKER 1: ticket-sync
  // ─────────────────────────────────────────────────────────────────
  /**
   * WHAT IT DOES: Fetches currently active/open tickets from DevRev API
   * and caches them in Redis for fast dashboard loading.
   *
   * WHEN IT RUNS: Every time a webhook triggers a ticket event,
   * OR when manually triggered from admin panel.
   *
   * WHY job.data.source:
   * The job payload contains { source: "webhook" | "cron" | "manual" }
   * so fetchAndCacheTickets can log WHERE the sync was triggered from.
   * Useful for debugging ("why did this sync happen at 3 AM?").
   *
   * lockDuration: 300000 (5 minutes):
   * A "lock" tells BullMQ "this worker is still working on this job".
   * If the worker doesn't finish within 5 minutes, BullMQ assumes it crashed
   * and gives the job to another worker. 5 min is generous for a ticket sync
   * that typically takes 10-30 seconds.
   */
  const ticketSyncWorker = new Worker(
    "ticket-sync",
    guardProcessor("ticket-sync", async (job) => {
      // "reconcile-counts" — daily per-member DevRev-vs-dashboard count check.
      // Shares this queue (concurrency 1) so it never races a running sync,
      // and any heal job it dispatches simply runs next in line.
      if (job.name === "reconcile-counts") {
        if (!admitHeavyJob("ticket-sync:reconcile-counts")) return;
        logger.info("[ticket-sync] Reconciling active counts vs DevRev");
        return await reconcileActiveCounts();
      }
      if (!admitHeavyJob("ticket-sync")) return;
      logger.info({ source: job.data.source }, "[ticket-sync] Processing");
      await fetchAndCacheTickets(job.data.source);
    }),
    /**
     * maxStalledCount: 0 — do NOT re-dispatch a job whose lock lapsed.
     *
     * A "stalled" job usually isn't dead, just event-loop-blocked (this sync
     * does a synchronous multi-MB JSON.stringify, 8k SHA-1 hashes and a
     * level-9 gzip, any of which can starve BullMQ's lock-renewal timer).
     * The default of 1 makes BullMQ hand the job to another worker while the
     * original is still running — two concurrent 100MB syncs, which is how
     * 2026-08-08 escalated. The Redis single-flight lock in syncService now
     * makes such a duplicate harmless, and this makes it not happen at all.
     *
     * Safe here specifically because this job is frequent and self-healing:
     * webhooks and the hourly cron re-trigger it within the hour. The daily
     * jobs keep the default, where a dropped run would mean a real data gap.
     */
    { ...opts, concurrency: 1, lockDuration: 300000, maxStalledCount: 0 },
  );

  // ─────────────────────────────────────────────────────────────────
  // WORKER 2: historical-sync
  // ─────────────────────────────────────────────────────────────────
  /**
   * WHAT IT DOES: Bulk-syncs ALL tickets (or recent changes) from DevRev
   * into MongoDB for analytics. This is the "heavy lifter" that populates
   * the AnalyticsTicket collection.
   *
   * TWO MODES:
   * - job.name === "full-sync" → syncHistoricalToDB(true)
   *   Fetches EVERYTHING. Used for initial setup or recovery.
   * - any other name → syncHistoricalToDB(false)
   *   Delta sync — only tickets modified since last sync cursor.
   *   This is the daily cron job path (runs at 9:30 AM IST).
   *
   * WHY global.gc():
   * Historical sync processes hundreds of tickets, creating many JS objects.
   * After processing, we hint to Node.js garbage collector to clean up memory.
   * global.gc() only works if Node is started with --expose-gc flag
   * (which our package.json "start" script does: "node --expose-gc server.js").
   * If --expose-gc isn't set, global.gc is undefined and the if() skips it.
   *
   * lockDuration: 600000 (10 minutes):
   * Historical sync can take several minutes for large ticket volumes.
   * 10-minute lock prevents BullMQ from thinking the worker crashed.
   */
  const historicalSyncWorker = new Worker(
    "historical-sync",
    guardProcessor("historical-sync", async (job) => {
      if (!admitHeavyJob("historical-sync")) return;
      logger.info({ jobName: job.name }, "[historical-sync] Processing");
      if (job.name === "full-sync") {
        await syncHistoricalToDB(true);
      } else {
        await syncHistoricalToDB(false);
      }
      if (global.gc) global.gc();
    }),
    { ...opts, concurrency: 1, lockDuration: 600000 },
  );

  // ─────────────────────────────────────────────────────────────────
  // WORKER 3: analytics
  // ─────────────────────────────────────────────────────────────────
  /**
   * WHAT IT DOES: Reads tickets from MongoDB and precomputes dashboard stats:
   * - Overall stats (total tickets, avg response time, CSAT, etc.)
   * - Trends over time (weekly/monthly)
   * - Leaderboard (who resolved the most tickets)
   * - Bad tickets (breached SLA, low CSAT)
   *
   * WHY PRECOMPUTE (not calculate on every dashboard load):
   * These aggregations scan thousands of tickets — doing it live on every
   * page load would make the dashboard slow (2-5 seconds). Precomputing
   * once and caching means dashboard loads in <200ms.
   *
   * job.data.quarter — Which quarter to compute (e.g., "Q1-2026").
   * Analytics are always scoped to a fiscal quarter.
   */
  const analyticsWorker = new Worker(
    "analytics",
    guardProcessor("analytics", async (job) => {
      if (!admitHeavyJob("analytics")) return;
      logger.info({ quarter: job.data.quarter }, "[analytics] Processing");
      await precomputeAnalytics(job.data.quarter);
      if (global.gc) global.gc();
    }),
    { ...opts, concurrency: 1, lockDuration: 300000 },
  );

  // ─────────────────────────────────────────────────────────────────
  // WORKER 4: roster
  // ─────────────────────────────────────────────────────────────────
  /**
   * WHAT IT DOES: Pulls team roster (who's on shift, who's on leave)
   * from a Google Sheet and caches it in Redis.
   *
   * WHY GOOGLE SHEETS (not a DB table):
   * The team leads manage the roster in Google Sheets — it's their tool
   * of choice. Instead of making them learn a new UI, we read their
   * existing spreadsheet. Less friction = higher adoption.
   *
   * WHY publishRosterUpdated():
   * After syncing the roster, we notify the API server (via Redis Pub/Sub)
   * which then pushes the update to all connected browsers via Socket.IO.
   * This way, if a team lead updates the roster sheet, everyone's dashboard
   * reflects it within the next sync cycle — no page refresh needed.
   */
  const rosterWorker = new Worker(
    "roster",
    guardProcessor("roster", async () => {
      logger.info("[roster] Syncing roster from Google Sheets");
      await syncRoster();
      await publishRosterUpdated();
    }),
    { ...opts, concurrency: 1, lockDuration: 120000 },
  );

  // ─────────────────────────────────────────────────────────────────
  // WORKER 5: activity-sync
  // ─────────────────────────────────────────────────────────────────
  /**
   * WHAT IT DOES: Syncs timeline entries (comments) from DevRev tickets
   * into UserActivityEntry and UserActivityDaily collections.
   * Powers the Activity Intelligence and Gamification features.
   *
   * THREE MODES (determined by job.name):
   *
   * 1. "backfill" → Full historical backfill
   *    Fetches ALL timeline entries for the quarter. Used for initial setup
   *    or when you need to recalculate all activity data from scratch.
   *    job.data.quarter tells it which quarter (defaults to current).
   *
   * 2. "frequent" → Every-10-minute catch-up
   *    Looks back 15 minutes (not 10) to create a 5-minute overlap buffer.
   *    WHY THE OVERLAP: If a comment was created at 10:09 and the last
   *    "frequent" job ran at 10:00, without overlap we'd miss it.
   *    The 15-min lookback ensures nothing falls through the cracks.
   *    Deduplication (by entry_id) prevents double-counting.
   *
   * 3. default (daily incremental)
   *    job.data.since contains a timestamp (24h ago). Syncs everything
   *    modified since then. The daily cron's "belt" to the frequent job's
   *    "suspenders".
   */
  const activitySyncWorker = new Worker(
    "activity-sync",
    guardProcessor("activity-sync", async (job) => {
      if (!admitHeavyJob("activity-sync")) return;
      logger.info({ jobName: job.name, data: job.data }, "[activity-sync] Processing");
      if (job.name === "backfill") {
        await syncActivityBatch({ fullBackfill: true, quarter: job.data.quarter || getCurrentQuarterKey() });
      } else if (job.name === "frequent") {
        await syncActivityBatch({ since: new Date(Date.now() - 15 * 60 * 1000).toISOString() });
      } else {
        await syncActivityBatch({ since: job.data.since });
      }
      if (global.gc) global.gc();
    }),
    { ...opts, concurrency: 1, lockDuration: 600000 },
  );

  // ─────────────────────────────────────────────────────────────────
  // WORKER 6: parts-sync
  // ─────────────────────────────────────────────────────────────────
  /**
   * WHAT IT DOES: Resolves each ticket's DevRev part ancestry and keeps the `parts`
   * hierarchy + per-ticket part tags fresh for the Parts View tab.
   *
   * job.data.maxTickets — cap per phase. Omit (daily cron) to process everything still
   * untagged; pass a small number (e.g. 100) for a validated batch before a full backfill.
   *
   * WHY IDEMPOTENT/RESUMABLE: each phase only touches tickets that are still untagged
   * (applies_to_part_id null, or ancestry empty), so a crashed/retried run simply
   * resumes where it left off — no double processing, no Slack alerts emitted.
   *
   * lockDuration: 600000 (10 min) — a full backfill walks many parts.
   */
  const partsSyncWorker = new Worker(
    "parts-sync",
    guardProcessor("parts-sync", async (job) => {
      if (!admitHeavyJob("parts-sync")) return;
      logger.info({ data: job.data }, "[parts-sync] Processing");
      const result = await runPartsSync({ maxTickets: job.data?.maxTickets ?? null });
      if (global.gc) global.gc();
      return result;
    }),
    { ...opts, concurrency: 1, lockDuration: 600000 },
  );

  // ─────────────────────────────────────────────────────────────────
  // WORKER 7: attention
  // ─────────────────────────────────────────────────────────────────
  /**
   * WHAT IT DOES: The Attention Queue sweep — builds per-member shift-end
   * queues of aging/silent tickets (from the Redis active cache + roster
   * API), posts them to Slack, and escalates uncleared queues to team leads.
   *
   * WHEN IT RUNS: Every 15 minutes (repeatable), plus manual runs from the
   * admin endpoint (POST /api/attention/run) which can pass
   * { force: true, member: "Nikita" } to build a queue outside the shift
   * window for testing.
   *
   * WHY IT'S SAFE TO RUN OFTEN: queue creation is idempotent (unique
   * member+shift_date index) and escalations are rate-limited to one per
   * hour per queue, so a 15-min cadence never double-posts.
   */
  const attentionWorker = new Worker(
    "attention",
    guardProcessor("attention", async (job) => {
      // "csm-tam-alerts" — daily (Mon–Fri 11:00 IST) stale-ticket DMs to each
      // account's CSM/TAM (see csmTamAlertService.js). Shares this queue so a
      // new Queue+Worker pair doesn't add Redis connections — the free-tier
      // Valkey allows 50 and the hybrid topology already holds ~24.
      if (job.name === "csm-tam-alerts") {
        logger.info({ data: job.data }, "[attention] CSM/TAM stale-ticket sweep starting");
        return await runCsmTamAlertSweep(job.data || {});
      }
      logger.info({ data: job.data }, "[attention] Sweep starting");
      return await runAttentionSweep(job.data || {});
    }),
    { ...opts, concurrency: 1, lockDuration: 300000 },
  );

  // ─────────────────────────────────────────────────────────────────
  // EVENT HANDLERS — Logging for all workers
  // ─────────────────────────────────────────────────────────────────
  /**
   * WHY ATTACH HANDLERS TO ALL WORKERS:
   * BullMQ workers emit events we should log for operational visibility.
   * - "completed" → confirms jobs finished (useful for monitoring)
   * - "failed" → alerts us to problems (job name + error details)
   * - "error" → worker-level errors (e.g., Redis disconnect)
   *
   * Without these handlers, failures would be silent — you'd only know
   * something broke when users complain the dashboard is stale.
   */
  const allWorkers = [ticketSyncWorker, historicalSyncWorker, analyticsWorker, rosterWorker, activitySyncWorker, partsSyncWorker, attentionWorker];

  allWorkers.forEach((w) => {
    w.on("completed", (job) => logger.info({ worker: w.name, jobName: job.name }, "Job completed"));
    w.on("failed", (job, err) => logger.error({ worker: w.name, jobName: job?.name, err }, "Job failed"));
    w.on("error", (err) => logger.error({ worker: w.name, err }, "Worker error"));
  });

  /**
   * WHY RETURN allWorkers:
   * The caller (server.js or worker.js) needs the worker instances
   * to gracefully shut them down during SIGTERM/SIGINT.
   * worker.close() stops polling for new jobs and waits for the current
   * job to finish — a clean shutdown without losing in-progress work.
   */
  return allWorkers;
};

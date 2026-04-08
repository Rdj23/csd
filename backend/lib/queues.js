/**
 * queues.js — Defines all BullMQ job queues for the application.
 *
 * WHAT IS BullMQ?
 * BullMQ is a job queue library that uses Redis as its storage backend.
 * Think of it as a "to-do list" that lives in Redis. You ADD jobs to the list,
 * and separate WORKERS pick them up and process them one at a time.
 *
 * WHY WE NEED QUEUES (instead of doing work immediately):
 * 1. RELIABILITY — If a job fails, BullMQ retries it automatically.
 *    Without a queue, a failed API call = lost data forever.
 * 2. RATE CONTROL — concurrency: 1 means only 1 job runs at a time per queue.
 *    This prevents us from hammering the DevRev API with 50 parallel requests.
 * 3. PERSISTENCE — Jobs are stored in Redis. If our server restarts,
 *    pending jobs aren't lost — they'll be picked up when the worker comes back.
 * 4. OBSERVABILITY — Bull Board UI at /api/admin/queues lets us see
 *    job status, failures, and retry history.
 *
 * WHY 5 SEPARATE QUEUES (not one big queue):
 * Each queue has different retry/backoff needs. A quick ticket sync failing
 * should retry in 5s. A heavy historical sync failing should wait 30s.
 * Separate queues also mean a stuck historical sync won't block ticket syncs.
 *
 * DATA FLOW:
 *   Controller/Cron → queue.add(jobName, data, options) → Redis stores the job
 *   → Worker picks up job → processes it → marks complete/failed
 */

import { Queue } from "bullmq";

/**
 * WHY MODULE-LEVEL VARIABLES (not a class or exported object):
 * These are singletons — there should be exactly ONE instance of each queue
 * per process. Module-level variables + getter functions ensure this.
 * We initialize them lazily via initQueues() because the Redis connection
 * isn't available at import time (it's set up in server.js first).
 */
let ticketSyncQueue, historicalSyncQueue, analyticsQueue, rosterQueue, activitySyncQueue;

export const initQueues = (connection) => {
  /**
   * `connection` is the Redis connection config object { host, port, password }.
   * All queues share the same Redis instance but use different key prefixes
   * (BullMQ automatically namespaces by queue name).
   */
  const opts = { connection };

  /**
   * ticket-sync — Handles real-time webhook-triggered ticket refreshes.
   *
   * WHY THESE SPECIFIC OPTIONS:
   * - attempts: 3 → DevRev API hiccups are usually transient; 3 tries is enough
   * - backoff exponential 5000ms → retry at 5s, 10s, 20s (doubles each time)
   *   This gives DevRev time to recover without hammering it
   * - removeOnComplete: 5 → Keep last 5 completed jobs for debugging in Bull Board
   *   (more would waste Redis memory for a frequent job)
   * - removeOnFail: 10 → Keep more failures than successes because failures
   *   need investigation; we want to see the error history
   */
  ticketSyncQueue = new Queue("ticket-sync", {
    ...opts,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 10 },
    },
  });

  /**
   * historical-sync — Full or delta sync of ALL tickets from DevRev.
   *
   * WHY DIFFERENT FROM ticket-sync:
   * - attempts: 4 (not 3) → This is a heavy operation that fetches hundreds
   *   of tickets. Network issues are more likely during a long-running sync.
   * - backoff: 30000ms (not 5000ms) → 30s, 60s, 120s, 240s between retries.
   *   This sync hits DevRev API hard, so we give it more breathing room.
   * - removeOnComplete: 3 (not 5) → Runs once daily, fewer jobs to keep.
   */
  historicalSyncQueue = new Queue("historical-sync", {
    ...opts,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 30000 },
      removeOnComplete: { count: 3 },
      removeOnFail: { count: 5 },
    },
  });

  /**
   * analytics — Precomputes dashboard stats, trends, leaderboard.
   *
   * WHY IT'S ITS OWN QUEUE:
   * Analytics crunching is CPU-heavy (aggregation pipelines on MongoDB).
   * If it shared a queue with ticket-sync, a long analytics job would
   * block real-time ticket updates. Separate queue = independent processing.
   *
   * - backoff: 15000ms → Moderate; analytics failures are usually
   *   MongoDB timeouts that resolve quickly
   */
  analyticsQueue = new Queue("analytics", {
    ...opts,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 15000 },
      removeOnComplete: { count: 3 },
      removeOnFail: { count: 5 },
    },
  });

  /**
   * roster — Syncs team roster from Google Sheets.
   *
   * WHY SEPARATE:
   * Google Sheets API has its own rate limits and auth (service account).
   * Failures here (Google API issues) are completely independent of
   * DevRev API issues. Isolating it means a Google outage doesn't
   * affect ticket syncing.
   *
   * - attempts: 3 → Google Sheets API is very reliable
   * - backoff: 10000ms → Moderate retry interval
   */
  rosterQueue = new Queue("roster", {
    ...opts,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 10000 },
      removeOnComplete: { count: 3 },
      removeOnFail: { count: 5 },
    },
  });

  /**
   * activity-sync — Syncs comment/timeline data for Activity Intelligence.
   *
   * WHY 30s BACKOFF (same as historical-sync):
   * Activity sync fetches timeline entries for potentially hundreds of tickets.
   * It's a bulk operation that calls DevRev API many times, so we give generous
   * retry intervals to avoid rate limiting.
   */
  activitySyncQueue = new Queue("activity-sync", {
    ...opts,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30000 },
      removeOnComplete: { count: 3 },
      removeOnFail: { count: 5 },
    },
  });
};

/**
 * GETTER FUNCTIONS — WHY NOT JUST EXPORT THE VARIABLES DIRECTLY?
 *
 * Because the variables are `let` and initialized LATER (in initQueues).
 * If we exported them directly at the top, other files would import `undefined`
 * since initQueues hasn't run yet at import time.
 *
 * Getter functions solve this: they're called at RUNTIME (after init),
 * not at IMPORT TIME. The function always returns the current value.
 *
 * This is a common pattern for lazily-initialized singletons in Node.js.
 */
export const getTicketSyncQueue = () => ticketSyncQueue;
export const getHistoricalSyncQueue = () => historicalSyncQueue;
export const getAnalyticsQueue = () => analyticsQueue;
export const getRosterQueue = () => rosterQueue;
export const getActivitySyncQueue = () => activitySyncQueue;

/**
 * getAllQueues — Returns a map of all initialized queues.
 *
 * WHY A MAP (not an array):
 * Bull Board UI needs queue instances keyed by name to display them.
 * Also used by admin endpoints to check queue health/stats.
 *
 * WHY THE IF CHECKS:
 * In minimal mode (no Redis), some queues may not be initialized.
 * We only include queues that actually exist to avoid null references.
 */
export const getAllQueues = () => {
  const map = {};
  if (ticketSyncQueue) map["ticket-sync"] = ticketSyncQueue;
  if (historicalSyncQueue) map["historical-sync"] = historicalSyncQueue;
  if (analyticsQueue) map["analytics"] = analyticsQueue;
  if (rosterQueue) map["roster"] = rosterQueue;
  if (activitySyncQueue) map["activity-sync"] = activitySyncQueue;
  return map;
};

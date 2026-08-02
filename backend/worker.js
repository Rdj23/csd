// Must be the first import — loads .env before any module reads process.env
import "./config/env.js";

import process from "process";
import { connectMongoDB, initRedis, getBullMQConnection } from "./config/database.js";
import { initPublisher } from "./lib/pubsub.js";
import { initQueues, getTicketSyncQueue, getHistoricalSyncQueue, getAnalyticsQueue, getRosterQueue, getActivitySyncQueue, getAttentionQueue } from "./lib/queues.js";
import { registerAllWorkers } from "./lib/workers.js";
import logger from "./config/logger.js";
import { getCurrentQuarterKey } from "./config/constants.js";

const start = async () => {
  logger.info("Starting Worker Process");

  // 1. Connect to databases
  await connectMongoDB();
  await initRedis();

  // 2. Get BullMQ Redis connection config
  const bullmqConn = getBullMQConnection();
  if (!bullmqConn) {
    logger.fatal("REDIS_URL is required for the Worker process. Exiting.");
    process.exit(1);
  }

  // 3. Initialize Pub/Sub publisher (for Socket.IO event forwarding)
  initPublisher(process.env.REDIS_URL);

  // 4. Initialize BullMQ queues
  initQueues(bullmqConn);

  // 5. Register all worker processors
  const workers = registerAllWorkers(bullmqConn);
  logger.info({ count: workers.length }, "Workers registered");

  // 6. Register repeatable/cron jobs
  // Historical sync: midnight IST (18:30 UTC)
  await getHistoricalSyncQueue().add(
    "delta-sync",
    {},
    { repeat: { pattern: "30 18 * * *" }, jobId: "daily-historical-sync" },
  );

  // Analytics precompute: 1AM IST (19:30 UTC) — uses current quarter dynamically
  await getAnalyticsQueue().add(
    "precompute",
    { quarter: getCurrentQuarterKey() },
    { repeat: { pattern: "30 19 * * *" }, jobId: "daily-analytics-precompute" },
  );

  // Activity sync — MUST be registered here too. When the app is deployed with a
  // dedicated worker (NODE_ROLE=api + this worker.js), server.js's cron block is
  // skipped (runWorkers=false there), so this file is the ONLY place that would
  // schedule activity ingestion. Omitting these previously meant the Activity
  // Intelligence tracker silently stopped updating in split deployments.
  // Patterns mirror server.js so the schedule is identical in both topologies.
  await getActivitySyncQueue().add(
    "incremental", {},
    { repeat: { pattern: "0 5 * * *" }, jobId: "daily-activity-sync" },  // 05:00 UTC = 10:30 AM IST
  );
  await getActivitySyncQueue().add(
    "frequent", {},
    { repeat: { pattern: "*/10 * * * *" }, jobId: "frequent-activity-sync" },  // Every 10 min catch-up
  );

  // Hourly active-ticket refresh — same safety net as server.js (see comment
  // there). Registered here too because in split deployments this file is the
  // only cron scheduler; without it, live states/dependencies rely solely on
  // webhooks and go stale whenever one is missed.
  await getTicketSyncQueue().add(
    "sync-active", { source: "cron" },
    { repeat: { pattern: "0 * * * *" }, jobId: "hourly-active-sync" },
  );

  // Daily count reconciliation — per-GST-member open/pending/on-hold counts
  // from DevRev vs the dashboard cache; Slack alert + auto-heal on mismatch.
  // Mirrors server.js so split deployments get the same check. 9:40 AM IST.
  await getTicketSyncQueue().add(
    "reconcile-counts", {},
    { repeat: { pattern: "10 4 * * *" }, jobId: "daily-count-reconcile" },
  );

  // Attention Queue sweep — mirrors server.js (see comment there). Every 15
  // min: builds shift-end queues + processes TL escalations. Idempotent.
  await getAttentionQueue().add(
    "sweep", {},
    { repeat: { pattern: "*/15 * * * *" }, jobId: "attention-sweep" },
  );

  // NOTE: Parts View part-tagging is NOT a separate cron — it now happens inline inside
  // the historical sync (each ticket is tagged with its product/part as it's written to
  // Mongo) and inside the active-ticket sync. The parts-sync queue/worker is kept only
  // for manual full-backfill triggers (e.g. via Bull Board): node scripts/backfillParts.js.

  logger.info("Repeatable cron jobs registered");

  // 7. Dispatch staggered startup jobs
  await getRosterQueue().add("sync-roster", {}, { jobId: `startup-roster-${Date.now()}` });

  setTimeout(async () => {
    await getTicketSyncQueue().add("sync-active", { source: "startup" }, { jobId: `startup-sync-${Date.now()}` });
    logger.info("Startup ticket sync dispatched");
  }, 5000);

  setTimeout(async () => {
    await getAnalyticsQueue().add("precompute", { quarter: getCurrentQuarterKey() }, { jobId: `startup-analytics-${Date.now()}` });
    logger.info(`Startup ${getCurrentQuarterKey()} precompute dispatched`);
  }, 90000);

  // 8. Graceful shutdown
  const shutdown = async () => {
    logger.info("Worker shutting down...");
    await Promise.all(workers.map((w) => w.close()));
    logger.info("All workers closed");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  logger.info("Worker process running");
};

start().catch((err) => {
  logger.fatal({ err }, "Worker failed to start");
  process.exit(1);
});

import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import process from "process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { connectMongoDB, initRedis, getBullMQConnection } from "./config/database.js";
import { initPublisher } from "./lib/pubsub.js";
import { initQueues, getTicketSyncQueue, getHistoricalSyncQueue, getAnalyticsQueue, getRosterQueue } from "./lib/queues.js";
import { registerAllWorkers } from "./lib/workers.js";
import logger from "./config/logger.js";

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

  // Analytics precompute: 1AM IST (19:30 UTC)
  await getAnalyticsQueue().add(
    "precompute",
    { quarter: "Q1_26" },
    { repeat: { pattern: "30 19 * * *" }, jobId: "daily-analytics-q1-26" },
  );

  logger.info("Repeatable cron jobs registered");

  // 7. Dispatch staggered startup jobs
  await getRosterQueue().add("sync-roster", {}, { jobId: `startup-roster-${Date.now()}` });

  setTimeout(async () => {
    await getTicketSyncQueue().add("sync-active", { source: "startup" }, { jobId: `startup-sync-${Date.now()}` });
    logger.info("Startup ticket sync dispatched");
  }, 5000);

  setTimeout(async () => {
    await getAnalyticsQueue().add("precompute", { quarter: "Q1_26" }, { jobId: `startup-analytics-q1-${Date.now()}` });
    logger.info("Startup Q1_26 precompute dispatched");
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

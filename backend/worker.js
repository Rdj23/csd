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

const start = async () => {
  console.log("🔧 Starting Worker Process...");

  // 1. Connect to databases
  await connectMongoDB();
  await initRedis();

  // 2. Get BullMQ Redis connection config
  const bullmqConn = getBullMQConnection();
  if (!bullmqConn) {
    console.error("❌ REDIS_URL is required for the Worker process. Exiting.");
    process.exit(1);
  }

  // 3. Initialize Pub/Sub publisher (for Socket.IO event forwarding)
  initPublisher(process.env.REDIS_URL);

  // 4. Initialize BullMQ queues
  initQueues(bullmqConn);

  // 5. Register all worker processors
  const workers = registerAllWorkers(bullmqConn);
  console.log(`✅ ${workers.length} workers registered`);

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

  console.log("📅 Repeatable cron jobs registered");

  // 7. Dispatch staggered startup jobs
  await getRosterQueue().add("sync-roster", {}, { jobId: `startup-roster-${Date.now()}` });

  setTimeout(async () => {
    await getTicketSyncQueue().add("sync-active", { source: "startup" }, { jobId: `startup-sync-${Date.now()}` });
    console.log("📦 Startup ticket sync dispatched");
  }, 5000);

  setTimeout(async () => {
    await getAnalyticsQueue().add("precompute", { quarter: "Q1_26" }, { jobId: `startup-analytics-q1-${Date.now()}` });
    console.log("📊 Startup Q1_26 precompute dispatched");
  }, 90000);

  // 8. Graceful shutdown
  const shutdown = async () => {
    console.log("🛑 Worker shutting down...");
    await Promise.all(workers.map((w) => w.close()));
    console.log("✅ All workers closed");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log("✅ Worker process running");
};

start().catch((err) => {
  console.error("❌ Worker failed to start:", err);
  process.exit(1);
});

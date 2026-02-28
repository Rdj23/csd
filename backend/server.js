// Must be the first import — loads .env before any module reads process.env
import "./config/env.js";

import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import process from "process";
import mongoose from "mongoose";
import logger from "./config/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Middleware ---
import {
  ALLOWED_ORIGINS,
  coopHeaders,
  corsMiddleware,
  helmetMiddleware,
  compressionMiddleware,
  jsonParser,
  urlencodedParser,
  readinessCheck,
  setServerReady,
} from "./middleware/server.js";
import { apiLimiter, authLimiter, verifyToken, requireAdmin } from "./middleware/auth.js";

const app = express();
// Trust Render's reverse proxy so express-rate-limit can read X-Forwarded-For
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
});


app.use(coopHeaders);
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(compressionMiddleware);
app.use(jsonParser);
app.use(urlencodedParser);
app.use(readinessCheck);

// --- Security layer ---
app.use("/api/auth", authLimiter);
app.use("/api", apiLimiter);
app.use("/api", verifyToken);
app.use("/api/admin", requireAdmin);

// --- Routes ---
import { mountRoutes } from "./routes/index.js";
mountRoutes(app);

// --- Database connections ---
import { connectMongoDB, initRedis, getBullMQConnection, getRedisUrl } from "./config/database.js";

connectMongoDB()
  .then(() => {
    setServerReady(true);
  })
  .catch((err) => {
    logger.error({ err }, "MongoDB startup connection failed");
    // Still mark as ready to allow health checks to work
    setServerReady(true);
  });

// Start Redis connection immediately (non-blocking)
initRedis();

// --- Determine run mode ---
// NODE_ROLE=api    → API only (needs separate worker service)
// NODE_ROLE=worker → Worker only (no HTTP server — use worker.js instead)
// unset / hybrid   → Both API + Workers in one process (default, no extra cost)
const NODE_ROLE = process.env.NODE_ROLE || "hybrid";
const isHybrid = NODE_ROLE === "hybrid";
const runWorkers = NODE_ROLE === "worker" || isHybrid;

// --- BullMQ Setup ---
import { initQueues, getTicketSyncQueue, getHistoricalSyncQueue, getAnalyticsQueue, getRosterQueue, getActivitySyncQueue } from "./lib/queues.js";

const bullmqConn = getBullMQConnection();
if (bullmqConn) {
  initQueues(bullmqConn);
  logger.info({ mode: NODE_ROLE }, "BullMQ queues initialized");
} else {
  logger.warn("No REDIS_URL — BullMQ queues not available");
}

// --- Bull Board (Admin monitoring UI) ---
import { setupBullBoard } from "./lib/bullboard.js";
if (bullmqConn) {
  setupBullBoard(app, requireAdmin);
}

// --- Worker processors + Pub/Sub ---
import { registerAllWorkers } from "./lib/workers.js";
import { initPublisher, initSubscriber } from "./lib/pubsub.js";
import { fetchAndCacheTickets } from "./services/syncService.js";
import { loadRosterFromRedis } from "./services/rosterService.js";
import { AnalyticsTicket } from "./models/index.js";

let workerInstances = [];
const redisUrl = getRedisUrl();

if (runWorkers && bullmqConn && redisUrl) {
  initPublisher(redisUrl);
  workerInstances = registerAllWorkers(bullmqConn);
  logger.info({ count: workerInstances.length, mode: NODE_ROLE }, "Workers registered");
}

if (redisUrl) {
  initSubscriber(redisUrl, io, () => {
    loadRosterFromRedis().catch((e) => logger.warn({ err: e }, "Roster reload failed"));
  });
}

// --- Start server ---
const PORT = process.env.PORT || 5000;

server.listen(PORT, async () => {
  logger.info({ port: PORT, mode: NODE_ROLE }, "Server started");

  // Non-blocking: count tickets in background
  AnalyticsTicket.countDocuments().then((count) => {
    if (count) {
      logger.info({ count }, "Tickets in MongoDB");
    } else {
      logger.warn("MongoDB empty - run /api/admin/backfill");
    }
  });

  // Startup ticket sync — try BullMQ, fall back to direct call
  try {
    const { redisGet } = await import("./config/database.js");
    const cached = await redisGet("tickets:active");
    if (!cached || cached.length === 0) {
      const ticketSyncQueue = getTicketSyncQueue();
      if (ticketSyncQueue) {
        try {
          await ticketSyncQueue.add("sync-active", { source: "startup" }, { jobId: `startup-${Date.now()}` });
          logger.info("Dispatched startup ticket sync job");
        } catch {
          logger.warn("BullMQ unavailable, running startup sync directly");
          fetchAndCacheTickets("startup").catch((e) => logger.error({ err: e }, "Direct startup sync failed"));
        }
      } else {
        logger.info("No queues, running startup sync directly");
        fetchAndCacheTickets("startup").catch((e) => logger.error({ err: e }, "Direct startup sync failed"));
      }
    }
  } catch {
    // Redis completely down — run direct sync
    logger.warn("Redis down, running startup sync directly");
    fetchAndCacheTickets("startup").catch((e) => logger.error({ err: e }, "Direct startup sync failed"));
  }

  // Load roster data from Redis (populated by worker's syncRoster)
  // If Redis cache is empty/expired, dispatch a sync job to fetch from Google Sheets
  loadRosterFromRedis()
    .then((loaded) => {
      if (loaded) return;
      logger.warn("No roster data in Redis, dispatching sync job");
      const rosterQueue = getRosterQueue();
      if (rosterQueue) {
        rosterQueue.add("sync-roster", {}, { jobId: `startup-roster-${Date.now()}` })
          .then(() => logger.info("Startup roster sync dispatched"))
          .catch((e) => logger.error({ err: e }, "Failed to dispatch roster sync"));
      }
    })
    .catch((e) => logger.warn({ err: e }, "Roster load failed"));

  // Register cron jobs if running workers and BullMQ is available
  if (runWorkers && bullmqConn) {
    try {
      // Clean up old repeatable schedules before registering new ones
      for (const queue of [getHistoricalSyncQueue(), getAnalyticsQueue(), getActivitySyncQueue()]) {
        const repeatables = await queue.getRepeatableJobs();
        for (const job of repeatables) {
          await queue.removeRepeatableByKey(job.key);
          logger.info({ key: job.key }, "Removed old repeatable job");
        }
      }

      await getHistoricalSyncQueue().add(
        "delta-sync", {},
        { repeat: { pattern: "0 4 * * *" }, jobId: "daily-historical-sync" },  // 04:00 UTC = 9:30 AM IST (during keep-alive window)
      );
      await getAnalyticsQueue().add(
        "precompute", { quarter: "Q1_26" },
        { repeat: { pattern: "30 4 * * *" }, jobId: "daily-analytics-q1-26" },  // 04:30 UTC = 10:00 AM IST (runs after sync)
      );
      await getActivitySyncQueue().add(
        "incremental", {},
        { repeat: { pattern: "0 5 * * *" }, jobId: "daily-activity-sync" },  // 05:00 UTC = 10:30 AM IST (runs after analytics)
      );
      logger.info("Cron jobs registered");
    } catch (e) {
      logger.warn({ err: e }, "Failed to register cron jobs (Redis down?)");
    }
  }

  logger.info("Server ready");
});

// --- Graceful shutdown ---
const shutdown = async () => {
  if (workerInstances.length > 0) {
    logger.info("Closing workers...");
    await Promise.all(workerInstances.map((w) => w.close()));
    logger.info("All workers closed");
  }
  server.close(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

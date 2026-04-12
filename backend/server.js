// Must be the first import — loads .env before any module reads process.env
import "./config/env.js";

import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import http from "http";
import { createHttpTerminator } from "http-terminator";
import { Server } from "socket.io";
import process from "process";
import mongoose from "mongoose";
import logger from "./config/logger.js";
import { getCurrentQuarterKey } from "./config/constants.js";

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
import { apiLimiter, authLimiter, apiKeyLimiter, verifyToken, requireAdmin, checkApiKeyScope } from "./middleware/auth.js";

const app = express();
// Trust Render's reverse proxy so express-rate-limit can read X-Forwarded-For
app.set("trust proxy", 1);
const server = http.createServer(app);
const httpTerminator = createHttpTerminator({
  server,
  gracefulTerminationTimeout: 10000, // 10s for in-flight requests to finish before force-close
});

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
  // Tuned for 70+ concurrent users — faster dead-connection cleanup saves ~50KB per stale socket
  pingTimeout: 10000,        // 10s before considering connection dead (was 30s)
  pingInterval: 8000,        // 8s between pings (detect stale connections faster)
  maxHttpBufferSize: 1e6,    // 1MB max message size (prevent memory abuse)
  connectTimeout: 10000,     // 10s to complete handshake
  perMessageDeflate: false,  // Disable per-message compression (saves CPU at cost of bandwidth)
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
app.use("/api", apiKeyLimiter);
app.use("/api", apiLimiter);
app.use("/api", verifyToken);
app.use("/api", checkApiKeyScope);
app.use("/api/admin", requireAdmin);

// --- Routes ---
import { mountRoutes } from "./routes/index.js";
mountRoutes(app);

// --- Global error handler (must be after routes) ---
app.use((err, req, res, _next) => {
  logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
  res.status(500).json({ success: false, error: { message: err.message || "Internal server error" } });
});

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

logger.info({ role: NODE_ROLE }, "Server starting in %s mode", NODE_ROLE);
if (isHybrid && process.env.NODE_ENV === "production") {
  logger.warn("Running in hybrid mode in production — API and workers share one event loop. Set NODE_ROLE=api and NODE_ROLE=worker on separate instances to avoid lag spikes under load.");
}

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
        "precompute", { quarter: getCurrentQuarterKey() },
        { repeat: { pattern: "30 4 * * *" }, jobId: "daily-analytics-precompute" },  // 04:30 UTC = 10:00 AM IST (runs after sync)
      );
      await getActivitySyncQueue().add(
        "incremental", {},
        { repeat: { pattern: "0 5 * * *" }, jobId: "daily-activity-sync" },  // 05:00 UTC = 10:30 AM IST (runs after analytics)
      );
      await getActivitySyncQueue().add(
        "frequent", {},
        { repeat: { pattern: "*/10 * * * *" }, jobId: "frequent-activity-sync" },  // Every 10 min — near-real-time catch-up
      );
      logger.info("Cron jobs registered");
    } catch (e) {
      logger.warn({ err: e }, "Failed to register cron jobs (Redis down?)");
    }
  }

  logger.info("Server ready");
});

// --- Graceful shutdown ---
let isShuttingDown = false;
const shutdown = async (signal) => {
  if (isShuttingDown) return; // Prevent double shutdown
  isShuttingDown = true;
  logger.info({ signal }, "Graceful shutdown initiated");

  // Force exit after 20s if graceful shutdown hangs.
  // Must be set first — everything below is best-effort within this budget.
  const forceTimer = setTimeout(() => {
    logger.warn("Forced exit after timeout");
    process.exit(1);
  }, 20000);
  forceTimer.unref();

  // 1. Drain HTTP connections gracefully via http-terminator.
  //    - Immediately stops accepting new connections
  //    - Sets "Connection: close" on in-flight responses so keep-alive sockets drain
  //    - After gracefulTerminationTimeout (10s), force-destroys remaining sockets
  try {
    await httpTerminator.terminate();
    logger.info("HTTP connections drained");
  } catch (e) {
    logger.error({ err: e }, "HTTP termination error");
  }

  // 2. Close Socket.IO connections (sends disconnect to all clients)
  io.close();

  // 3. Close BullMQ workers (let in-flight jobs finish, up to 10s)
  if (workerInstances.length > 0) {
    logger.info("Closing workers...");
    await Promise.allSettled(workerInstances.map((w) => w.close()));
    logger.info("All workers closed");
  }

  // 4. Close database connections
  try {
    await mongoose.connection.close();
    logger.info("MongoDB connection closed");
  } catch (e) {
    logger.error({ err: e }, "MongoDB close error");
  }

  const { getRedis } = await import("./config/database.js");
  const redisConn = getRedis();
  if (redisConn) {
    redisConn.disconnect();
    logger.info("Redis connection closed");
  }

  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

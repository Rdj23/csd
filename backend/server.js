import path from "path";
import express from "express";
import http from "http";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import process from "process";
import mongoose from "mongoose";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Trust Render's reverse proxy so express-rate-limit can read X-Forwarded-For
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
});

dotenv.config({ path: path.resolve(__dirname, "../.env") });


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
    console.log("🍃 MongoDB Connected");
    setServerReady(true);
  })
  .catch((err) => {
    console.error("❌ MongoDB Error:", err);
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
import { initQueues, getTicketSyncQueue, getHistoricalSyncQueue, getAnalyticsQueue, getRosterQueue } from "./lib/queues.js";

const bullmqConn = getBullMQConnection();
if (bullmqConn) {
  initQueues(bullmqConn);
  console.log(`📋 BullMQ queues initialized (${NODE_ROLE} mode)`);
} else {
  console.warn("⚠️ No REDIS_URL — BullMQ queues not available");
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
import { AnalyticsTicket } from "./models/index.js";

let workerInstances = [];
const redisUrl = getRedisUrl();

if (runWorkers && bullmqConn && redisUrl) {
  initPublisher(redisUrl);
  workerInstances = registerAllWorkers(bullmqConn);
  console.log(`✅ ${workerInstances.length} workers registered (${NODE_ROLE} mode)`);
}

if (redisUrl) {
  initSubscriber(redisUrl, io);
}

// --- Start server ---
const PORT = process.env.PORT || 5000;

server.listen(PORT, async () => {
  console.log(`🚀 Server on port ${PORT} (${NODE_ROLE} mode)`);

  // Non-blocking: count tickets in background
  AnalyticsTicket.countDocuments().then((count) => {
    console.log(
      count
        ? `✅ ${count} tickets in MongoDB`
        : "⚠️ MongoDB empty - run /api/admin/backfill",
    );
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
          console.log("📦 Dispatched startup ticket sync job");
        } catch {
          console.warn("⚠️ BullMQ unavailable, running startup sync directly");
          fetchAndCacheTickets("startup").catch((e) => console.error("Direct startup sync failed:", e.message));
        }
      } else {
        console.log("📦 No queues, running startup sync directly");
        fetchAndCacheTickets("startup").catch((e) => console.error("Direct startup sync failed:", e.message));
      }
    }
  } catch {
    // Redis completely down — run direct sync
    console.warn("⚠️ Redis down, running startup sync directly");
    fetchAndCacheTickets("startup").catch((e) => console.error("Direct startup sync failed:", e.message));
  }

  // Register cron jobs if running workers and BullMQ is available
  if (runWorkers && bullmqConn) {
    try {
      await getHistoricalSyncQueue().add(
        "delta-sync", {},
        { repeat: { pattern: "30 18 * * *" }, jobId: "daily-historical-sync" },
      );
      await getAnalyticsQueue().add(
        "precompute", { quarter: "Q1_26" },
        { repeat: { pattern: "30 19 * * *" }, jobId: "daily-analytics-q1-26" },
      );
      console.log("📅 Cron jobs registered");
    } catch (e) {
      console.warn("⚠️ Failed to register cron jobs (Redis down?):", e.message);
    }
  }

  console.log("✅ Server ready");
});

// --- Graceful shutdown ---
const shutdown = async () => {
  if (workerInstances.length > 0) {
    console.log("🛑 Closing workers...");
    await Promise.all(workerInstances.map((w) => w.close()));
    console.log("✅ All workers closed");
  }
  server.close(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

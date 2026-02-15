import path from "path";
import express from "express";
import http from "http";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import process from "process";
import mongoose from "mongoose";

// Memory management for Render
if (process.env.NODE_ENV === "production") {
  const v8 = await import("v8");
  v8.setFlagsFromString("--max-old-space-size=512");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

// --- Create Express app, HTTP server, Socket.IO ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- Middleware ---
import {
  coopHeaders,
  corsMiddleware,
  compressionMiddleware,
  jsonParser,
  urlencodedParser,
  readinessCheck,
  setServerReady,
} from "./middleware/server.js";
import { apiLimiter, verifyToken, requireAdmin } from "./middleware/auth.js";

app.use(coopHeaders);
app.use(corsMiddleware);
app.use(compressionMiddleware);
app.use(jsonParser);
app.use(urlencodedParser);
app.use(readinessCheck);

// --- Security layer ---
app.use("/api", apiLimiter);
app.use("/api", verifyToken);
app.use("/api/admin", requireAdmin);

// --- Routes ---
import { mountRoutes } from "./routes/index.js";
mountRoutes(app);

// --- Database connections ---
import { connectMongoDB, initRedis } from "./config/database.js";

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

// --- Socket.IO injection ---
import { setIO as setWebhookIO } from "./controllers/webhookController.js";
import { setIO as setTicketIO } from "./controllers/ticketController.js";
setWebhookIO(io);
setTicketIO(io);

// --- Cache warming on MongoDB ready ---
import { warmCache, startBackgroundRefresh, getCacheWarmingStarted } from "./services/analyticsService.js";
import { fetchAndCacheTickets, syncHistoricalToDB } from "./services/syncService.js";
import { syncRoster } from "./services/rosterService.js";
import { AnalyticsTicket } from "./models/index.js";

mongoose.connection.once("open", () => {
  console.log("🍃 MongoDB connection ready");
  warmCache("mongodb-open", fetchAndCacheTickets);
});

// --- Start server ---
const PORT = process.env.PORT || 5000;

server.listen(PORT, async () => {
  console.log(`🚀 Server on port ${PORT}`);

  // Non-blocking: count tickets in background
  AnalyticsTicket.countDocuments().then((count) => {
    console.log(
      count
        ? `✅ ${count} tickets in MongoDB`
        : "⚠️ MongoDB empty - run /api/admin/backfill",
    );
  });

  // Non-blocking: sync roster in background (don't wait)
  syncRoster().catch((err) => console.error("Roster sync failed:", err));

  // Fallback cache warming after 5s if MongoDB connection was slow
  setTimeout(() => {
    if (!getCacheWarmingStarted() && mongoose.connection.readyState === 1) {
      warmCache("server-listen-fallback", fetchAndCacheTickets);
    }
  }, 5000);

  // Start background cache refresh for instant load times
  startBackgroundRefresh();

  console.log("✅ Server ready - background tasks running");
});

// Scheduled sync every 6 hours
setInterval(
  () => {
    console.log("⏰ Scheduled sync (every 6 hours)...");
    syncHistoricalToDB(false);
  },
  6 * 60 * 60 * 1000,
);

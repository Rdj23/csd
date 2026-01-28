import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import axios from "axios";
import http from "http";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
// ✅ REMOVED: NodeCache import - Using Redis only to prevent double-caching memory issues
// import NodeCache from "node-cache";
import { google } from "googleapis";
import process from "process";
import { OAuth2Client } from "google-auth-library";
import { parseISO, format, subDays } from "date-fns";
import mongoose from "mongoose";
import compression from "compression";
import Redis from "ioredis";

// Memory management for Render
if (process.env.NODE_ENV === "production") {
  const v8 = await import("v8");
  v8.setFlagsFromString("--max-old-space-size=512");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ✅ REMOVED: NodeCache instance - Using Redis only
// const cache = new NodeCache({ stdTTL: 0 });

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const DEVREV_API = "https://api.devrev.ai";
const HEADERS = {
  Authorization: `Bearer ${process.env.VITE_DEVREV_PAT}`,
  "Content-Type": "application/json",
};
let syncTimeout = null;

// --- SERVER READINESS STATE ---
let isServerReady = false;
let cacheWarmingStarted = false;

// --- MONGODB CONNECTION ---
// ✅ FIX: Added timeout options to prevent indefinite hangs on cold starts
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000, // Fail fast if can't find server in 10s
    connectTimeoutMS: 10000, // Connection timeout 10s
    socketTimeoutMS: 30000, // Socket operations timeout 30s
  })
  .then(() => {
    console.log("🍃 MongoDB Connected");
    isServerReady = true;
  })
  .catch((err) => {
    console.error("❌ MongoDB Error:", err);
    // Still mark as ready to allow health checks to work
    isServerReady = true;
  });

// --- REDIS CONNECTION ---
// Redis URL - internal URL only works on Render, external URL needed for local dev
const REDIS_URL = process.env.REDIS_URL;
let redis = null;

const initRedis = async () => {
  // Skip Redis if no URL provided (local dev without Redis)
  if (!REDIS_URL) {
    console.log("⚠️ No REDIS_URL - running without Redis cache");
    return;
  }

  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      connectTimeout: 5000,
      lazyConnect: true,
    });

    redis.on("connect", () => console.log("🔴 Redis Connected"));
    redis.on("error", (err) => {
      console.error("Redis Error:", err.message);
      // Don't keep retrying if it fails
      redis.disconnect();
      redis = null;
    });

    // ✅ OPTIMIZED: Connect in background - don't block server startup
    redis.connect().catch((err) => {
      console.error("Redis Init Failed:", err.message);
      console.log("⚠️ Continuing without Redis cache");
      redis = null;
    });
  } catch (err) {
    console.error("Redis Init Failed:", err.message);
    console.log("⚠️ Continuing without Redis cache");
    redis = null;
  }
};

// ✅ Start Redis connection immediately (non-blocking)
initRedis();

// --- REDIS CACHE HELPERS ---
const CACHE_TTL = {
  ANALYTICS: 1800, // 30 minutes
  TICKETS: 300, // 5 minutes
  LEADERBOARD: 3600, // 1 hour
  DRILLDOWN: 600, // 10 minutes
};

const redisGet = async (key) => {
  if (!redis) return null;
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.error("Redis GET error:", e.message);
    return null;
  }
};

const redisSet = async (key, data, ttl = 1800) => {
  if (!redis) return false;
  try {
    await redis.setex(key, ttl, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error("Redis SET error:", e.message);
    return false;
  }
};

const redisDelete = async (pattern) => {
  if (!redis) return;
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`🗑️ Cleared ${keys.length} cache keys: ${pattern}`);
    }
  } catch (e) {
    console.error("Redis DEL error:", e.message);
  }
};

// Map DevRev display_name to GST roster name

// --- TEAM CONFIGURATION (Backend Copy) ---
const TEAM_GROUPS = {
  "Mashnu": { "DEVU-1111": "Rohan", "DEVU-1114": "Archie", "DEVU-1072": "Neha", "DEVU-1115": "Shreya", "DEVU-1122": "Vaibhav", "DEVU-1076": "Adarsh", "DEVU-1108": "Abhishek" },
  "Debashish": { "DEVU-1087": "Shubhankar", "DEVU-736": "Musaveer", "DEVU-550": "Anurag", "DEVU-1102": "Debashish" },
  "Shweta": { "DEVU-5": "Aditya", "DEVU-1113": "Shweta", "DEVU-4": "Nikita" },
  "Tuaha": { "DEVU-1123": "Tuaha Khan", "DEVU-1098": "Harsh", "DEVU-689": "Tamanna", "DEVU-1110": "Shreyas" },
  "Adish": { "DEVU-1121": "Adish" } 
};

const GST_NAME_MAP = {
  Rohan: "Rohan",
  "Rohan Jadhav": "Rohan",
  Archie: "Archie",
  "Neha Yadav": "Neha",
  Neha: "Neha",
  "Shreya Khale": "Shreya",
  "Vaibhav Agarwal": "Vaibhav",

  Adarsh: "Adarsh",
  "Abhishek Vishwakarma": "Abhishek",
  Shubhankar: "Shubhankar",
  "Musaveer Manekia": "Musaveer",
  "Debashish Muni": "Debashish",
  "Shweta.M": "Shweta",

  "Anurag Ghatge": "Anurag",
  "nikita-narwani": "Nikita",
  "Aditya Mishra": "Aditya",

  "Taha Khan": "Tuaha Khan",

  "Harsh Singh": "Harsh",
  "Tamanna Khan": "Tamanna",
  Tamanna: "Tamanna",
  Shreyas: "Shreyas",
  "Shreyas Naikwadi": "Shreyas",
};

// List of valid GST members
const GST_MEMBERS = new Set([
  "Rohan",
  "Archie",
  "Neha",
  "Shreya",
  "Vaibhav",
  "Adarsh",
  "Abhishek",
  "Shubhankar",
  "Musaveer",
  "Anurag",
  "Debashish",
  "Aditya",
  "Shweta",
  "Nikita",
  "Tuaha Khan",
  "Harsh",
  "Tamanna",
  "Shreyas",
  "Adish",
]);

// ============================================================================
// SHARED CONSTANTS FOR SHIFT & BACKUP LOGIC
// ============================================================================

// Shift timings in IST (decimal hours: 7.5 = 7:30 AM)
const SHIFT_HOURS = {
  "SHIFT 1": { start: 7.5, end: 16.5 },   // 7:30 AM - 4:30 PM
  "SHIFT 2": { start: 10.5, end: 19.5 },  // 10:30 AM - 7:30 PM
  "SHIFT 3": { start: 13.5, end: 22.5 },  // 1:30 PM - 10:30 PM
  "SHIFT 4": { start: 22.5, end: 7.5, overnight: true }, // 10:30 PM - 7:30 AM
  "ON CALL": { start: 0, end: 24 },
};

// Off status reasons with friendly display names
const OFF_STATUS_MAP = {
  "WEEK OFF": "Week Off",
  "WO": "Week Off",
  "EL": "On Leave (EL)",
  "NH": "National Holiday",
  "PL": "Planned Leave",
  "PH": "Public Holiday",
  "L": "On Leave",
  "COMP OFF": "Comp Off",
  "OH": "Optional Holiday",
  "": "Away",
};
const OFF_STATUSES = Object.keys(OFF_STATUS_MAP);

// L1/L2 designation mapping
const DESIGNATION_MAP = {
  "Debashish": "L2", "Anurag": "L1", "Musaveer": "L1", "Shubhankar": "L1",
  "Tuaha Khan": "L2", "Tuaha": "L2", "Harsh": "L2", "Tamanna": "L1", "Shreyas": "L1",
  "Shweta": "L2", "Aditya": "L2", "Nikita": "L1",
  "Rohan": "L2", "Archie": "L1", "Neha": "L1", "Shreya": "L1",
  "Abhishek": "L1", "Adarsh": "L1", "Vaibhav": "L1", "Adish": "L2",
};

// Map display names to roster names (for names that differ)
const NAME_TO_ROSTER_MAP = {
  "Tuaha Khan": "Tuaha",
};

// Team mapping for backup lookups
const TEAM_MAPPING = {
  "Debashish": { team: "Debashish", members: ["Debashish", "Anurag", "Musaveer", "Shubhankar"] },
  "Anurag": { team: "Debashish", members: ["Debashish", "Anurag", "Musaveer", "Shubhankar"] },
  "Musaveer": { team: "Debashish", members: ["Debashish", "Anurag", "Musaveer", "Shubhankar"] },
  "Shubhankar": { team: "Debashish", members: ["Debashish", "Anurag", "Musaveer", "Shubhankar"] },

  "Tuaha Khan": { team: "Tuaha", members: ["Tuaha Khan", "Harsh", "Tamanna", "Shreyas"] },
  "Tuaha": { team: "Tuaha", members: ["Tuaha Khan", "Harsh", "Tamanna", "Shreyas"] },
  "Harsh": { team: "Tuaha", members: ["Tuaha Khan", "Harsh", "Tamanna", "Shreyas"] },
  "Tamanna": { team: "Tuaha", members: ["Tuaha Khan", "Harsh", "Tamanna", "Shreyas"] },
  "Shreyas": { team: "Tuaha", members: ["Tuaha Khan", "Harsh", "Tamanna", "Shreyas"] },

  "Shweta": { team: "Shweta", members: ["Shweta", "Aditya", "Nikita"] },
  "Aditya": { team: "Shweta", members: ["Shweta", "Aditya", "Nikita"] },
  "Nikita": { team: "Shweta", members: ["Shweta", "Aditya", "Nikita"] },

  "Rohan": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
  "Archie": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
  "Neha": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
  "Shreya": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
  "Abhishek": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
  "Adarsh": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
  "Vaibhav": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
};

// Helper to get current IST time (handles server running in UTC)
const getISTTime = () => {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in ms
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  return new Date(utcTime + istOffset);
};

// Helper to get current hour in IST as decimal
const getCurrentISTHour = () => {
  const ist = getISTTime();
  return ist.getHours() + ist.getMinutes() / 60;
};

const resolveOwnerName = (displayName) => {
  if (!displayName) return null; // Will be filtered out
  const resolved = GST_NAME_MAP[displayName];
  if (resolved && GST_MEMBERS.has(resolved)) return resolved;
  return null; // Non-GST member, will be filtered out
};

const isGSTMember = (ownerName) => {
  if (!ownerName) return false;
  return GST_MEMBERS.has(ownerName);
};

// --- SCHEMAS ---
const RemarkSchema = new mongoose.Schema({
  ticketId: String,
  user: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
});
const Remark = mongoose.model("Remark", RemarkSchema);

const ViewSchema = new mongoose.Schema({
  userId: String,
  name: String,
  filters: Object,
  createdAt: { type: Date, default: Date.now },
});
const View = mongoose.model("View", ViewSchema);

const AnalyticsTicketSchema = new mongoose.Schema(
  {
    ticket_id: { type: String, unique: true, index: true },
    display_id: String,
    title: String,
    created_date: Date,
    closed_date: { type: Date, index: true },
    owner: { type: String, index: true },
    team: String,
    region: String,
    priority: String,
    is_zendesk: { type: Boolean, index: true },
    rwt: Number,
    frt: Number,
    iterations: Number,
    // ✅ FIX 3: CSAT is Number (0, 1, 2)
    csat: { type: Number, default: 0 },
    // ✅ FIX 4: FRR is Number (0 or 1)
    frr: { type: Number, default: 0 },
    account_name: { type: String, index: true },
    // NOC Fields
    is_noc: { type: Boolean, default: false, index: true },
    noc_issue_id: { type: String, default: null }, // e.g., "ISS-124362"
    noc_jira_key: { type: String, default: null }, // e.g., "SUC-128878"
    noc_rca: { type: String, default: null }, // e.g., "Understanding Gap - CS"
    noc_reported_by: { type: String, default: null }, // e.g., "Sambhaavna A"
    noc_assignee: { type: String, default: null },
    stage_name: { type: String, index: true }, // ✅ For filtering by ticket status
    actual_close_date: Date, // ✅ For hot data filtering (last 24h)
  },
  { versionKey: false },
);

// ✅ EXISTING INDEXES
AnalyticsTicketSchema.index({ closed_date: 1, owner: 1 });
AnalyticsTicketSchema.index({ closed_date: 1, is_noc: 1 });
AnalyticsTicketSchema.index({ closed_date: 1, is_zendesk: 1 });
AnalyticsTicketSchema.index({ owner: 1, closed_date: 1, region: 1 });

// ✅ NEW INDEXES FOR HOT/WARM/COLD DATA STRATEGY
AnalyticsTicketSchema.index({ stage_name: 1, actual_close_date: -1 }); // For active vs solved filtering
AnalyticsTicketSchema.index({ actual_close_date: -1 }); // For recent solved tickets queries
AnalyticsTicketSchema.index({ created_date: -1, stage_name: 1 }); // For pagination by creation date

const AnalyticsTicket = mongoose.model(
  "AnalyticsTicket",
  AnalyticsTicketSchema,
);

const AnalyticsCacheSchema = new mongoose.Schema({
  cache_key: { type: String, unique: true, index: true },
  computed_at: { type: Date, default: Date.now },
  stats: Object,
  trends: Array,
  leaderboard: Array,
  badTickets: Array,
  individualTrends: Object,
});
const AnalyticsCache = mongoose.model("AnalyticsCache", AnalyticsCacheSchema);

// ✅ NEW: Pre-computed Dashboard Cache - Updated every 15 minutes in background
// This provides instant response times for users
const PrecomputedDashboardSchema = new mongoose.Schema({
  cache_type: { type: String, unique: true, index: true }, // 'default', 'q4_25', 'q1_26'
  computed_at: { type: Date, default: Date.now },
  data: Object, // Full analytics response
  computing: { type: Boolean, default: false }, // Lock to prevent concurrent refreshes
});
const PrecomputedDashboard = mongoose.model("PrecomputedDashboard", PrecomputedDashboardSchema);

// --- MIDDLEWARE ---
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  req.setTimeout(30000); // 30 second timeout
  res.setTimeout(30000);

  next();
});

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://clevertapintel.globalsupportteam.com",
    ],
    credentials: true,
    maxAge: 86400,
  }),
);
// GZIP Compression - reduces payload by 70%
app.use(
  compression({
    level: 6,
    threshold: 1024, // Only compress responses > 1KB
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ✅ FIX: Readiness check middleware - allow health/config checks even during startup
app.use((req, res, next) => {
  // Always allow health checks and config (needed for startup detection)
  if (req.path === "/api/health" || req.path === "/api/auth/config") {
    return next();
  }

  // For other routes, check if server is ready
  if (!isServerReady) {
    return res.status(503).json({
      error: "Server starting up",
      status: "initializing",
      retryAfter: 5,
    });
  }
  next();
});

let isSyncing = false;
let syncQueued = false;

const getQuarterDateRange = (quarter) => {
  const now = new Date();
  switch (quarter) {
    
    case "Q1_26":
      return {
        start: new Date("2026-01-01"), // ✅ FIX: ISO Week 1 starts Dec 29
        end: new Date("2026-03-31T23:59:59Z"),
      };

    // ✅ FIXED: Q1 2026 Weeks (Monday to Sunday, ISO 8601)
    // Jan 1, 2026 = Thursday. Week 1 includes Jan 1-4 (4 days in 2026)
    case "Q1_26_W1":
      return {
        start: new Date("2026-01-01"), // Monday (includes Dec 29-31, Jan 1-4)
        end: new Date("2026-01-04T23:59:59Z"),
      };
    case "Q1_26_W2":
      return {
        start: new Date("2026-01-05"), // Monday
        end: new Date("2026-01-11T23:59:59Z"), // Sunday
      };
    case "Q1_26_W3":
      return {
        start: new Date("2026-01-12"), // Monday
        end: new Date("2026-01-18T23:59:59Z"), // Sunday
      };
    case "Q1_26_W4":
      return {
        start: new Date("2026-01-19"), // Monday
        end: new Date("2026-01-25T23:59:59Z"), // Sunday
      };
    case "Q1_26_W5":
      return {
        start: new Date("2026-01-26"), // Monday
        end: new Date("2026-02-01T23:59:59Z"), // Sunday
      };
    case "Q1_26_W6":
      return {
        start: new Date("2026-02-02"), // Monday
        end: new Date("2026-02-08T23:59:59Z"), // Sunday
      };

    // Q1 2026 Months
    case "Q1_26_M1":
      return {
        start: new Date("2026-01-01"),
        end: new Date("2026-01-31T23:59:59Z"),
      };
    case "Q1_26_M2":
      return {
        start: new Date("2026-02-01"),
        end: new Date("2026-02-28T23:59:59Z"),
      };
    case "Q1_26_M3":
      return {
        start: new Date("2026-03-01"),
        end: new Date("2026-03-31T23:59:59Z"),
      };

    default:
      // Default to last 60 days
      const start = new Date(now);
      start.setDate(start.getDate() - 60);
      return { start, end: now };
  }
};

// ============================================================================
// LIVE STATS ENDPOINT (The "Drill-Down Method" for Cards & Charts)
// ============================================================================
app.get("/api/tickets/live-stats", async (req, res) => {
  try {
    const { start, end, owners, teams, region, excludeZendesk, excludeNOC } =
      req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "Start and End dates required" });
    }

    // Redis cache check
    const cacheKey = `livestats:${start}:${end}:${owners || "all"}:${region || "all"}:${excludeZendesk || "false"}:${excludeNOC || "false"}`;
    const cachedData = await redisGet(cacheKey);
    if (cachedData) {
      console.log(`⚡ LiveStats Redis HIT`);
      return res.json(cachedData);
    }

    // 1. Build Filter (Exact same as Drill-Down)
    const startDate = new Date(start);
    const endDate = new Date(end);

    // Ensure full day coverage
    if (startDate.getHours() === 0) startDate.setHours(0, 0, 0, 0);
    if (endDate.getHours() === 0) endDate.setHours(23, 59, 59, 999);

    const matchConditions = {
      closed_date: { $gte: startDate, $lte: endDate },
    };

    // Owner Filter
    if (owners && owners.length > 0 && owners !== "All") {
      const ownerList = owners.split(",").filter((o) => o.trim());
      if (ownerList.length > 0) matchConditions.owner = { $in: ownerList };
    }

    // Region Filter (Crucial for your issue)
    if (region && region.length > 0 && region !== "All") {
      matchConditions.region = {
        $in: region.split(",").filter((r) => r.trim()),
      };
    }

    // Zendesk Filter
    if (excludeZendesk === "true") {
      matchConditions.is_zendesk = { $ne: true };
    }

    // NOC Filter
    if (req.query.excludeNOC === "true") {
      matchConditions.is_noc = { $ne: true };
    }

    // 2. Aggregation Pipeline (Calculate Stats & Trends on the fly)
    const result = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalSolved: { $sum: 1 },

          // Stats for Cards (ignoring 0 values)
          avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
          avgFRT: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
          avgIterations: {
            $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] },
          },

          // ✅ FIX: VALID COUNTS (Needed for Weighted Average on Frontend)
          rwtValidCount: { $sum: { $cond: [{ $gt: ["$rwt", 0] }, 1, 0] } },
          frtValidCount: { $sum: { $cond: [{ $gt: ["$frt", 0] }, 1, 0] } },
          iterValidCount: {
            $sum: { $cond: [{ $gt: ["$iterations", 0] }, 1, 0] },
          },

          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },

          // Daily Trend for Expanded Chart
          dailyData: {
            $push: {
              date: {
                $dateToString: { format: "%Y-%m-%d", date: "$closed_date" },
              },
              rwt: "$rwt",
              frt: "$frt",
              iterations: "$iterations",
              csat: "$csat",
              frr: "$frr",
            },
          },
        },
      },
    ]);

    if (result.length === 0) {
      return res.json({ stats: {}, trends: [] });
    }

    const data = result[0];

    // 3. Process Daily Trends for Chart
    // We group the 'dailyData' array by date inside JS to handle the daily sums
    const trendsMap = {};
    data.dailyData.forEach((t) => {
      if (!trendsMap[t.date]) {
        trendsMap[t.date] = {
          date: t.date,
          solved: 0,
          sumRWT: 0,
          countRWT: 0,
          sumFRT: 0,
          countFRT: 0,
          sumIter: 0,
          countIter: 0,
          positiveCSAT: 0,
          frrMet: 0,
          frrTotal: 0, // ✅ Add total count for FRR percentage
        };
      }
      const day = trendsMap[t.date];
      day.solved++;
      day.frrTotal++; // ✅ Increment total for FRR percentage
      if (t.csat === 2) day.positiveCSAT++;
      if (t.frr === 1) day.frrMet++;

      if (t.rwt > 0) {
        day.sumRWT += t.rwt;
        day.countRWT++;
      }
      if (t.frt > 0) {
        day.sumFRT += t.frt;
        day.countFRT++;
      }
      if (t.iterations > 0) {
        day.sumIter += t.iterations;
        day.countIter++;
      }
    });

    const trends = Object.values(trendsMap)
      .map((day) => ({
        date: day.date,
        solved: day.solved,
        positiveCSAT: day.positiveCSAT,
        frrMet: day.frrMet,
        frrPercent: day.frrTotal > 0 ? Math.round((day.frrMet / day.frrTotal) * 100) : 0, // ✅ FRR as percentage
        avgRWT: day.countRWT ? day.sumRWT / day.countRWT : 0,
        avgFRT: day.countFRT ? day.sumFRT / day.countFRT : 0,
        avgIterations: day.countIter ? day.sumIter / day.countIter : 0,
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Cache response
    await redisSet(cacheKey, responseData, CACHE_TTL.DRILLDOWN);

    res.json({
      stats: {
        totalSolved: data.totalSolved,
        avgRWT: data.avgRWT || 0,
        avgFRT: data.avgFRT || 0,
        avgIterations: data.avgIterations || 0,

        // ✅ FIX: VALID COUNTS (Needed for Weighted Average on Frontend)
        rwtValidCount: { $sum: { $cond: [{ $gt: ["$rwt", 0] }, 1, 0] } },
        frtValidCount: { $sum: { $cond: [{ $gt: ["$frt", 0] }, 1, 0] } },
        iterValidCount: {
          $sum: { $cond: [{ $gt: ["$iterations", 0] }, 1, 0] },
        },

        positiveCSAT: data.positiveCSAT,
        frrPercent: data.totalSolved
          ? Math.round((data.frrMet / data.totalSolved) * 100)
          : 0,
      },
      trends,
    });
  } catch (e) {
    console.error("Live Stats Error:", e);
    res.status(500).json({ error: e.message });
  }
});
// ============================================================================
// ✅ MAIN ANALYTICS ENDPOINT - Server-side Aggregation
// ============================================================================

// ============================================================================
// DRILL-DOWN ENDPOINT (Direct Mongo Query)
// ============================================================================
app.get("/api/tickets/drilldown", async (req, res) => {
  try {
    const { date, metric, type } = req.query; // type = 'created' (Volume) or 'closed' (Performance)

    if (!date) return res.status(400).json({ error: "Date required" });

    // Define Start/End of that specific day
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    let query = {};

    // 1. Determine Date Filter
    if (type === "created") {
      query.created_date = { $gte: startOfDay, $lte: endOfDay };
    } else {
      // For Solved, RWT, Backlog
      query.actual_close_date = { $gte: startOfDay, $lte: endOfDay };
      // Ensure it is actually solved
      query.stage_name = {
        $in: ["solved", "closed", "resolved", "Resolved", "Solved", "Closed"],
      };
    }

    // 2. Fetch from Mongo (Not RAM!)
    // We select only needed fields to keep it fast
    const tickets = await AnalyticsTicket.find(query)
      .select(
        "display_id title created_date actual_close_date owner stage_name rwt account_name",
      )
      .lean(); // .lean() makes it a plain JSON object (faster)

    res.json({ tickets });
  } catch (error) {
    console.error("Drilldown Error:", error);
    res.status(500).json({ error: "Failed to fetch drilldown data" });
  }
});

app.get("/api/tickets/analytics", async (req, res) => {
  try {
    const {
      quarter = "Q1_26",
      excludeZendesk,
      excludeNOC,
      owner,
      owners, // Ensure this is here if using new filters
      region,
      forceRefresh,
      groupBy = "daily",
    } = req.query;
    const cacheKey = `analytics:${quarter}:${excludeZendesk || "false"}:${excludeNOC || "false"}:${owner || "all"}:${owners || "none"}:${region || "none"}:${groupBy}`;

    // ✅ NEW: Check pre-computed cache first (FASTEST - instant response)
    // Only for default queries without filters (most common case)
    const isDefaultQuery = !excludeZendesk && !excludeNOC && !owner && !owners && !region && groupBy === "daily";
    if (isDefaultQuery && forceRefresh !== "true") {
      const cacheType = quarter.toLowerCase().replace("_", "");
      const precomputed = await PrecomputedDashboard.findOne({ cache_type: cacheType }).lean();

      if (precomputed?.data && !precomputed.computing) {
        const age = Date.now() - new Date(precomputed.computed_at).getTime();
        // Serve if less than 20 minutes old
        if (age < 20 * 60 * 1000) {
          console.log(`⚡ PRECOMPUTED HIT: ${quarter} (${Math.round(age / 1000)}s old)`);
          return res.json(precomputed.data);
        }
      }
    }

    // 1. Check Redis cache first (fastest for filtered queries)
    if (forceRefresh !== "true") {
      const redisData = await redisGet(cacheKey);
      if (redisData) {
        console.log(`⚡ Redis HIT: ${cacheKey}`);
        return res.json(redisData);
      }
    }

    console.log(`📊 Analytics Request (Cache MISS): ${cacheKey}`);

    // 2. Check MongoDB cache (fallback)
    if (forceRefresh !== "true") {
      const mongoCache = await AnalyticsCache.findOne({
        cache_key: cacheKey,
      }).lean();
      if (
        mongoCache &&
        Date.now() - new Date(mongoCache.computed_at).getTime() < 1800000
      ) {
        console.log(`⚡ MongoDB Cache HIT`);
        // Store in Redis for next time
        await redisSet(cacheKey, mongoCache, CACHE_TTL.ANALYTICS);
        return res.json(mongoCache);
      }
    }

    // 3. Compute fresh data
    const { start, end } = getQuarterDateRange(quarter);
    console.log(
      `📅 Date Range: ${format(start, "MMM d")} - ${format(end, "MMM d")}`,
    );

    const matchConditions = {
      closed_date: { $gte: start, $lte: end },
    };
    if (excludeZendesk === "true") matchConditions.is_zendesk = { $ne: true };

    // ✅ FIX: NOC filter MUST be here
    if (excludeNOC === "true") {
      matchConditions.is_noc = { $ne: true };
    }

    if (owner && owner !== "All")
      matchConditions.owner = { $regex: owner, $options: "i" };

    // Aggregate Stats
    const [statsResult] = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalTickets: { $sum: 1 },
          avgRWT: {
            $avg: {
              $cond: [
                { $and: [{ $ne: ["$rwt", null] }, { $gt: ["$rwt", 0] }] },
                "$rwt",
                null,
              ],
            },
          },
          avgFRT: {
            $avg: {
              $cond: [
                { $and: [{ $ne: ["$frt", null] }, { $gt: ["$frt", 0] }] },
                "$frt",
                null,
              ],
            },
          },
          avgIterations: {
            $avg: {
              $cond: [{ $ne: ["$iterations", null] }, "$iterations", null],
            },
          },
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          // ✅ FIX 4: Updated FRR Aggregation (Sum of 1s)
          frrMet: { $sum: "$frr" },
          frrTotal: { $sum: 1 },
        },
      },
    ]);

    let dateFormat = "%Y-%m-%d"; // daily
    if (groupBy === "weekly") dateFormat = "%Y-W%V";
    if (groupBy === "monthly") dateFormat = "%Y-%m";

    // Daily/Weekly/Monthly Trends
    const trends = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: "$closed_date" } },
          solved: { $sum: 1 },
          avgRWT: { $avg: "$rwt" },
          avgFRT: { $avg: "$frt" },
          avgIterations: { $avg: "$iterations" },
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
          frrTotal: { $sum: 1 }, // ✅ Add total count for FRR percentage calculation
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 100 },
    ]);

    // ✅ FIX: Calculate FRR percentage for each trend data point
    const trendsWithFRRPercent = trends.map((t) => ({
      _id: t._id,
      solved: t.solved,
      avgRWT: t.avgRWT,
      avgFRT: t.avgFRT,
      avgIterations: t.avgIterations,
      positiveCSAT: t.positiveCSAT,
      frrMet: t.frrMet,
      frrPercent: t.frrTotal > 0 ? Math.round((t.frrMet / t.frrTotal) * 100) : 0, // FRR as percentage
    }));

    // Backlog Clearance (tickets >15 days old when closed) with same grouping
    const backlogCleared = await AnalyticsTicket.aggregate([
      {
        $match: {
          ...matchConditions,
          $expr: {
            $gt: [
              { $subtract: ["$closed_date", "$created_date"] },
              15 * 24 * 60 * 60 * 1000,
            ],
          },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: "$closed_date" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 100 },
    ]);

    // Leaderboard
    const leaderboard = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: "$owner",
          totalTickets: { $sum: 1 },
          goodCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          badCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          avgRWT: { $avg: "$rwt" },
          avgFRT: { $avg: "$frt" },
        },
      },
      { $match: { _id: { $ne: null }, totalTickets: { $gte: 3 } } },
      {
        $addFields: {
          winRate: {
            $cond: [
              { $gt: [{ $add: ["$goodCSAT", "$badCSAT"] }, 0] },
              {
                $multiply: [
                  {
                    $divide: ["$goodCSAT", { $add: ["$goodCSAT", "$badCSAT"] }],
                  },
                  100,
                ],
              },
              0,
            ],
          },
        },
      },
      { $sort: { goodCSAT: -1, winRate: -1 } },
      { $limit: 25 },
    ]);

    // Bad CSAT (including all for DSAT)
    const dsatMatch = { closed_date: { $gte: start, $lte: end }, csat: 1 };
    if (excludeZendesk === "true") dsatMatch.is_zendesk = { $ne: true };
    if (excludeNOC === "true") dsatMatch.is_noc = { $ne: true }; // Apply NOC filter to DSAT
    const badTickets = await AnalyticsTicket.find(dsatMatch, {
      ticket_id: 1,
      display_id: 1,
      title: 1,
      owner: 1,
      created_date: 1,
      closed_date: 1,
    })
      .sort({ closed_date: -1 })
      .limit(50)
      .lean();

    // Individual trends (last 60 days)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const individualTrends = await AnalyticsTicket.aggregate([
      {
        $match: matchConditions,
      },
      {
        $addFields: {
          ticketAge: {
            $divide: [
              { $subtract: ["$closed_date", "$created_date"] },
              1000 * 60 * 60 * 24,
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: { format: "%Y-%m-%d", date: "$closed_date" },
            },
            owner: "$owner",
          },
          solved: { $sum: 1 },

          // ✅ FIX: Use $cond to ignore 0 values for averages
          avgRWT: {
            $avg: {
              $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null],
            },
          },
          avgFRT: {
            $avg: {
              $cond: [{ $gt: ["$frt", 0] }, "$frt", null],
            },
          },
          // ✅ NEW: Iterations (Avg + Valid Count for weighting)
          avgIterations: {
            $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] },
          },
          iterValidCount: {
            $sum: { $cond: [{ $gt: ["$iterations", 0] }, 1, 0] },
          },

          // ✅ FIX: Add counts of valid tickets for Weighted Average calc on Frontend
          rwtValidCount: {
            $sum: { $cond: [{ $gt: ["$rwt", 0] }, 1, 0] },
          },
          frtValidCount: {
            $sum: { $cond: [{ $gt: ["$frt", 0] }, 1, 0] },
          },

          // ✅ FIX: Add CSAT and FRR data
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
          frrTotal: { $sum: 1 }, // ✅ FIX: Total tickets for correct FRR% calculation

          backlogCleared: {
            $sum: { $cond: [{ $gte: ["$ticketAge", 15] }, 1, 0] },
          },
        },
      },
      { $sort: { "_id.date": 1 } },
    ]);

    const response = {
      cache_key: cacheKey,
      computed_at: new Date(),
      quarter,
      dateRange: { start, end },
      stats: {
        totalTickets: statsResult?.totalTickets || 0,
        avgRWT: statsResult?.avgRWT ? Number(statsResult.avgRWT.toFixed(2)) : 0,
        avgFRT: statsResult?.avgFRT ? Number(statsResult.avgFRT.toFixed(2)) : 0,
        avgIterations: statsResult?.avgIterations
          ? Number(statsResult.avgIterations.toFixed(1))
          : 0,
        positiveCSAT: statsResult?.positiveCSAT || 0,
        negativeCSAT: statsResult?.negativeCSAT || 0,
        frrPercent:
          statsResult?.frrTotal > 0
            ? Math.round((statsResult.frrMet / statsResult.frrTotal) * 100)
            : 0,
      },
      trends: trendsWithFRRPercent.map((t) => {
        const backlog = backlogCleared.find((b) => b._id === t._id);
        return {
          date: t._id,
          solved: t.solved,
          avgRWT: t.avgRWT ? Number(t.avgRWT.toFixed(2)) : 0,
          avgFRT: t.avgFRT ? Number(t.avgFRT.toFixed(2)) : 0,
          avgIterations: t.avgIterations
            ? Number(t.avgIterations.toFixed(1))
            : 0,
          backlogCleared: backlog?.count || 0,
          positiveCSAT: t.positiveCSAT,
          frrMet: t.frrMet || 0,
          frrPercent: t.frrPercent || 0, // ✅ Include FRR percentage for graph
        };
      }),
      leaderboard: leaderboard.map((l) => ({
        name: l._id,
        totalTickets: l.totalTickets,
        goodCSAT: l.goodCSAT,
        badCSAT: l.badCSAT,
        winRate: Math.round(l.winRate || 0),
        avgRWT: l.avgRWT ? Number(l.avgRWT.toFixed(2)) : 0,
        avgFRT: l.avgFRT ? Number(l.avgFRT.toFixed(2)) : 0,
      })),
      badTickets: badTickets.map((t) => ({
        id: t.ticket_id,
        display_id: t.display_id,
        title: t.title,
        owner: t.owner,
        created_date: t.created_date,
        closed_date: t.closed_date,
      })),
      individualTrends: individualTrends.reduce((acc, item) => {
        const { date, owner } = item._id;
        if (!acc[owner]) acc[owner] = [];
        acc[owner].push({
          date,
          solved: item.solved,
          avgRWT: item.avgRWT ? Number(item.avgRWT.toFixed(2)) : 0,
          avgFRT: item.avgFRT ? Number(item.avgFRT.toFixed(2)) : 0,
          avgIterations: item.avgIterations
            ? Number(item.avgIterations.toFixed(1))
            : 0,
          // Pass the Raw Counts
          positiveCSAT: item.positiveCSAT || 0,
          frrMet: item.frrMet || 0,
          frrTotal: item.frrTotal || 0, // ✅ Pass total for frontend if needed
          // ✅ FIX: Use frrTotal instead of solved for correct FRR calculation
          frrPercent: item.frrTotal > 0
            ? Math.round((item.frrMet / item.frrTotal) * 100)
            : 0,
          // Pass Valid Counts for Frontend Weighting
          rwtValidCount: item.rwtValidCount || 0,
          frtValidCount: item.frtValidCount || 0,
          iterValidCount: item.iterValidCount || 0,
          backlogCleared: item.backlogCleared || 0,
        });
        return acc;
      }, {}),
    };

    // Cache in Redis (fast) and MongoDB (persistent)
    await Promise.all([
      redisSet(cacheKey, response, CACHE_TTL.ANALYTICS),
      AnalyticsCache.findOneAndUpdate(
        { cache_key: cacheKey },
        { $set: response },
        { upsert: true },
      ),
    ]);

    console.log(`✅ Analytics computed & cached: ${cacheKey}`);
    res.json(response);
  } catch (e) {
    console.error("❌ Analytics Error:", e.message, e.stack);
    res.status(500).json({
      stats: {},
      trends: [],
      leaderboard: [],
      badTickets: [],
      individualTrends: {},
    });
  }
});

// ✅ Cache status endpoint for debugging (Redis only)
app.get("/api/cache/status", async (req, res) => {
  let redisKeys = [];

  if (redis) {
    try {
      redisKeys = await redis.keys("*");
    } catch (e) {
      redisKeys = ["Error: " + e.message];
    }
  }

  res.json({
    redis: {
      status: redis?.status || "disconnected",
      keys: redisKeys.length,
      keyList: redisKeys.slice(0, 20), // First 20 keys
    },
    memory: process.memoryUsage(),
  });
});

// ✅ Manual cache clear endpoint (Redis only)
app.post("/api/cache/clear", async (req, res) => {
  await redisDelete("*");
  res.json({ success: true, message: "Redis cache cleared" });
});

// ============================================================================
// Get ALL tickets for a date RANGE (for weekly/monthly drill-down)
// ============================================================================
app.get("/api/tickets/by-range", async (req, res) => {
  try {
    const { start, end, owners, metric, excludeZendesk, excludeNOC, region } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "Start and end dates required" });
    }

    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    console.log(`📊 By-Range: ${start} to ${end}, metric=${metric}`);

    const matchConditions = {
      closed_date: { $gte: startDate, $lte: endDate },
    };

    // Owner filter
    if (owners && owners !== "All") {
      const ownerList = owners.split(",").filter((o) => o.trim());
      if (ownerList.length > 0) matchConditions.owner = { $in: ownerList };
    }

    // Region filter
    if (region && region !== "All") {
      matchConditions.region = { $in: region.split(",").filter((r) => r.trim()) };
    }

    // Zendesk filter
    if (excludeZendesk === "true") matchConditions.is_zendesk = { $ne: true };
    
    // NOC filter
    if (excludeNOC === "true") matchConditions.is_noc = { $ne: true };

    // For FRR/CSAT - return ALL tickets, let frontend calculate percentage
    // Only filter for specific metrics that need it
    if (metric === "backlog") {
      matchConditions.$expr = {
        $gt: [{ $subtract: ["$closed_date", "$created_date"] }, 15 * 86400000],
      };
    }

    const tickets = await AnalyticsTicket.find(matchConditions)
      .sort({ closed_date: -1 })
      .limit(2000)
      .lean();

    // Calculate summary stats
    const stats = {
      total: tickets.length,
      frrMet: tickets.filter(t => t.frr === 1).length,
      frrNotMet: tickets.filter(t => t.frr !== 1).length,
      positiveCSAT: tickets.filter(t => t.csat === 2).length,
      negativeCSAT: tickets.filter(t => t.csat === 1).length,
      avgRWT: tickets.length > 0 
        ? (tickets.reduce((sum, t) => sum + (t.rwt || 0), 0) / tickets.filter(t => t.rwt > 0).length).toFixed(2)
        : 0,
      avgIterations: tickets.length > 0
        ? (tickets.reduce((sum, t) => sum + (t.iterations || 0), 0) / tickets.filter(t => t.iterations > 0).length).toFixed(2)
        : 0,
    };

    res.json({ tickets, stats, count: tickets.length });
  } catch (e) {
    console.error("❌ By-range fetch error:", e);
    res.status(500).json({ error: e.message, tickets: [], stats: {} });
  }
});

// Get tickets for a specific date (for drill-down)

app.get("/api/tickets/by-date", async (req, res) => {
  try {
    const { date, owners, metric, excludeZendesk, region, excludeNOC } =
      req.query;

    if (!date) return res.status(400).json({ error: "Date required" });

    const cacheKey = `bydate:${date}:${owners || "all"}:${excludeZendesk || "false"}:${excludeNOC || "false"}`;
    const cached = await redisGet(cacheKey);
    if (cached) {
      console.log(`⚡ ByDate Redis HIT`);
      return res.json(cached);
    }

    // Parse date logic (Weekly vs Monthly vs Daily)
    let startOfDay, endOfDay;
    if (date.includes("W")) {
      // ✅ FIXED: Proper ISO Week calculation
      // Weekly format: 2026-W03
      const [year, weekPart] = date.split("-W");
      const weekNum = parseInt(weekPart);

      // ISO week calculation: Week 1 is the first week with 4+ days in the new year
      // Weeks start on Monday
      const jan1 = new Date(parseInt(year), 0, 1);
      const jan1Day = jan1.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday

      // Calculate the Monday of week 1
      // If Jan 1 is Mon-Thu, week 1 starts on the Monday of that week
      // If Jan 1 is Fri-Sun, week 1 starts on the next Monday
      let week1Monday;
      if (jan1Day === 0) { // Sunday
        week1Monday = new Date(jan1);
        week1Monday.setDate(jan1.getDate() + 1); // Next Monday
      } else if (jan1Day <= 4) { // Monday-Thursday
        week1Monday = new Date(jan1);
        week1Monday.setDate(jan1.getDate() - (jan1Day - 1)); // Go back to Monday
      } else { // Friday-Saturday
        week1Monday = new Date(jan1);
        week1Monday.setDate(jan1.getDate() + (8 - jan1Day)); // Next Monday
      }

      // Calculate the start of the requested week
      startOfDay = new Date(week1Monday);
      startOfDay.setDate(week1Monday.getDate() + (weekNum - 1) * 7);
      startOfDay.setHours(0, 0, 0, 0);

      // End of week is Sunday
      endOfDay = new Date(startOfDay);
      endOfDay.setDate(startOfDay.getDate() + 6);
      endOfDay.setHours(23, 59, 59, 999);
    } else if (date.length === 7 && date.match(/^\d{4}-\d{2}$/)) {
      // Monthly format: 2026-01
      const [year, month] = date.split("-").map(Number);
      startOfDay = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      // Last day of month
      endOfDay = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    } else {
      // Daily format: 2026-01-15
      startOfDay = new Date(date + "T00:00:00.000Z");
      endOfDay = new Date(date + "T23:59:59.999Z");
    }

    const matchConditions = {
      closed_date: { $gte: startOfDay, $lte: endOfDay },
    };

    // 1. Owner Filter
    if (owners && owners.length > 0 && owners !== "All") {
      const ownerList = owners.split(",").filter((o) => o.trim());
      if (ownerList.length > 0) matchConditions.owner = { $in: ownerList };
    }

    if (region && region !== "All") {
      matchConditions.region = {
        $in: region.split(",").filter((r) => r.trim()),
      };
    }

    // ✅ METRIC SPECIFIC FILTERS
    // For CSAT: Return ALL tickets so frontend can show "Good: X | Bad: Y | Total: Z"
    // (Don't filter by csat=2, let frontend calculate the breakdown)
    // For FRR: Return ALL tickets so frontend can show "X of Y met FRR"
    // (Don't filter by frr=1, let frontend calculate the breakdown)
    
    // For Backlog: Tickets older than 15 days
    if (metric === "backlog") {
      matchConditions.$expr = {
        $gt: [{ $subtract: ["$closed_date", "$created_date"] }, 15 * 86400000],
      };
    }

    // 3. Zendesk & Region
    if (excludeZendesk === "true") matchConditions.is_zendesk = { $ne: true };
    if (region && region.length > 0)
      matchConditions.region = { $in: region.split(",") };

    // NOC filter
    if (req.query.excludeNOC === "true") {
      matchConditions.is_noc = { $ne: true };
    }

    const tickets = await AnalyticsTicket.find(matchConditions)
      .sort({ closed_date: -1 })
      .limit(2000)
      .lean();

    await redisSet(cacheKey, { tickets }, CACHE_TTL.DRILLDOWN);
    res.json({ tickets, count: tickets.length });
  } catch (e) {
    console.error("❌ By-date fetch error:", e);
    res.status(500).json({ error: e.message, tickets: [] });
  }
});

const fetchAndCacheTickets = async (source = "auto") => {
  if (isSyncing) {
    syncQueued = true;
    return;
  }
  isSyncing = true;
  console.log("🔄 Syncing Active Tickets...");

  try {
    let collected = [],
      cursor = null,
      loop = 0,
      consecutiveInactiveBatches = 0; // Track batches without active tickets

    // ✅ Keep ALL active tickets + Solved tickets from Oct 2025 onwards
    const SOLVED_CUTOFF_DATE = new Date("2026-01-01"); // Keep solved tickets from Oct 2025

    // Helper function to process and filter tickets
    const processTickets = (tickets) => {
      return tickets
        .filter((t) => {
          const stage = t.stage?.name?.toLowerCase() || "";
          const isActive = stage.includes("waiting on assignee") ||
                          stage.includes("awaiting customer reply") ||
                          stage.includes("waiting on clevertap") ||
                          stage.includes("on hold") ||
                          stage.includes("pending") ||
                          stage.includes("open");

          if (isActive) return true;

          const isSolved = stage.includes("solved") ||
                          stage.includes("closed") ||
                          stage.includes("resolved");

          if (isSolved) {
            const createdDate = t.created_date ? parseISO(t.created_date) : null;
            return createdDate && createdDate >= SOLVED_CUTOFF_DATE;
          }
          return false;
        })
        .filter((t) => {
          const ownerName = t.owned_by?.[0]?.display_name?.toLowerCase() || "";
          return !ownerName.includes("anmol sawhney");
        })
        .map((t) => ({
          id: t.id,
          display_id: t.display_id,
          title: t.title,
          priority: t.priority,
          severity: t.severity,
          account: t.account?.display_name || t.account,
          stage: t.stage,
          owned_by: t.owned_by,
          created_date: t.created_date,
          modified_date: t.modified_date,
          custom_fields: t.custom_fields,
          tags: t.tags,
          isZendesk: t.tags?.some((tag) => tag.tag?.name === "Zendesk import"),
          actual_close_date: t.actual_close_date,
        }));
    };

    do {
      const response = await axios.get(
        `${DEVREV_API}/works.list?limit=50&type=ticket${
          cursor ? `&cursor=${cursor}` : ""
        }`,
        { headers: HEADERS, timeout: 30000 },
      );

      const newWorks = response.data.works || [];
      if (!newWorks.length) break;

      // Check if this batch has any active (non-solved) tickets
      const hasActiveTickets = newWorks.some((t) => {
        const stage = t.stage?.name?.toLowerCase() || "";
        return stage.includes("waiting on assignee") ||
               stage.includes("awaiting customer reply") ||
               stage.includes("waiting on clevertap") ||
               stage.includes("on hold") ||
               stage.includes("pending") ||
               stage.includes("open");
      });

      collected = [...collected, ...newWorks];

      // ✅ PROGRESSIVE LOADING: Cache first 3 batches (150 tickets) immediately for quick response
      if (loop === 0 || loop === 1 || loop === 2) {
        const processedSoFar = processTickets(collected);
        await redisSet("tickets:active:initial", processedSoFar, 60); // Short TTL for initial cache

        // Emit progress to frontend
        io.emit("SYNC_PROGRESS", {
          type: 'tickets',
          count: processedSoFar.length,
          progress: Math.min(30, (loop + 1) * 10), // Show 10%, 20%, 30% progress
          status: 'loading'
        });

        console.log(`📦 Cached initial ${processedSoFar.length} tickets (batch ${loop + 1})`);
      } else if (loop % 5 === 0) {
        // Emit progress updates every 5 batches
        const estimatedProgress = Math.min(90, 30 + Math.floor(loop / 5) * 10);
        io.emit("SYNC_PROGRESS", {
          type: 'tickets',
          count: collected.length,
          progress: estimatedProgress,
          status: 'loading'
        });
      }

      // ✅ EARLY EXIT: Stop only after MANY consecutive batches without active tickets
      // This ensures we don't miss old pending/on-hold tickets scattered in pagination
      if (!hasActiveTickets) {
        consecutiveInactiveBatches++;
        const lastDate = parseISO(newWorks[newWorks.length - 1].created_date);
        // Only break after 10+ consecutive batches with no active tickets AND old dates
        if (lastDate < SOLVED_CUTOFF_DATE && consecutiveInactiveBatches >= 10) {
          console.log(`⏹️ Early exit after ${consecutiveInactiveBatches} consecutive inactive batches`);
          break;
        }
      } else {
        // Reset counter when we find active tickets
        consecutiveInactiveBatches = 0;
      }

      cursor = response.data.next_cursor;
      loop++;
    } while (cursor && loop < 100);  // Keep at 100 to ensure we get all active tickets

    // ✅ FILTER: ALL Active tickets + Solved tickets from Oct 2025 onwards
    const activeTickets = processTickets(collected);

    // Log for debugging
    const solvedCount = activeTickets.filter((t) => {
      const stage = t.stage?.name?.toLowerCase() || "";
      return stage.includes("solved") || stage.includes("closed");
    }).length;

    // ✅ STORE IN REDIS ONLY (removed NodeCache to prevent double caching)
    await redisSet("tickets:active", activeTickets, CACHE_TTL.TICKETS);

    // Clear initial cache now that full cache is ready
    await redisDelete("tickets:active:initial");

    collected = null;
    if (global.gc) global.gc();
    console.log(
      `✅ ${activeTickets.length} tickets cached (${activeTickets.length - solvedCount} active, ${solvedCount} recently solved)`,
    );

    // ✅ PROGRESSIVE LOADING: Emit completion progress
    io.emit("SYNC_PROGRESS", {
      type: 'tickets',
      count: activeTickets.length,
      progress: 100,
      status: 'complete'
    });

    // ✅ FIX BROADCAST STORM: Send lightweight signal instead of full data array
    io.emit("DATA_UPDATED", {
      type: 'tickets',
      count: activeTickets.length,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error("❌ Sync Failed:", e.message);
  } finally {
    isSyncing = false;
    if (syncQueued) {
      syncQueued = false;
      fetchAndCacheTickets("queued");
    }
  }
};

// ============================================================================
// ✅ ACTIVE TICKETS - SIMPLIFIED & FAST
// ============================================================================
app.get("/api/tickets", async (req, res) => {
  try {
    // ✅ PROGRESSIVE LOADING: Try full cache first
    let cachedTickets = await redisGet("tickets:active");

    if (cachedTickets && cachedTickets.length > 0) {
      console.log(`⚡ Redis HIT (full): ${cachedTickets.length} tickets`);
      return res.json({
        tickets: cachedTickets,
        total: cachedTickets.length,
        isPartial: false
      });
    }

    // ✅ If full cache not available, try initial cache for quick response
    cachedTickets = await redisGet("tickets:active:initial");

    if (cachedTickets && cachedTickets.length > 0) {
      console.log(`⚡ Redis HIT (initial): ${cachedTickets.length} tickets - loading more in background`);

      // Start full sync in background if not already running
      if (!isSyncing) {
        fetchAndCacheTickets("background").catch(err =>
          console.error("Background sync failed:", err)
        );
      }

      return res.json({
        tickets: cachedTickets,
        total: cachedTickets.length,
        isPartial: true, // Flag to indicate more data is loading
        message: "Loading more tickets in background..."
      });
    }

    // ✅ CACHE MISS: Trigger sync and wait for initial batch
    console.log("⏳ Cache miss - syncing now");

    if (!isSyncing) {
      // Start sync (it will cache initial batch quickly)
      fetchAndCacheTickets("on_demand").catch(err =>
        console.error("Sync failed:", err)
      );

      // Wait a moment for initial batch to be cached
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Try to get initial batch
      const initialTickets = await redisGet("tickets:active:initial");
      if (initialTickets && initialTickets.length > 0) {
        return res.json({
          tickets: initialTickets,
          total: initialTickets.length,
          isPartial: true,
          message: "Loading more tickets in background..."
        });
      }
    }

    // Sync in progress, return empty but with loading indicator
    res.json({
      tickets: [],
      total: 0,
      isPartial: true,
      message: "Loading tickets..."
    });
  } catch (e) {
    console.error("❌ /api/tickets error:", e.message);
    res.status(500).json({ tickets: [], error: e.message });
  }
});

// ============================================================================
// NOC TICKETS ANALYTICS
// ============================================================================
app.get("/api/tickets/noc", async (req, res) => {
  try {
    const { startDate, endDate, rca, reporter } = req.query;

    // Build match conditions
    const matchConditions = {
      is_noc: true,
    };

    // Date range filter
    if (startDate && endDate) {
      matchConditions.closed_date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    // RCA filter
    if (rca && rca !== "all") {
      matchConditions.noc_rca = rca;
    }

    // Reporter filter
    if (reporter && reporter !== "all") {
      matchConditions.noc_reported_by = reporter;
    }

    // Fetch NOC tickets
    const nocTickets = await AnalyticsTicket.find(matchConditions)
      .select({
        display_id: 1,
        title: 1,
        owner: 1,
        noc_issue_id: 1,
        noc_jira_key: 1,
        noc_rca: 1,
        noc_reported_by: 1,
        noc_assignee: 1,
        closed_date: 1,
        created_date: 1,
      })
      .sort({ closed_date: -1 })
      .lean();

    // Get unique RCA values for filter dropdown
    const rcaValues = await AnalyticsTicket.distinct("noc_rca", { is_noc: true });
    const filteredRcaValues = rcaValues.filter(r => r != null && r !== "");

    // Get unique reporters for filter dropdown
    const reporterValues = await AnalyticsTicket.distinct("noc_reported_by", { is_noc: true });
    const filteredReporterValues = reporterValues.filter(r => r != null && r !== "");

    // Aggregate stats for pie charts
    // 1. By Reporter (who created more NOC)
    const byReporter = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $group: { _id: "$noc_reported_by", count: { $sum: 1 } } },
      { $match: { _id: { $ne: null } } },
      { $sort: { count: -1 } },
    ]);

    // 2. By RCA category
    const byRca = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $group: { _id: "$noc_rca", count: { $sum: 1 } } },
      { $match: { _id: { $ne: null } } },
      { $sort: { count: -1 } },
    ]);

    // 3. By Owner (who got more NOC tickets)
    const byOwner = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $group: { _id: "$owner", count: { $sum: 1 } } },
      { $match: { _id: { $ne: null } } },
      { $sort: { count: -1 } },
    ]);

    res.json({
      tickets: nocTickets,
      filters: {
        rcaOptions: filteredRcaValues,
        reporterOptions: filteredReporterValues,
      },
      stats: {
        total: nocTickets.length,
        byReporter: byReporter.map(r => ({ name: r._id, value: r.count })),
        byRca: byRca.map(r => ({ name: r._id, value: r.count })),
        byOwner: byOwner.map(r => ({ name: r._id, value: r.count })),
      },
    });
  } catch (e) {
    console.error("❌ /api/tickets/noc error:", e.message);
    res.status(500).json({ tickets: [], error: e.message });
  }
});

// Fetch linked issues for a ticket
app.post("/api/tickets/links", async (req, res) => {
  try {
    const { ticketId } = req.body; // e.g., "304218"

    // Get links for the ticket
    const linksRes = await axios.post(
      `${DEVREV_API}/links.list`,
      {
        object: `don:core:dvrv-us-1:devo/1iVu4ClfVV:ticket/${ticketId}`,
        object_types: ["issue"],
        limit: 10,
      },
      { headers: HEADERS },
    );

    const links = linksRes.data.links || [];

    if (links.length === 0) {
      return res.json({ hasDependency: false, issues: [] });
    }

    // Process linked issues
    const issues = links
      .map((link) => {
        const target = link.target;
        if (!target || target.type !== "issue") return null;

        return {
          issueId: target.display_id, // "ISS-125011"
          title: target.title,
          owner: target.owned_by?.[0]?.display_name || "Unassigned",
          ownerEmail: target.owned_by?.[0]?.email,
          priority: target.priority || target.priority_v2?.label,
          stage: target.stage?.name,
          jiraLink: target.sync_metadata?.external_reference,
        };
      })
      .filter(Boolean);

    res.json({ hasDependency: true, issues });
  } catch (e) {
    console.error("Links fetch error:", e.message);
    res.json({ hasDependency: false, issues: [], error: e.message });
  }
});

// Fetch full issue details
app.post("/api/issues/get", async (req, res) => {
  try {
    const { issueId } = req.body; // e.g., "ISS-125011"

    const issRes = await axios.post(
      `${DEVREV_API}/works.get`,
      { id: issueId },
      { headers: HEADERS },
    );

    const issue = issRes.data.work;
    if (!issue) {
      return res.json({ error: "Issue not found" });
    }

    // Extract team info from custom fields
    const customFields = issue.custom_fields || {};
    const subtype = issue.subtype || "";

    // Determine team based on various fields
    let team = "Unknown";
    if (customFields.ctype__issuetype === "PSN Task") {
      team = "NOC";
    } else if (customFields.ctype__team_involved) {
      team = customFields.ctype__team_involved; // "Whatsapp", "Billing", etc.
    } else if (subtype === "internal_clevertap_slack") {
      team = customFields.ctype__team_involved || "Internal";
    } else if (subtype.includes("email")) {
      team = "Email";
    } else if (subtype.includes("whatsapp")) {
      team = "Whatsapp";
    }

    res.json({
      issueId: issue.display_id,
      title: issue.title,
      owner: issue.owned_by?.[0]?.display_name || "Unassigned",
      ownerEmail: issue.owned_by?.[0]?.email,
      team,
      subtype,
      jiraKey: customFields.ctype__key, // "SUC-129121"
      jiraLink: issue.sync_metadata?.external_reference,
      rca: customFields.ctype__customfield_10169,
      priority: issue.priority_v2?.label || issue.priority,
      stage: issue.stage?.name,
      isNOC: customFields.ctype__issuetype === "PSN Task",
    });
  } catch (e) {
    console.error("Issue fetch error:", e.message);
    res.json({ error: e.message });
  }
});

// Batch fetch dependencies for multiple tickets (optimized)
app.post("/api/tickets/dependencies", async (req, res) => {
  try {
    const { ticketIds } = req.body; // Array of ticket IDs like ["304218", "305713"]

    const results = {};

    // Process in parallel with concurrency limit
    const BATCH_SIZE = 5;
    for (let i = 0; i < ticketIds.length; i += BATCH_SIZE) {
      const batch = ticketIds.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (ticketId) => {
          try {
            // Get links
            const linksRes = await axios.post(
              `${DEVREV_API}/links.list`,
              {
                object: `don:core:dvrv-us-1:devo/1iVu4ClfVV:ticket/${ticketId}`,
                object_types: ["issue"],
                limit: 10,
              },
              { headers: HEADERS },
            );

            const links = linksRes.data.links || [];

            if (links.length === 0) {
              results[ticketId] = { hasDependency: false, issues: [] };
              return;
            }

            // Get issue details for each link
            const issues = await Promise.all(
              links.map(async (link) => {
                const target = link.target;
                if (!target || target.type !== "issue") return null;

                try {
                  // Fetch full issue details
                  const issRes = await axios.post(
                    `${DEVREV_API}/works.get`,
                    { id: target.display_id },
                    { headers: HEADERS },
                  );

                  const issue = issRes.data.work;
                  if (!issue) return null;

                  const customFields = issue.custom_fields || {};

                  // Determine team
                  let team = "Other";
                  if (customFields.ctype__issuetype === "PSN Task") {
                    team = "NOC";
                  } else if (customFields.ctype__team_involved) {
                    team = customFields.ctype__team_involved;
                  } else if (issue.subtype === "internal_clevertap_slack") {
                    team = "Internal";
                  }

                  return {
                    issueId: issue.display_id,
                    title: issue.title,
                    owner: issue.owned_by?.[0]?.display_name || "Unassigned",
                    team,
                    isNOC: customFields.ctype__issuetype === "PSN Task",
                    jiraKey: customFields.ctype__key,
                    priority: issue.priority_v2?.label,
                    stage: issue.stage?.name,
                  };
                } catch (e) {
                  // Return basic info from link if full fetch fails
                  return {
                    issueId: target.display_id,
                    title: target.title,
                    owner: target.owned_by?.[0]?.display_name || "Unassigned",
                    team: "Unknown",
                    isNOC: false,
                  };
                }
              }),
            );

            const validIssues = issues.filter(Boolean);

            // Sort: NOC first, then others
            validIssues.sort((a, b) => {
              if (a.isNOC && !b.isNOC) return -1;
              if (!a.isNOC && b.isNOC) return 1;
              return 0;
            });

            results[ticketId] = {
              hasDependency: true,
              issues: validIssues,
              // Primary issue: NOC if exists, otherwise first issue
              primary: validIssues.find((i) => i.isNOC) || validIssues[0],
            };
          } catch (e) {
            results[ticketId] = {
              hasDependency: false,
              issues: [],
              error: e.message,
            };
          }
        }),
      );
    }

    res.json(results);
  } catch (e) {
    console.error("Dependencies batch fetch error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 2. ADD MANUAL SYNC ENDPOINT (Add after line 588)
app.post("/api/admin/sync-now", async (req, res) => {
  console.log("🔄 Manual sync triggered...");
  try {
    await syncHistoricalToDB(false);
    const count = await AnalyticsTicket.countDocuments();
    const latest = await AnalyticsTicket.findOne().sort({ closed_date: -1 });
    res.json({
      success: true,
      totalTickets: count,
      latestClosedDate: latest?.closed_date,
      message: `Synced successfully. Latest ticket: ${format(
        latest?.closed_date || new Date(),
        "MMM dd, yyyy",
      )}`,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 3. ADD SYNC STATUS ENDPOINT
app.get("/api/admin/sync-status", async (req, res) => {
  try {
    const count = await AnalyticsTicket.countDocuments();
    const latest = await AnalyticsTicket.findOne().sort({ closed_date: -1 });
    const oldest = await AnalyticsTicket.findOne().sort({ closed_date: 1 });

    // Check if data is stale (latest ticket is > 2 days old)
    const latestDate = latest?.closed_date;
    const isStale = latestDate
      ? Date.now() - new Date(latestDate).getTime() > 2 * 24 * 60 * 60 * 1000
      : true;

    res.json({
      totalTickets: count,
      latestClosedDate: latestDate,
      oldestClosedDate: oldest?.closed_date,
      isStale,
      message: isStale
        ? "⚠️ Data may be stale. Consider running manual sync."
        : "✅ Data is up to date",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const syncHistoricalToDB = async (fullHistory = false) => {
  console.log("📦 Syncing to MongoDB...");
  let cursor = null,
    loop = 0,
    processedCount = 0,
    nocCount = 0,
    skippedCount = 0;
  const TARGET_DATE = new Date("2025-10-01");  // Extended to Oct 1 to catch more historical tickets
  const NOC_CHECK_DATE = new Date("2026-01-01"); // Only check NOC for tickets >= Jan 1, 2026

  do {
    try {
      const res = await axios.get(
        `${DEVREV_API}/works.list?limit=50&type=ticket${cursor ? `&cursor=${cursor}` : ""}`,
        { headers: HEADERS },
      );
      const works = res.data.works || [];
      if (!works.length) break;
      if (
        new Date(works[works.length - 1].created_date) < TARGET_DATE &&
        !fullHistory
      )
        break;

      const solved = works.filter((t) => {
        const stage = t.stage?.name?.toLowerCase() || "";
        return (
          (stage.includes("solved") ||
            stage.includes("closed") ||
            stage.includes("resolved")) &&
          t.actual_close_date
        );
      });

      if (solved.length) {
        const ops = [];

        for (const t of solved) {

          if (new Date(t.actual_close_date) < TARGET_DATE) {
            continue;
          }
          const ownerRaw = t.owned_by?.[0]?.display_name || "";

          // Resolve owner - returns null for non-GST
          const owner = resolveOwnerName(ownerRaw);
          if (!owner) {
            skippedCount++;
            continue; // Skip non-GST members
          }

          // CSAT
          const csatRaw = t.custom_fields?.tnt__csatrating;
          let csatVal = 0;
          if (csatRaw == 1 || csatRaw == "1") csatVal = 1;
          if (csatRaw == 2 || csatRaw == "2") csatVal = 2;

          // FRR
          let frrVal = 0;
          if (t.custom_fields?.tnt__frr === true) frrVal = 1;
          const iterations = t.custom_fields?.tnt__iteration_count;
          if (iterations === 1) frrVal = 1;

          // NOC Detection - Only for tickets closed >= Jan 1, 2026

          let isNoc = false;
          let nocIssueId = null;
          let nocJiraKey = null;
          let nocRca = null;
          let nocReportedBy = null;
          let nocAssignee = null; // NEW

          const closedDate = new Date(t.actual_close_date);
          if (closedDate >= NOC_CHECK_DATE) {
            try {
              // Step 1: Get linked issues using links.list
              const linksRes = await axios.post(
                `${DEVREV_API}/links.list`,
                {
                  object: t.id,
                  object_types: ["issue"],
                  limit: 10,
                },
                { headers: HEADERS },
              );
              const links = linksRes.data.links || [];

              // Step 2: Check each linked issue
              for (const link of links) {
                const issueId =
                  link.target?.display_id || link.source?.display_id;
                if (!issueId || !issueId.startsWith("ISS-")) continue;

                try {
                  // Step 3: Get issue details using works.get
                  const issRes = await axios.post(
                    `${DEVREV_API}/works.get`,
                    { id: issueId },
                    { headers: HEADERS },
                  );
                  const issue = issRes.data.work;

                  // Check if it's a NOC issue (PSN Task)
                  // Check if it's a NOC issue (PSN Task)
                  if (issue?.custom_fields?.ctype__issuetype === "PSN Task") {
                    isNoc = true;
                    nocIssueId = issue.display_id;
                    nocJiraKey = issue.custom_fields?.ctype__key || null;
                    nocRca =
                      issue.custom_fields?.ctype__customfield_10169 || null;
                    nocReportedBy =
                      issue.reported_by?.[0]?.display_name || null;
                    nocAssignee = issue.owned_by?.[0]?.display_name || null; // NEW: Get assignee
                    nocCount++;
                    console.log(
                      `   ✓ NOC: ${t.display_id} → ${nocIssueId}, Assignee: ${nocAssignee}, RCA: ${nocRca}`,
                    );
                    break;
                  }
                } catch (e) {
                  // Ignore individual issue fetch errors
                }
              }
            } catch (e) {
              // Ignore links fetch errors
            }
          }

          ops.push({
            updateOne: {
              filter: { ticket_id: t.display_id },
              update: {
                $set: {
                  ticket_id: t.display_id,
                  display_id: t.display_id,
                  title: t.title,
                  created_date: new Date(t.created_date),
                  closed_date: new Date(t.actual_close_date),
                  owner,
                  region: t.custom_fields?.tnt__region_salesforce || "Unknown",
                  priority: t.priority,
                  is_zendesk: t.tags?.some(
                    (tag) => tag.tag?.name === "Zendesk import",
                  ),
                  is_noc: isNoc,
                  noc_issue_id: nocIssueId,
                  noc_jira_key: nocJiraKey,
                  noc_rca: nocRca,
                  noc_reported_by: nocReportedBy,
                  noc_assignee: nocAssignee,
                  rwt: t.custom_fields?.tnt__rwt_business_hours ?? null,
                  frt: t.custom_fields?.tnt__frt_hours ?? null,
                  iterations: iterations ?? null,
                  csat: csatVal,
                  frr: frrVal,
                  account_name:
                    t.custom_fields?.tnt__instance_account_name ||
                    t.account?.display_name ||
                    "Unknown",
                },
              },
              upsert: true,
            },
          });
        }

        if (ops.length > 0) {
          await AnalyticsTicket.bulkWrite(ops);
          processedCount += ops.length;
          console.log(
            `   📊 Batch done: ${processedCount} synced, ${nocCount} NOC, ${skippedCount} skipped`,
          );
        }
      }
      cursor = res.data.next_cursor;
      loop++;
    } catch (e) {
      console.error("Sync Error:", e.message);
      break;
    }
  } while (cursor && loop < 1000);

  // Clear all caches
  await Promise.all([
    AnalyticsCache.deleteMany({}),
    redisDelete("analytics:*"),
    redisDelete("livestats:*"),
    redisDelete("bydate:*"),
    redisDelete("tickets:*"),
  ]);
  console.log(
    `✅ SYNC COMPLETE: ${processedCount} GST tickets, ${nocCount} NOC tickets, ${skippedCount} non-GST skipped. Caches cleared.`,
  );
};

// ✅ PRODUCTION MONITORING: Track server health and usage
const serverMetrics = {
  startTime: Date.now(),
  requests: 0,
  coldStarts: 0,
  lastRequest: null,
};

// Health check with comprehensive monitoring
app.get("/api/health", async (req, res) => {
  serverMetrics.requests++;
  serverMetrics.lastRequest = Date.now();

  // Detect cold start (server started < 30s ago)
  const isColdStart = process.uptime() < 30;
  if (isColdStart && serverMetrics.requests === 1) {
    serverMetrics.coldStarts++;
  }

  const mongoStatus =
    mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  const redisStatus = redis?.status || "disconnected";

  res.json({
    status: isServerReady ? "ok" : "starting",
    server: {
      uptime: process.uptime(),
      startedAt: new Date(serverMetrics.startTime).toISOString(),
      isColdStart,
      isReady: isServerReady,
      cacheWarming: cacheWarmingStarted,
    },
    services: {
      mongodb: mongoStatus,
      redis: redisStatus,
    },
    metrics: {
      totalRequests: serverMetrics.requests,
      coldStarts: serverMetrics.coldStarts,
      lastRequest: serverMetrics.lastRequest
        ? new Date(serverMetrics.lastRequest).toISOString()
        : null,
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + " MB",
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + " MB",
    },
  });
});

// Webhooks & Admin
app.post("/api/webhooks/devrev", (req, res) => {
  const event = req.body;
  if (event.type === "webhook_verify")
    return res.json({ challenge: event.challenge });
  if (["work_created", "work_updated", "work_deleted"].includes(event.type)) {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => fetchAndCacheTickets("webhook"), 5000);
  }
  res.send("OK");
});

app.post("/api/admin/search", async (req, res) => {
  try {
    const { query = {}, page = 1, pageSize = 50 } = req.body;

    console.log("🔍 Admin Search:", JSON.stringify(query, null, 2));

    // Process date strings in query
    const processedQuery = { ...query };
    if (processedQuery.closed_date) {
      if (processedQuery.closed_date.$gte) {
        processedQuery.closed_date.$gte = new Date(
          processedQuery.closed_date.$gte,
        );
      }
      if (processedQuery.closed_date.$lte) {
        processedQuery.closed_date.$lte = new Date(
          processedQuery.closed_date.$lte,
        );
      }
    }

    // Get total count first
    const totalCount = await AnalyticsTicket.countDocuments(processedQuery);

    // Fetch paginated results
    const skip = (page - 1) * pageSize;
    const tickets = await AnalyticsTicket.find(processedQuery)
      .sort({ closed_date: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean();

    // Calculate stats from ALL matching tickets (not just current page)
    const allTickets = await AnalyticsTicket.find(processedQuery).lean();

    const stats = {
      totalTickets: allTickets.length,
      totalRWT: 0,
      rwtValidCount: 0,
      totalFRT: 0,
      frtValidCount: 0,
      totalIterations: 0,
      iterationsValidCount: 0,
      goodCSATCount: 0,
      badCSATCount: 0,
      frrMetCount: 0,
    };

    allTickets.forEach((t) => {
      if (t.rwt != null && t.rwt > 0) {
        stats.totalRWT += t.rwt;
        stats.rwtValidCount++;
      }
      if (t.frt != null && t.frt > 0) {
        stats.totalFRT += t.frt;
        stats.frtValidCount++;
      }
      if (t.iterations != null) {
        stats.totalIterations += t.iterations;
        stats.iterationsValidCount++;
      }
      if (t.csat === 2) stats.goodCSATCount++;
      if (t.csat === 1) stats.badCSATCount++;
      if (t.frr === 1) stats.frrMetCount++;
    });

    stats.avgRWT =
      stats.rwtValidCount > 0 ? stats.totalRWT / stats.rwtValidCount : 0;
    stats.avgFRT =
      stats.frtValidCount > 0 ? stats.totalFRT / stats.frtValidCount : 0;
    stats.avgIterations =
      stats.iterationsValidCount > 0
        ? stats.totalIterations / stats.iterationsValidCount
        : 0;

    res.json({
      query: processedQuery,
      stats,
      tickets,
      totalCount,
      page,
      pageSize,
      totalPages: Math.ceil(totalCount / pageSize),
    });
  } catch (e) {
    console.error("Admin search error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/debug-stats", async (req, res) => {
  try {
    const { owner, quarter = "Q1_26" } = req.query;

    const { start, end } = getQuarterDateRange(quarter);

    const query = {
      closed_date: { $gte: start, $lte: end },
    };

    if (owner) {
      query.owner = { $regex: owner, $options: "i" };
    }

    const tickets = await AnalyticsTicket.find(query).lean();

    // Manual calculation matching your MongoDB script
    const stats = {
      totalTickets: tickets.length,
      totalRWT: 0,
      rwtValidCount: 0,
      rwtFaultyCount: 0,
      totalFRT: 0,
      frtValidCount: 0,
      frtFaultyCount: 0,
      totalIterations: 0,
      iterationsValidCount: 0,
      iterationsFaultyCount: 0,
      goodCSATCount: 0,
      csatValidCount: 0,
      csatFaultyCount: 0,
      frrMetCount: 0,
      frrFalsyCount: 0,
      owner: owner || "All",
    };

    tickets.forEach((t) => {
      // RWT
      if (t.rwt !== null && t.rwt !== undefined && t.rwt > 0) {
        stats.totalRWT += t.rwt;
        stats.rwtValidCount++;
      } else {
        stats.rwtFaultyCount++;
      }

      // FRT
      if (t.frt !== null && t.frt !== undefined && t.frt > 0) {
        stats.totalFRT += t.frt;
        stats.frtValidCount++;
      } else {
        stats.frtFaultyCount++;
      }

      // Iterations
      if (t.iterations !== null && t.iterations !== undefined) {
        stats.totalIterations += t.iterations;
        stats.iterationsValidCount++;
      } else {
        stats.iterationsFaultyCount++;
      }

      // CSAT
      if (t.csat === 2) {
        stats.goodCSATCount++;
        stats.csatValidCount++;
      } else if (t.csat === 1) {
        stats.csatValidCount++;
      } else {
        stats.csatFaultyCount++;
      }

      // FRR
      if (t.frr === 1) {
        stats.frrMetCount++;
      } else {
        stats.frrFalsyCount++;
      }
    });

    stats.avgRWT =
      stats.rwtValidCount > 0 ? stats.totalRWT / stats.rwtValidCount : 0;
    stats.avgFRT =
      stats.frtValidCount > 0 ? stats.totalFRT / stats.frtValidCount : 0;
    stats.avgIterations =
      stats.iterationsValidCount > 0
        ? stats.totalIterations / stats.iterationsValidCount
        : 0;

    console.log("📊 Debug Stats:", stats);

    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/tickets/sync", (req, res) => {
  fetchAndCacheTickets("manual");
  res.json({ success: true });
});
app.post("/api/admin/backfill", (req, res) => {
  syncHistoricalToDB(true);
  res.json({ message: "Started" });
});
app.post("/api/admin/clear-cache", async (req, res) => {
  await AnalyticsCache.deleteMany({});
  res.json({ message: "Cleared" });
});

// Auth
app.post("/api/auth/google", async (req, res) => {
  try {
    const ticket = await client.verifyIdToken({
      idToken: req.body.credential,
      audience: GOOGLE_CLIENT_ID,
    });
    res.json({ success: true, user: ticket.getPayload(), token: "jwt" });
  } catch (e) {
    res.status(400).json({ error: "Invalid Token" });
  }
});
app.get("/api/auth/config", (req, res) =>
  res.json({ clientId: GOOGLE_CLIENT_ID }),
);

// Remarks
app.get("/api/remarks/:ticketId", async (req, res) => {
  const remarks = await Remark.find({ ticketId: req.params.ticketId }).sort({
    timestamp: 1,
  });
  res.json(remarks);
});
app.post("/api/remarks", async (req, res) => {
  const { ticketId, user, text } = req.body;
  const remark = await Remark.create({ ticketId, user, text });
  res.json({ success: true, remark });
});
app.post("/api/comments", async (req, res) => {
  try {
    const resp = await axios.post(
      "https://api.devrev.ai/timeline-entries.create",
      {
        object: req.body.ticketId,
        type: "timeline_comment",
        body: req.body.body,
        visibility: "internal",
      },
      { headers: HEADERS },
    );
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: "Failed" });
  }
});

// Views
app.get("/api/views/:userId", async (req, res) =>
  res.json(
    await View.find({ userId: req.params.userId }).sort({ createdAt: -1 }),
  ),
);
app.post("/api/views", async (req, res) => {
  const view = await View.create(req.body);
  res.json({ success: true, view });
});
app.delete("/api/views/:userId/:viewId", async (req, res) => {
  await View.findByIdAndDelete(req.params.viewId);
  res.json({ success: true });
});

// Roster
let ROSTER_ROWS = [],
  DATE_COL_MAP = {};
let LEVEL_COL_IDX = -1;
// [backend/server.js] - Replace the syncRoster function with this:

const syncRoster = async () => {
  console.log("🔄 Roster Sync...");

  // 1. SAFETY CHECK
  if (!process.env.GOOGLE_SHEETS_KEY_BASE64) {
    console.error("❌ FATAL: GOOGLE_SHEETS_KEY_BASE64 is missing");
    return;
  }

  try {
    const decodedKey = Buffer.from(
      process.env.GOOGLE_SHEETS_KEY_BASE64,
      "base64",
    ).toString();
    const creds = JSON.parse(decodedKey);

    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    // Fetch Data
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: process.env.ROSTER_SHEET_ID,
    });
    const sheetName = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.ROSTER_SHEET_ID,
      range: `'${sheetName}'!A1:AZ100`,
    });
    const rows = resp.data.values || [];

    // Find Header Row
    let headerIdx = rows.findIndex((r) =>
      r.some(
        (c) =>
          String(c).toLowerCase().includes("designation") ||
          String(c).toLowerCase().includes("level"),
      ),
    );
    if (headerIdx === -1) {
      console.log("⚠️ Could not find header row in Roster");
      return;
    }

    // Map Columns
    DATE_COL_MAP = {};
    const headerRow = rows[headerIdx];

    // ✅ FIX: Loop through columns correctly
    headerRow.forEach((col, i) => {
      const colName = String(col).trim(); // Define colName here!

      // Map Dates (e.g., "01-Jan")
      if (colName.includes("-") || colName.includes("Jan")) {
        DATE_COL_MAP[colName] = i;
      }

      // Map Level/Designation
      if (
        colName.toLowerCase().includes("designation") ||
        colName.toLowerCase().includes("level")
      ) {
        LEVEL_COL_IDX = i;
        console.log(`✅ Level/Designation found at column ${i}`);
      }
    });

    ROSTER_ROWS = rows.slice(headerIdx + 1).filter((r) => r[0]?.length > 2);
    console.log(`✅ ${ROSTER_ROWS.length} engineers loaded`);
  } catch (e) {
    console.error("Roster error:", e.message);
  }
};

app.post("/api/profile/status", (req, res) => {
  const { userName } = req.body;
  const dateKey = format(new Date(), "d-MMM");
  const colIdx = DATE_COL_MAP[dateKey];
  const row = ROSTER_ROWS.find((r) =>
    r[0]?.toLowerCase().includes(userName?.toLowerCase()),
  );
  const shift = row?.[colIdx]?.toUpperCase() || "?";
  const isActive = !["WO", "L", "PL", ""].includes(shift);
  res.json({ isActive, shift, status: isActive ? "On Shift" : "Off" });
});

// ============================================================================
// API: GET BACKUP FOR A SPECIFIC USER (From Their Team)
// ============================================================================
app.get("/api/roster/backup", async (req, res) => {
  try {
    const { userName, teamOnly = "true" } = req.query;
    const istNow = getISTTime();
    const dateKey = format(istNow, "d-MMM");
    const colIdx = DATE_COL_MAP[dateKey];
    const currentHour = getCurrentISTHour();
    const dayOfWeek = istNow.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    console.log(`🕐 Backup API: IST Time = ${istNow.toISOString()}, Hour = ${currentHour.toFixed(2)}, Date = ${dateKey}`);

    // Check if roster data is loaded
    if (!ROSTER_ROWS || ROSTER_ROWS.length === 0) {
      return res.status(503).json({
        backup: null,
        error: "Roster data not loaded. Please try again later.",
        message: "Roster data is still loading.",
      });
    }

    // Check if date column exists
    if (!colIdx && colIdx !== 0) {
      console.warn(`⚠️ Date column not found for ${dateKey}. Available dates: ${Object.keys(DATE_COL_MAP).slice(0, 5).join(", ")}...`);
      return res.status(503).json({
        backup: null,
        error: `Roster column for ${dateKey} not found.`,
        message: "Today's roster data not available.",
      });
    }

    // Helper to get shift status details for a roster row
    const getShiftStatus = (row) => {
      const rawShift = colIdx ? (row[colIdx] || "").trim() : "";
      const shift = rawShift.toUpperCase();

      // Check if off
      if (OFF_STATUSES.includes(shift)) {
        return {
          isOnShift: false,
          shift: shift,
          reason: OFF_STATUS_MAP[shift] || "Away"
        };
      }

      // Normalize shift name - extract shift number
      const shiftMatch = shift.match(/(?:SHIFT\s*)?(\d)/i);
      const shiftNum = shiftMatch ? shiftMatch[1] : null;
      const shiftKey = shiftNum ? `SHIFT ${shiftNum}` : shift.replace(/\s+/g, " ").trim();

      const hours = SHIFT_HOURS[shiftKey];

      if (hours) {
        let isActive;
        if (hours.overnight) {
          isActive = currentHour >= hours.start || currentHour < hours.end;
        } else {
          isActive = currentHour >= hours.start && currentHour < hours.end;
        }
        console.log(`   ${row[0]}: ${shiftKey} (${hours.start}-${hours.end}), currentHour=${currentHour.toFixed(2)}, isActive=${isActive}`);
        return {
          isOnShift: isActive,
          shift: shiftKey,
          reason: isActive ? null : `Not in ${shiftKey} hours`
        };
      }

      console.log(`⚠️ Unknown shift format: "${rawShift}" for ${row[0]}`);
      return { isOnShift: false, shift: rawShift, reason: `Unknown shift: ${rawShift}` };
    };

    // Build FLAT_TEAM_MAP from TEAM_GROUPS
    const FLAT_TEAM_MAP = {};
    Object.entries(TEAM_GROUPS).forEach(([lead, members]) => {
      Object.entries(members).forEach(([id, name]) => {
        FLAT_TEAM_MAP[id] = name;
      });
    });

    let userTeam = null;
    let teamMembers = [];
    let userRole = "L1";
    let userShiftStatus = null;

    if (userName) {
      const mapping = TEAM_MAPPING[userName];
      if (mapping) {
        userTeam = mapping.team;
        teamMembers = mapping.members.filter(m => m !== userName);
      }
      userRole = DESIGNATION_MAP[userName] || "L1";

      // Find user's current shift status
      const rosterName = NAME_TO_ROSTER_MAP[userName] || userName;
      const userRow = ROSTER_ROWS.find((r) =>
        r[0]?.toLowerCase() === rosterName?.toLowerCase()
      );
      if (userRow) {
        userShiftStatus = getShiftStatus(userRow);
        console.log(`   User ${userName} (roster: ${rosterName}): shift=${userShiftStatus.shift}, isOnShift=${userShiftStatus.isOnShift}`);
      } else {
        console.log(`⚠️ User ${userName} not found in roster (tried: ${rosterName})`);
      }
    }

    // If user is available (on shift), they don't need a backup
    if (userShiftStatus?.isOnShift) {
      // Get user's urgent ticket count for display
      const tickets = await redisGet("tickets:active") || [];
      let userUrgentCount = 0;

      tickets.forEach((t) => {
        const stageName = (t.stage?.name || "").toLowerCase();
        // Only count OPEN tickets (Waiting on Assignee)
        if (!stageName.includes("waiting on assignee") && !stageName.includes("open")) return;

        const priority = (t.priority || "").toLowerCase();
        // Only count blocker or high priority
        if (priority !== "blocker" && priority !== "high") return;

        const ownerName = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
                          t.owned_by?.[0]?.display_name || "";
        if (ownerName.toLowerCase() === userName.toLowerCase()) {
          userUrgentCount++;
        }
      });

      return res.json({
        backup: null,
        needsBackup: false,
        userStatus: {
          isAvailable: true,
          shift: userShiftStatus.shift,
          urgentTickets: userUrgentCount,
        },
        message: `${userName} is available and working.`,
        team: userTeam,
      });
    }

    // User is NOT available - find backup
    // Get active engineers from same role (L1 -> L1, L2 -> L2)
    const activeEngineers = ROSTER_ROWS.filter((row) => {
      if (!row[0] || !row[1]) return false;

      // If teamOnly, filter to team members
      if (teamOnly === "true" && teamMembers.length > 0) {
        const isTeamMember = teamMembers.some(m =>
          m.toLowerCase() === row[0].toLowerCase()
        );
        if (!isTeamMember) return false;
      }

      // Check if on shift
      const status = getShiftStatus(row);
      if (!status.isOnShift) return false;

      // On weekends, only include those explicitly working today
      if (isWeekend) {
        const shift = colIdx ? (row[colIdx] || "").toUpperCase().trim() : "";
        // Must have an actual shift assignment (not off status)
        if (OFF_STATUSES.includes(shift) || !shift) return false;
      }

      // Match role: L1 backup for L1, L2 backup for L2
      const memberName = row[0];
      const memberRole = DESIGNATION_MAP[memberName] || "L1";
      return memberRole === userRole;

    }).map((row) => ({
      name: row[0],
      email: row[1],
      role: DESIGNATION_MAP[row[0]] || "L1",
      shift: colIdx ? row[colIdx] : "Unknown",
    }));

    if (activeEngineers.length === 0) {
      return res.json({
        backup: null,
        needsBackup: true,
        userStatus: {
          isAvailable: false,
          reason: userShiftStatus?.reason || "Away",
          shift: userShiftStatus?.shift,
        },
        message: `No ${userRole} teammates currently on shift.`,
        team: userTeam,
      });
    }

    // Calculate workload - count OPEN tickets only
    const tickets = await redisGet("tickets:active") || [];
    const workloadMap = {};
    const urgentWorkloadMap = {};
    activeEngineers.forEach((eng) => {
      workloadMap[eng.name.toLowerCase()] = 0;
      urgentWorkloadMap[eng.name.toLowerCase()] = 0;
    });

    tickets.forEach((t) => {
      const stageName = (t.stage?.name || "").toLowerCase();
      // Only count OPEN tickets (Waiting on Assignee)
      const isOpen = stageName.includes("waiting on assignee") ||
                     (stageName.includes("open") && !stageName.includes("closed"));

      if (!isOpen) return;

      const ownerName = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
                        t.owned_by?.[0]?.display_name || "";
      if (ownerName) {
        const nameKey = ownerName.toLowerCase();
        if (workloadMap.hasOwnProperty(nameKey)) {
          workloadMap[nameKey]++;

          // Track urgent tickets separately (blocker or high priority)
          const priority = (t.priority || "").toLowerCase();
          if (priority === "blocker" || priority === "high") {
            urgentWorkloadMap[nameKey]++;
          }
        }
      }
    });

    // Sort by least open tickets first (smart backup selection)
    activeEngineers.sort((a, b) => {
      return workloadMap[a.name.toLowerCase()] - workloadMap[b.name.toLowerCase()];
    });

    const backup = activeEngineers[0];

    res.json({
      backup: {
        name: backup.name,
        email: backup.email,
        role: backup.role,
        shift: backup.shift,
        currentLoad: workloadMap[backup.name.toLowerCase()],
        urgentTickets: urgentWorkloadMap[backup.name.toLowerCase()],
      },
      needsBackup: true,
      userStatus: {
        isAvailable: false,
        reason: userShiftStatus?.reason || "Away",
        shift: userShiftStatus?.shift,
      },
      team: userTeam,
      allCandidates: activeEngineers.map((e) => ({
        name: e.name,
        role: e.role,
        shift: e.shift,
        load: workloadMap[e.name.toLowerCase()],
        urgentTickets: urgentWorkloadMap[e.name.toLowerCase()],
      })),
    });
  } catch (e) {
    console.error("❌ Backup Error:", e);
    res.status(500).json({ backup: null, error: e.message });
  }
});

// ============================================================================
// GAMIFICATION - Performance Leaderboard (Per-Metric Percentile Based)
// ============================================================================
app.get("/api/gamification", async (req, res) => {
  try {
    const { quarter = "Q1_26" } = req.query;
    const { start, end } = getQuarterDateRange(quarter);

    console.log(`🎮 Gamification: ${quarter} (${start.toDateString()} - ${end.toDateString()})`);

    // Get stats from MongoDB grouped by owner - EXCLUDE NOC TICKETS
    const stats = await AnalyticsTicket.aggregate([
      {
        $match: {
          closed_date: { $gte: start, $lte: end },
          owner: { $nin: [null, ""] },
          is_noc: { $ne: true } // Exclude NOC tickets
        }
      },
      {
        $group: {
          _id: "$owner",
          solved: { $sum: 1 },
          avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
          avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } }, // DSAT count
          frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
        },
      },
    ]);

    // Team mapping (for gamification display)
    const TEAM_MAP = {
      "Debashish": "Debashish", "Anurag": "Debashish", "Musaveer": "Debashish", "Shubhankar": "Debashish",
      "Tuaha Khan": "Tuaha", "Harsh": "Tuaha", "Tamanna": "Tuaha", "Shreyas": "Tuaha",
      "Shweta": "Shweta", "Aditya": "Shweta", "Nikita": "Shweta",
      "Rohan": "Mashnu", "Archie": "Mashnu", "Neha": "Mashnu", "Shreya": "Mashnu",
      "Abhishek": "Mashnu", "Adarsh": "Mashnu", "Vaibhav": "Mashnu", "Adish": "Adish",
    };

    // Map ticket owner names to roster names (for names that don't match exactly)
    const NAME_TO_ROSTER_MAP = {
      "Tuaha Khan": "Tuaha",
      // Add more mappings here if needed
    };

    // Get today's date at midnight for comparison
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today

    // Calculate days worked from roster - ONLY count actual shift days up to today
    const getDaysWorked = (name) => {
      // First try to map the name to roster name
      const rosterName = NAME_TO_ROSTER_MAP[name] || name;

      const row = ROSTER_ROWS.find(r => r[0]?.toLowerCase() === rosterName.toLowerCase());
      if (!row) {
        console.log(`⚠️ getDaysWorked: No roster row found for "${name}" (searched as "${rosterName}")`);
        return 0;
      }

      let days = 0;
      // ON CALL is NOT a working day - only count actual shifts
      const VALID_SHIFTS = ["SHIFT 1", "SHIFT 2", "SHIFT 3", "SHIFT 4"];

      // Iterate through date columns using DATE_COL_MAP
      for (const [dateKey, colIdx] of Object.entries(DATE_COL_MAP)) {
        // Parse the date from DATE_COL_MAP key (format: "01-Jan", "02-Jan", etc.)
        // or it might be an Excel serial number
        let colDate;
        if (typeof dateKey === 'number' || !isNaN(Number(dateKey))) {
          // Excel serial date (days since 1900-01-01, but Excel has a bug for dates before 1900-03-01)
          const excelSerial = Number(dateKey);
          colDate = new Date((excelSerial - 25569) * 86400 * 1000); // Convert Excel serial to JS Date
        } else {
          // Parse date string like "01-Jan"
          const currentYear = today.getFullYear();
          const parsed = new Date(`${dateKey}-${currentYear}`);
          colDate = isNaN(parsed.getTime()) ? null : parsed;
        }

        // Only count if date is within the quarter range AND not in the future
        if (colDate && colDate >= start && colDate <= today) {
          const val = (row[colIdx] || "").toUpperCase().trim();
          if (VALID_SHIFTS.includes(val)) {
            days++;
          }
        }
      }
      return days;
    };

    // Build initial data
    const data = { L1: [], L2: [] };

    stats.forEach(s => {
      const name = s._id;
      const designation = DESIGNATION_MAP[name] || "L1";
      const team = TEAM_MAP[name] || "Unknown";
      const daysWorked = getDaysWorked(name);
      const productivity = daysWorked > 0 ? parseFloat((s.solved / daysWorked).toFixed(2)) : 0;
      // CSAT % is 100% by default. Only changes if DSAT (negativeCSAT) is absorbed and solved.
      // Formula: If no DSAT → 100%, else → positiveCSAT / (positiveCSAT + negativeCSAT) * 100
      const csatPercent = s.negativeCSAT > 0
        ? Math.round((s.positiveCSAT / (s.positiveCSAT + s.negativeCSAT)) * 100)
        : 100;
      const frrPercent = s.solved > 0 ? Math.round((s.frrMet / s.solved) * 100) : 0;

      const entry = {
        name,
        team,
        designation,
        daysWorked,
        solved: s.solved,
        // Raw metrics
        productivity,
        csatPercent,
        positiveCSAT: s.positiveCSAT,
        avgRWT: s.avgRWT ? parseFloat(s.avgRWT.toFixed(1)) : 0,
        avgIterations: s.avgIterations ? parseFloat(s.avgIterations.toFixed(2)) : 0,
        frrPercent,
      };

      if (designation === "L2") {
        data.L2.push(entry);
      } else {
        data.L1.push(entry);
      }
    });

    // =========================================================================
    // STEP 1: Calculate per-metric PERCENTILES (for DISPLAY ONLY, not scoring)
    // =========================================================================
    const calculateMetricPercentiles = (arr, metricKey, lowerIsBetter = false) => {
      const total = arr.length;
      if (total === 0) return;

      // Sort by metric value
      const sorted = [...arr].sort((a, b) => {
        if (lowerIsBetter) {
          return a[metricKey] - b[metricKey]; // Lower is better = rank 1
        }
        return b[metricKey] - a[metricKey]; // Higher is better = rank 1
      });

      // Assign ranks and percentiles (FOR DISPLAY ONLY)
      sorted.forEach((entry, idx) => {
        const rank = idx + 1;
        const original = arr.find(e => e.name === entry.name);
        if (original) {
          original[`${metricKey}Rank`] = rank;
          // Percentile for display: ((Total - Rank + 1) / Total) × 100
          original[`${metricKey}Percentile`] = Math.round(((total - rank + 1) / total) * 100);
        }
      });
    };

    // Calculate display percentiles for L1
    calculateMetricPercentiles(data.L1, "productivity", false);
    calculateMetricPercentiles(data.L1, "csatPercent", false);
    calculateMetricPercentiles(data.L1, "positiveCSAT", false);
    calculateMetricPercentiles(data.L1, "avgRWT", true);
    calculateMetricPercentiles(data.L1, "avgIterations", true);
    calculateMetricPercentiles(data.L1, "frrPercent", false);

    // Calculate display percentiles for L2
    calculateMetricPercentiles(data.L2, "productivity", false);
    calculateMetricPercentiles(data.L2, "csatPercent", false);
    calculateMetricPercentiles(data.L2, "positiveCSAT", false);
    calculateMetricPercentiles(data.L2, "avgRWT", true);
    calculateMetricPercentiles(data.L2, "avgIterations", true);
    calculateMetricPercentiles(data.L2, "frrPercent", false);

    // =========================================================================
    // STEP 2: Calculate NORMALIZED SCORES (0-100) using Min-Max normalization
    // This is what MUST be used for weighted scoring (NOT percentiles)
    // =========================================================================
    const calculateNormalizedScores = (arr) => {
      if (arr.length === 0) return;

      // Define metrics with their normalization direction
      const metrics = [
        { key: "productivity", lowerIsBetter: false },
        { key: "csatPercent", lowerIsBetter: false },
        { key: "positiveCSAT", lowerIsBetter: false },
        { key: "avgRWT", lowerIsBetter: true },
        { key: "avgIterations", lowerIsBetter: true },
        { key: "frrPercent", lowerIsBetter: false },
      ];

      metrics.forEach(({ key, lowerIsBetter }) => {
        // Extract all values for this metric
        const values = arr.map(e => e[key] || 0);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min;

        arr.forEach(e => {
          const value = e[key] || 0;
          let normalizedScore;

          if (range === 0) {
            // All values are the same - everyone gets 100 (equal performance)
            normalizedScore = 100;
          } else if (lowerIsBetter) {
            // INVERTED: Lower raw value = Higher score
            // Formula: ((max - value) / range) × 100
            normalizedScore = ((max - value) / range) * 100;
          } else {
            // STANDARD: Higher raw value = Higher score
            // Formula: ((value - min) / range) × 100
            normalizedScore = ((value - min) / range) * 100;
          }

          // Store normalized score (0-100 scale)
          e[`${key}NormScore`] = parseFloat(normalizedScore.toFixed(2));
        });
      });
    };

    // Calculate normalized scores for both L1 and L2
    calculateNormalizedScores(data.L1);
    calculateNormalizedScores(data.L2);

    // =========================================================================
    // STEP 3: Calculate FINAL SCORE using weighted sum of NORMALIZED SCORES
    // Weights: Productivity(30%), CSAT%(15%/20%), #CSATs(10%), RWT(15%), Iterations(15%), FRR%(15%)
    // CRITICAL: Uses normalizedScores, NOT percentiles
    // =========================================================================
    const calculateFinalScore = (e, isL2) => {
      const csatWeight = isL2 ? 0.20 : 0.15;

      return (
        (e.productivityNormScore || 0) * 0.30 +
        (e.csatPercentNormScore || 0) * csatWeight +
        (e.positiveCSATNormScore || 0) * 0.10 +
        (e.avgRWTNormScore || 0) * 0.15 +
        (e.avgIterationsNormScore || 0) * 0.15 +
        (e.frrPercentNormScore || 0) * 0.15
      );
    };

    // Calculate final scores
    data.L1.forEach(e => { e.finalScore = parseFloat(calculateFinalScore(e, false).toFixed(2)); });
    data.L2.forEach(e => { e.finalScore = parseFloat(calculateFinalScore(e, true).toFixed(2)); });

    // Also keep weightedAvg for backward compatibility (now correctly calculated)
    data.L1.forEach(e => { e.weightedAvg = e.finalScore; });
    data.L2.forEach(e => { e.weightedAvg = e.finalScore; });

    // =========================================================================
    // STEP 4: Sort by finalScore with DETERMINISTIC tie-breaking (fixes rank instability)
    // Primary: Higher finalScore first
    // Secondary: Alphabetical by name (ensures stable, reproducible ranking)
    // =========================================================================
    data.L1.sort((a, b) => {
      if (b.finalScore !== a.finalScore) {
        return b.finalScore - a.finalScore; // Primary: higher score first
      }
      return a.name.localeCompare(b.name);  // Secondary: alphabetical (deterministic)
    });

    data.L2.sort((a, b) => {
      if (b.finalScore !== a.finalScore) {
        return b.finalScore - a.finalScore;
      }
      return a.name.localeCompare(b.name);
    });

    const totalL1 = data.L1.length;
    const totalL2 = data.L2.length;

    data.L1.forEach((e, i) => {
      e.rank = i + 1;
      e.percentile = totalL1 > 0 ? Math.round(((totalL1 - e.rank + 1) / totalL1) * 100) : 0;
    });

    data.L2.forEach((e, i) => {
      e.rank = i + 1;
      e.percentile = totalL2 > 0 ? Math.round(((totalL2 - e.rank + 1) / totalL2) * 100) : 0;
    });

    res.json({
      quarter,
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      data,
      totalL1: data.L1.length,
      totalL2: data.L2.length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (e) {
    console.error("❌ Gamification Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// API: GET WORKLOAD FOR ALL ACTIVE ENGINEERS (With Proper Shift Detection)
// ============================================================================
app.get("/api/roster/workload", async (req, res) => {
  try {
    // Use IST time
    const istNow = getISTTime();
    const dateKey = format(istNow, "d-MMM");
    const colIdx = DATE_COL_MAP[dateKey];
    const currentHour = getCurrentISTHour();

    console.log(`🔍 Workload check for ${dateKey}, IST hour=${currentHour.toFixed(2)}`);

    // Identify Active Engineers (Currently On Shift)
    const activeEngineers = ROSTER_ROWS.filter((row) => {
      if (!row[0] || !row[1]) return false;

      const shift = (row[colIdx] || "").toUpperCase().trim();

      // Check if off duty
      if (OFF_STATUSES.includes(shift)) return false;

      // Normalize shift name
      const shiftMatch = shift.match(/(?:SHIFT\s*)?(\d)/i);
      const shiftNum = shiftMatch ? shiftMatch[1] : null;
      const shiftKey = shiftNum ? `SHIFT ${shiftNum}` : shift.replace(/\s+/g, " ").trim();

      const hours = SHIFT_HOURS[shiftKey];

      if (hours) {
        if (hours.overnight) {
          return currentHour >= hours.start || currentHour < hours.end;
        }
        return currentHour >= hours.start && currentHour < hours.end;
      }

      // Unknown format - not active
      return false;
    }).map((row) => ({
      name: row[0],
      email: row[1],
      role: row[LEVEL_COL_IDX] || "L1", // L1 or L2
      shift: colIdx ? row[colIdx] : "Unknown",
    }));

    console.log(`✅ ${activeEngineers.length} engineers currently on shift`);

    // 3. Calculate Live Workload from Active Tickets Cache
    // ✅ Get tickets from Redis instead of NodeCache
    const tickets = await redisGet("tickets:active") || [];
    const workloadMap = {};

    // Initialize everyone with 0
    activeEngineers.forEach((eng) => {
      workloadMap[eng.name.toLowerCase()] = 0;
    });

    // Count open tickets
    tickets.forEach((t) => {
      const stageName = (t.stage?.name || "").toLowerCase();
      if (stageName.includes("solved") || stageName.includes("closed") || stageName.includes("resolved")) {
        return; // Skip solved tickets
      }

      // Get owner name
      const ownerName = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || 
                        t.owned_by?.[0]?.display_name || "";
      
      if (ownerName) {
        const nameKey = ownerName.toLowerCase();
        if (workloadMap.hasOwnProperty(nameKey)) {
          // Weighted: High/Urgent = 2 points, Normal = 1 point
          const priority = (t.priority || "").toLowerCase();
          const points = (priority === "high" || priority === "urgent") ? 2 : 1;
          workloadMap[nameKey] += points;
        }
      }
    });

    // 4. Build Response sorted by least loaded
    const results = activeEngineers
      .map((eng) => ({
        name: eng.name,
        email: eng.email,
        role: eng.role,
        shift: eng.shift,
        load: workloadMap[eng.name.toLowerCase()] || 0,
        isOnShift: true,
      }))
      .sort((a, b) => a.load - b.load);

    res.json(results);
  } catch (e) {
    console.error("❌ Workload Error:", e);
    res.status(500).json([]);
  }
});

app.post("/api/roster/sync", async (req, res) => {
  await syncRoster();
  res.json({ success: true });
});

// Startup
const PORT = process.env.PORT || 5000;

// ✅ FIX: Pre-warm cache with deduplication flag to prevent multiple syncs
const warmCache = async (source = "unknown") => {
  // Prevent duplicate cache warming
  if (cacheWarmingStarted) {
    console.log(`⏭️ Cache warming already started, skipping (${source})`);
    return;
  }
  cacheWarmingStarted = true;
  console.log(`🔥 Warming cache (triggered by: ${source})...`);

  try {
    // Start ticket sync (most important)
    fetchAndCacheTickets("startup").catch(console.error);
    console.log("✅ Ticket sync started in background");

    // Wait 2s then warm analytics (less critical)
    setTimeout(async () => {
      try {
        const PORT = process.env.PORT || 5000;
        await axios.get(
          `http://localhost:${PORT}/api/tickets/analytics?quarter=Q1_26`,
          { timeout: 10000 }
        );
        console.log("✅ Analytics cache warmed");
      } catch (e) {
        console.log("⚠️ Analytics warming skipped:", e.message);
      }
    }, 2000);
  } catch (e) {
    console.log("⚠️ Cache warming failed:", e.message);
    cacheWarmingStarted = false; // Reset on failure to allow retry
  }
};

// ✅ FIX: Single unified cache warming trigger - only when MongoDB is ready
mongoose.connection.once("open", () => {
  console.log("🍃 MongoDB connection ready");
  // Warm cache immediately when MongoDB connects
  warmCache("mongodb-open");
});

// ============================================================================
// ✅ NEW: BACKGROUND CACHE REFRESH - Updates pre-computed data every 15 minutes
// This ensures users always get instant responses from cached data
// ============================================================================
const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes

const precomputeAnalytics = async (quarter) => {
  const cacheType = quarter.toLowerCase().replace("_", "");

  try {
    // Check if already computing (prevent concurrent refreshes)
    const existing = await PrecomputedDashboard.findOne({ cache_type: cacheType });
    if (existing?.computing) {
      console.log(`⏭️ Skipping ${quarter} - already computing`);
      return;
    }

    // Mark as computing
    await PrecomputedDashboard.findOneAndUpdate(
      { cache_type: cacheType },
      { $set: { computing: true } },
      { upsert: true }
    );

    console.log(`🔄 Pre-computing ${quarter} analytics...`);

    // Compute fresh analytics data
    const { start, end } = getQuarterDateRange(quarter);
    const matchConditions = {
      closed_date: { $gte: start, $lte: end },
    };

    const [statsResult] = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalTickets: { $sum: 1 },
          avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
          avgFRT: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
          avgIterations: { $avg: { $cond: [{ $ne: ["$iterations", null] }, "$iterations", null] } },
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          frrMet: { $sum: "$frr" },
          frrTotal: { $sum: 1 },
        },
      },
    ]);

    const trends = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } },
          solved: { $sum: 1 },
          avgRWT: { $avg: "$rwt" },
          avgFRT: { $avg: "$frt" },
          avgIterations: { $avg: "$iterations" },
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
          frrTotal: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 100 },
    ]);

    const trendsWithFRRPercent = trends.map((t) => ({
      date: t._id,
      solved: t.solved,
      avgRWT: t.avgRWT ? Number(t.avgRWT.toFixed(2)) : 0,
      avgFRT: t.avgFRT ? Number(t.avgFRT.toFixed(2)) : 0,
      avgIterations: t.avgIterations ? Number(t.avgIterations.toFixed(1)) : 0,
      positiveCSAT: t.positiveCSAT,
      frrMet: t.frrMet,
      frrPercent: t.frrTotal > 0 ? Math.round((t.frrMet / t.frrTotal) * 100) : 0,
    }));

    const leaderboard = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: "$owner",
          totalTickets: { $sum: 1 },
          goodCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          badCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          avgRWT: { $avg: "$rwt" },
          avgFRT: { $avg: "$frt" },
        },
      },
      { $match: { _id: { $ne: null }, totalTickets: { $gte: 3 } } },
      { $sort: { goodCSAT: -1 } },
      { $limit: 25 },
    ]);

    // Individual trends by owner and date (needed for Performance Analytics charts)
    const individualTrends = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $addFields: {
          ticketAge: {
            $divide: [
              { $subtract: ["$closed_date", "$created_date"] },
              1000 * 60 * 60 * 24,
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } },
            owner: "$owner",
          },
          solved: { $sum: 1 },
          avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
          avgFRT: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
          avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
          iterValidCount: { $sum: { $cond: [{ $gt: ["$iterations", 0] }, 1, 0] } },
          rwtValidCount: { $sum: { $cond: [{ $gt: ["$rwt", 0] }, 1, 0] } },
          frtValidCount: { $sum: { $cond: [{ $gt: ["$frt", 0] }, 1, 0] } },
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
          frrTotal: { $sum: 1 },
          backlogCleared: { $sum: { $cond: [{ $gte: ["$ticketAge", 15] }, 1, 0] } },
        },
      },
      { $sort: { "_id.date": 1 } },
    ]);

    // Transform individualTrends to grouped format
    const individualTrendsGrouped = individualTrends.reduce((acc, item) => {
      const { date, owner } = item._id;
      if (!acc[owner]) acc[owner] = [];
      acc[owner].push({
        date,
        solved: item.solved,
        avgRWT: item.avgRWT ? Number(item.avgRWT.toFixed(2)) : 0,
        avgFRT: item.avgFRT ? Number(item.avgFRT.toFixed(2)) : 0,
        avgIterations: item.avgIterations ? Number(item.avgIterations.toFixed(1)) : 0,
        iterValidCount: item.iterValidCount || 0,
        rwtValidCount: item.rwtValidCount || 0,
        frtValidCount: item.frtValidCount || 0,
        positiveCSAT: item.positiveCSAT || 0,
        frrMet: item.frrMet || 0,
        backlogCleared: item.backlogCleared || 0,
      });
      return acc;
    }, {});

    const response = {
      quarter,
      dateRange: { start, end },
      stats: {
        totalTickets: statsResult?.totalTickets || 0,
        avgRWT: statsResult?.avgRWT ? Number(statsResult.avgRWT.toFixed(2)) : 0,
        avgFRT: statsResult?.avgFRT ? Number(statsResult.avgFRT.toFixed(2)) : 0,
        avgIterations: statsResult?.avgIterations ? Number(statsResult.avgIterations.toFixed(1)) : 0,
        positiveCSAT: statsResult?.positiveCSAT || 0,
        negativeCSAT: statsResult?.negativeCSAT || 0,
        frrPercent: statsResult?.frrTotal > 0 ? Math.round((statsResult.frrMet / statsResult.frrTotal) * 100) : 0,
      },
      trends: trendsWithFRRPercent,
      leaderboard: leaderboard.map((l) => ({
        name: l._id,
        totalTickets: l.totalTickets,
        goodCSAT: l.goodCSAT,
        badCSAT: l.badCSAT,
        winRate: l.goodCSAT + l.badCSAT > 0 ? Math.round((l.goodCSAT / (l.goodCSAT + l.badCSAT)) * 100) : 0,
        avgRWT: l.avgRWT ? Number(l.avgRWT.toFixed(2)) : 0,
        avgFRT: l.avgFRT ? Number(l.avgFRT.toFixed(2)) : 0,
      })),
      individualTrends: individualTrendsGrouped,
      computed_at: new Date(),
      _isPrecomputed: true,
    };

    // Store pre-computed data
    await PrecomputedDashboard.findOneAndUpdate(
      { cache_type: cacheType },
      { $set: { data: response, computed_at: new Date(), computing: false } },
      { upsert: true }
    );

    console.log(`✅ Pre-computed ${quarter} analytics (${response.stats.totalTickets} tickets)`);
    return response;
  } catch (error) {
    console.error(`❌ Pre-compute ${quarter} failed:`, error.message);
    // Reset computing flag on error
    await PrecomputedDashboard.findOneAndUpdate(
      { cache_type: cacheType },
      { $set: { computing: false } }
    ).catch(() => {});
  }
};

// Background refresh job
const startBackgroundRefresh = () => {
  console.log("🔄 Starting background cache refresh (every 15 min)...");

  // Initial pre-compute after 10 seconds (let server stabilize first)
  setTimeout(async () => {
    console.log("🚀 Initial pre-computation starting...");
    await precomputeAnalytics("Q4_25");
    await precomputeAnalytics("Q1_26");
  }, 10000);

  // Schedule refresh every 15 minutes
  setInterval(async () => {
    console.log("⏰ Scheduled cache refresh...");
    await precomputeAnalytics("Q4_25");
    await precomputeAnalytics("Q1_26");
  }, REFRESH_INTERVAL);
};

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

  // ✅ FIX: Fallback cache warming after 5s if MongoDB connection was slow
  // This ensures cache is warmed even if MongoDB took longer to connect
  setTimeout(() => {
    if (!cacheWarmingStarted && mongoose.connection.readyState === 1) {
      warmCache("server-listen-fallback");
    }
  }, 5000);

  // ✅ NEW: Start background cache refresh for instant load times
  startBackgroundRefresh();

  console.log("✅ Server ready - background tasks running");
});
setInterval(
  () => {
    console.log("⏰ Scheduled sync (every 6 hours)...");
    syncHistoricalToDB(false);
  },
  6 * 60 * 60 * 1000,
);

// Also run on startup after 1 minute delay
// setTimeout(() => {
//   console.log("🚀 Initial sync on startup...");
//   syncHistoricalToDB(false);
// }, 60 * 1000);

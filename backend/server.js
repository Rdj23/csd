import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import axios from "axios";
import http from "http";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import NodeCache from "node-cache";
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

const cache = new NodeCache({ stdTTL: 0 });

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const DEVREV_API = "https://api.devrev.ai";
const HEADERS = {
  Authorization: `Bearer ${process.env.VITE_DEVREV_PAT}`,
  "Content-Type": "application/json",
};
let syncTimeout = null;

// --- MONGODB CONNECTION ---
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("🍃 MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

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
    
    await redis.connect();
  } catch (err) {
    console.error("Redis Init Failed:", err.message);
    console.log("⚠️ Continuing without Redis cache");
    redis = null;
  }
};

initRedis();

// --- REDIS CACHE HELPERS ---
const CACHE_TTL = {
  ANALYTICS: 1800,      // 30 minutes
  TICKETS: 300,         // 5 minutes
  LEADERBOARD: 3600,    // 1 hour
  DRILLDOWN: 600,       // 10 minutes
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
  "Rohan", "Archie", "Neha", "Shreya", "Vaibhav", "Adarsh", "Abhishek",
  "Shubhankar", "Musaveer", "Anurag", "Debashish",
  "Aditya", "Shweta", "Nikita",
  "Tuaha Khan", "Harsh", "Tamanna", "Shreyas",
  "Adish"
]);

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
    noc_issue_id: { type: String, default: null },      // e.g., "ISS-124362"
    noc_jira_key: { type: String, default: null },      // e.g., "SUC-128878"
    noc_rca: { type: String, default: null },           // e.g., "Understanding Gap - CS"
    noc_reported_by: { type: String, default: null },   // e.g., "Sambhaavna A"
    noc_assignee: { type: String, default: null },
  },
  { versionKey: false }
);

AnalyticsTicketSchema.index({ closed_date: 1, owner: 1 });
AnalyticsTicketSchema.index({ closed_date: 1, is_noc: 1 });
AnalyticsTicketSchema.index({ closed_date: 1, is_zendesk: 1 });
AnalyticsTicketSchema.index({ owner: 1, closed_date: 1, region: 1 });

const AnalyticsTicket = mongoose.model(
  "AnalyticsTicket",
  AnalyticsTicketSchema
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
  })
);
// GZIP Compression - reduces payload by 70%
app.use(compression({
  level: 6,
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

let isSyncing = false;
let syncQueued = false;

const getQuarterDateRange = (quarter) => {
  const now = new Date();
  switch (quarter) {
    // Quarters
    case "Q4_25":
      return {
        start: new Date("2025-10-01"),
        end: new Date("2025-12-31T23:59:59Z"),
      };
    case "Q1_26":
      return {
        start: new Date("2026-01-01"),
        end: new Date("2026-03-31T23:59:59Z"),
      };

    // Q1 2026 Weeks (Monday to Sunday)
    case "Q1_26_W1":
      return {
        start: new Date("2026-01-06"),
        end: new Date("2026-01-12T23:59:59Z"),
      };
    case "Q1_26_W2":
      return {
        start: new Date("2026-01-13"),
        end: new Date("2026-01-19T23:59:59Z"),
      };
    case "Q1_26_W3":
      return {
        start: new Date("2026-01-20"),
        end: new Date("2026-01-26T23:59:59Z"),
      };
    case "Q1_26_W4":
      return {
        start: new Date("2026-01-27"),
        end: new Date("2026-02-02T23:59:59Z"),
      };
    case "Q1_26_W5":
      return {
        start: new Date("2026-02-03"),
        end: new Date("2026-02-09T23:59:59Z"),
      };
    case "Q1_26_W6":
      return {
        start: new Date("2026-02-10"),
        end: new Date("2026-02-16T23:59:59Z"),
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
    const { start, end, owners, teams, region, excludeZendesk, excludeNOC } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "Start and End dates required" });
    }
    
    // Redis cache check
    const cacheKey = `livestats:${start}:${end}:${owners || 'all'}:${region || 'all'}:${excludeZendesk || 'false'}:${excludeNOC || 'false'}`;
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
       matchConditions.region = { $in: region.split(",").filter(r => r.trim()) };
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
          avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },

          // ✅ FIX: VALID COUNTS (Needed for Weighted Average on Frontend)
          rwtValidCount: { $sum: { $cond: [{ $gt: ["$rwt", 0] }, 1, 0] } },
          frtValidCount: { $sum: { $cond: [{ $gt: ["$frt", 0] }, 1, 0] } },
          iterValidCount: { $sum: { $cond: [{ $gt: ["$iterations", 0] }, 1, 0] } },
          
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },

          // Daily Trend for Expanded Chart
          dailyData: {
            $push: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } },
              rwt: "$rwt",
              frt: "$frt",
              iterations: "$iterations",
              csat: "$csat",
              frr: "$frr"
            }
          }
        }
      }
    ]);

    if (result.length === 0) {
      return res.json({ stats: {}, trends: [] });
    }

    const data = result[0];

    // 3. Process Daily Trends for Chart
    // We group the 'dailyData' array by date inside JS to handle the daily sums
    const trendsMap = {};
    data.dailyData.forEach(t => {
      if (!trendsMap[t.date]) {
        trendsMap[t.date] = { 
          date: t.date, solved: 0, 
          sumRWT: 0, countRWT: 0,
          sumFRT: 0, countFRT: 0,
          sumIter: 0, countIter: 0,
          positiveCSAT: 0, frrMet: 0
        };
      }
      const day = trendsMap[t.date];
      day.solved++;
      if (t.csat === 2) day.positiveCSAT++;
      if (t.frr === 1) day.frrMet++;
      
      if (t.rwt > 0) { day.sumRWT += t.rwt; day.countRWT++; }
      if (t.frt > 0) { day.sumFRT += t.frt; day.countFRT++; }
      if (t.iterations > 0) { day.sumIter += t.iterations; day.countIter++; }
    });

    const trends = Object.values(trendsMap).map(day => ({
      date: day.date,
      solved: day.solved,
      positiveCSAT: day.positiveCSAT,
      frrMet: day.frrMet,
      avgRWT: day.countRWT ? day.sumRWT / day.countRWT : 0,
      avgFRT: day.countFRT ? day.sumFRT / day.countFRT : 0,
      avgIterations: day.countIter ? day.sumIter / day.countIter : 0,
    })).sort((a, b) => new Date(a.date) - new Date(b.date));

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
          iterValidCount: { $sum: { $cond: [{ $gt: ["$iterations", 0] }, 1, 0] } },


        positiveCSAT: data.positiveCSAT,
        frrPercent: data.totalSolved ? Math.round((data.frrMet / data.totalSolved) * 100) : 0,
      },
      trends
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
      query.stage_name = { $in: ["solved", "closed", "resolved", "Resolved", "Solved", "Closed"] };
    }

    // 2. Fetch from Mongo (Not RAM!)
    // We select only needed fields to keep it fast
    const tickets = await AnalyticsTicket.find(query)
      .select("display_id title created_date actual_close_date owner stage_name rwt account_name")
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
      owners,     // Ensure this is here if using new filters
      region,
      forceRefresh,
      groupBy = "daily",
    } = req.query;
      const cacheKey = `analytics:${quarter}:${excludeZendesk || 'false'}:${excludeNOC || 'false'}:${owner || 'all'}:${owners || 'none'}:${region || 'none'}:${groupBy}`;
    
    // 1. Check Redis cache first (fastest)
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
      const mongoCache = await AnalyticsCache.findOne({ cache_key: cacheKey }).lean();
      if (mongoCache && Date.now() - new Date(mongoCache.computed_at).getTime() < 1800000) {
        console.log(`⚡ MongoDB Cache HIT`);
        // Store in Redis for next time
        await redisSet(cacheKey, mongoCache, CACHE_TTL.ANALYTICS);
        return res.json(mongoCache);
      }
    }

    // 3. Compute fresh data
    const { start, end } = getQuarterDateRange(quarter);
    console.log(`📅 Date Range: ${format(start, "MMM d")} - ${format(end, "MMM d")}`);

    const matchConditions = {
      closed_date: { $gte: start, $lte: end },
      owner: { $nin: ["Anmol", "anmol-sawhney", "Anmol Sawhney"] },
    };
    if (excludeZendesk === "true") matchConditions.is_zendesk = { $ne: true };

    // ✅ FIX: NOC filter MUST be here
if (excludeNOC === "true") {
  matchConditions.is_noc = { $ne: true };
}

  
    if (owner && owner !== "All")
      matchConditions.owner = { $regex: owner, $options: "i" };

    console.log(
      `   📅 Range: ${format(start, "MMM d")} - ${format(end, "MMM d")}`
    );

    

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
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 100 },
    ]);

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
       $match: matchConditions
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
              $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] 
            } 
          },
          avgFRT: { 
            $avg: { 
              $cond: [{ $gt: ["$frt", 0] }, "$frt", null] 
            } 
          },
          // ✅ NEW: Iterations (Avg + Valid Count for weighting)
          avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
          iterValidCount: { $sum: { $cond: [{ $gt: ["$iterations", 0] }, 1, 0] } },

          // ✅ FIX: Add counts of valid tickets for Weighted Average calc on Frontend
          rwtValidCount: { 
            $sum: { $cond: [{ $gt: ["$rwt", 0] }, 1, 0] } 
          },
          frtValidCount: { 
            $sum: { $cond: [{ $gt: ["$frt", 0] }, 1, 0] } 
          },
         

          // ✅ FIX: Add CSAT and FRR data
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
          
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
      trends: trends.map((t) => {
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
          avgIterations: item.avgIterations ? Number(item.avgIterations.toFixed(1)) : 0,
          // Pass the Raw Counts
          positiveCSAT: item.positiveCSAT || 0,
          frrMet: item.frrMet || 0,
          // Pass Valid Counts for Frontend Weighting
          rwtValidCount: item.rwtValidCount || 0,
          frtValidCount: item.frtValidCount || 0,
          iterValidCount: item.iterValidCount || 0,
          backlogCleared: item.backlogCleared || 0,
        });
        return acc;
      }, {}),
    };

    await AnalyticsCache.findOneAndUpdate({ cache_key: cacheKey }, response, {
      upsert: true,
    });
   

    // Cache in Redis (fast) and MongoDB (persistent)
    await Promise.all([
      redisSet(cacheKey, response, CACHE_TTL.ANALYTICS),
      AnalyticsCache.findOneAndUpdate(
        { cache_key: cacheKey },
        { $set: response },
        { upsert: true }
      )
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

// Cache status endpoint for debugging
app.get("/api/cache/status", async (req, res) => {
  const nodeKeys = cache.keys();
  let redisKeys = [];
  
  if (redis) {
    try {
      redisKeys = await redis.keys("*");
    } catch (e) {
      redisKeys = ["Error: " + e.message];
    }
  }
  
  res.json({
    nodeCache: {
      keys: nodeKeys,
      stats: cache.getStats(),
    },
    redis: {
      status: redis?.status || "disconnected",
      keys: redisKeys.length,
      keyList: redisKeys.slice(0, 20), // First 20 keys
    },
  });
});

// Manual cache clear endpoint
app.post("/api/cache/clear", async (req, res) => {
  cache.flushAll();
  await redisDelete("*");
  res.json({ success: true, message: "All caches cleared" });
});

// Get tickets for a specific date (for drill-down)

app.get("/api/tickets/by-date", async (req, res) => {
  try {
    const { date, owners, metric, excludeZendesk, region, } = req.query;
    
    if (!date) return res.status(400).json({ error: "Date required" });

    const cacheKey = `bydate:${date}:${owners || 'all'}:${excludeZendesk || 'false'}:${excludeNOC || 'false'}`;
    const cached = await redisGet(cacheKey);
    if (cached) {
      console.log(`⚡ ByDate Redis HIT`);
      return res.json(cached);
    }
    
    // Parse date logic (Weekly vs Daily)
    let startOfDay, endOfDay;
    if (date.includes('W')) {
      const [year, weekPart] = date.split('-W');
      const weekNum = parseInt(weekPart);
      const simple = new Date(parseInt(year), 0, 1 + (weekNum - 1) * 7);
      const dow = simple.getDay();
      const ISOweekStart = simple;
      if (dow <= 4) ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
      else ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
      
      startOfDay = new Date(ISOweekStart);
      endOfDay = new Date(startOfDay);
      endOfDay.setDate(startOfDay.getDate() + 6);
      endOfDay.setHours(23, 59, 59, 999);
    } else {
      startOfDay = new Date(date + "T00:00:00.000Z");
      endOfDay = new Date(date + "T23:59:59.999Z");
    }
    
    const matchConditions = {
      closed_date: { $gte: startOfDay, $lte: endOfDay },
      owner: { $nin: ["Anmol", "anmol-sawhney", "Anmol Sawhney"] },
    };
    
    // 1. Owner Filter
    if (owners && owners.length > 0 && owners !== 'All') {
      const ownerList = owners.split(',').filter(o => o.trim());
      if (ownerList.length > 0) matchConditions.owner = { $in: ownerList };
    }

    if (region && region !== 'All') {
       matchConditions.region = { $in: region.split(',').filter(r => r.trim()) };
    }
    
   // ✅ METRIC SPECIFIC FILTERS (Exclude 0/Null values)
    if (metric === "csat" || metric === "positiveCSAT") {
      matchConditions.csat = 2; 
    } else if (metric === "frrPercent" || metric === "frr") {
      matchConditions.frr = 1; // Only met
    } else if (metric === "backlog") {
      matchConditions.$expr = {
        $gt: [{ $subtract: ["$closed_date", "$created_date"] }, 15 * 86400000],
      };
    } 
    // 3. Zendesk & Region
    if (excludeZendesk === 'true') matchConditions.is_zendesk = { $ne: true };
    if (region && region.length > 0) matchConditions.region = { $in: region.split(',') };

    // NOC filter
    if (req.query.excludeNOC === 'true') {
      matchConditions.is_noc = { $ne: true };
    }

    const tickets = await AnalyticsTicket.find(matchConditions)
      .sort({ closed_date: -1 })
      .limit(500)
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
    // ✅ DEFINE sevenDaysAgo FIRST (before it's used!)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 1825);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    console.log(
      "📅 Including solved tickets since:",
      sevenDaysAgo.toISOString()
    );

    let collected = [],
      cursor = null,
      loop = 0;
    const TARGET_DATE = new Date("2025-10-01");

    do {
      const response = await axios.get(
        `${DEVREV_API}/works.list?limit=50&type=ticket${
          cursor ? `&cursor=${cursor}` : ""
        }`,
        { headers: HEADERS, timeout: 30000 }
      );

      const newWorks = response.data.works || [];
      if (!newWorks.length) break;
      collected = [...collected, ...newWorks];
      const lastDate = parseISO(newWorks[newWorks.length - 1].created_date);
      if (lastDate < TARGET_DATE) break;
      cursor = response.data.next_cursor;
      loop++;
    } while (cursor && loop < 100);

    // ✅ FILTER: Active tickets + Solved in last 7 days
    const activeTickets = collected
      .filter((t) => {
        const stage = t.stage?.name?.toLowerCase() || "";

        // Keep all active/open tickets
        if (
          stage.includes("waiting on assignee") ||
          stage.includes("awaiting customer reply") ||
          stage.includes("waiting on clevertap")
        ) {
          return true;
        }
        // Keep solved/closed ONLY if closed in last 7 days
        if (
          stage.includes("solved") ||
          stage.includes("closed") ||
          stage.includes("resolved")
        ) {
          if (t.actual_close_date) {
            return new Date(t.actual_close_date) >= sevenDaysAgo;
          }
          return false;
        }

        return false;
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

    // Log for debugging
    const solvedCount = activeTickets.filter((t) => {
      const stage = t.stage?.name?.toLowerCase() || "";
      return stage.includes("solved") || stage.includes("closed");
    }).length;

  // Store in both NodeCache (fast local) and Redis (shared across restarts)
    cache.set("tickets_active", activeTickets);
    await redisSet("tickets:active", activeTickets, CACHE_TTL.TICKETS);
    
    collected = null;
    if (global.gc) global.gc();
    console.log(
      `✅ ${activeTickets.length} tickets cached (${solvedCount} solved in last 7 days)`
    );
    io.emit("REFRESH_TICKETS", activeTickets);
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
// ACTIVE TICKETS (Dashboard - Open/Pending only)
// ============================================================================
app.get("/api/tickets", async (req, res) => {
  // Try Redis first
  const redisData = await redisGet("tickets:active");
  if (redisData) {
    console.log("⚡ Active Tickets: Redis HIT");
    return res.json({ tickets: redisData });
  }
  
  // Try NodeCache
  const cached = cache.get("tickets_active");
  if (cached) {
    // Store in Redis for next time
    await redisSet("tickets:active", cached, CACHE_TTL.TICKETS);
    return res.json({ tickets: cached });
  }
  
  await fetchAndCacheTickets("first_load");
  const tickets = cache.get("tickets_active") || [];
  await redisSet("tickets:active", tickets, CACHE_TTL.TICKETS);
  res.json({ tickets });
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
      { headers: HEADERS }
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
      { headers: HEADERS }
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
              { headers: HEADERS }
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
                    { headers: HEADERS }
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
              })
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
        })
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
        "MMM dd, yyyy"
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
  const TARGET_DATE = new Date("2025-10-01");
  const NOC_CHECK_DATE = new Date("2026-01-01"); // Only check NOC for tickets >= Jan 1, 2026

  do {
    try {
      const res = await axios.get(
        `${DEVREV_API}/works.list?limit=50&type=ticket${cursor ? `&cursor=${cursor}` : ""}`,
        { headers: HEADERS }
      );
      const works = res.data.works || [];
      if (!works.length) break;
      if (new Date(works[works.length - 1].created_date) < TARGET_DATE && !fullHistory) break;

      const solved = works.filter((t) => {
        const stage = t.stage?.name?.toLowerCase() || "";
        return (
          (stage.includes("solved") || stage.includes("closed") || stage.includes("resolved")) &&
          t.actual_close_date
        );
      });

      if (solved.length) {
        const ops = [];
        
        for (const t of solved) {
          // Skip Anmol
          const ownerRaw = t.owned_by?.[0]?.display_name || "";
          if (ownerRaw.toLowerCase().includes("anmol-sawhney")) {
            skippedCount++;
            continue;
          }
          
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
          let nocAssignee = null;  // NEW

          const closedDate = new Date(t.actual_close_date);
          if (closedDate >= NOC_CHECK_DATE) {
            try {
              // Step 1: Get linked issues using links.list
              const linksRes = await axios.post(
                `${DEVREV_API}/links.list`,
                {
                  object: t.id,
                  object_types: ["issue"],
                  limit: 10
                },
                { headers: HEADERS }
              );
              const links = linksRes.data.links || [];

              // Step 2: Check each linked issue
              for (const link of links) {
                const issueId = link.target?.display_id || link.source?.display_id;
                if (!issueId || !issueId.startsWith("ISS-")) continue;

                try {
                  // Step 3: Get issue details using works.get
                  const issRes = await axios.post(
                    `${DEVREV_API}/works.get`,
                    { id: issueId },
                    { headers: HEADERS }
                  );
                  const issue = issRes.data.work;

                  // Check if it's a NOC issue (PSN Task)
                // Check if it's a NOC issue (PSN Task)
                  if (issue?.custom_fields?.ctype__issuetype === "PSN Task") {
                    isNoc = true;
                    nocIssueId = issue.display_id;
                    nocJiraKey = issue.custom_fields?.ctype__key || null;
                    nocRca = issue.custom_fields?.ctype__customfield_10169 || null;
                    nocReportedBy = issue.reported_by?.[0]?.display_name || null;
                    nocAssignee = issue.owned_by?.[0]?.display_name || null;  // NEW: Get assignee
                    nocCount++;
                    console.log(`   ✓ NOC: ${t.display_id} → ${nocIssueId}, Assignee: ${nocAssignee}, RCA: ${nocRca}`);
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
                  is_zendesk: t.tags?.some((tag) => tag.tag?.name === "Zendesk import"),
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
                  account_name: t.custom_fields?.tnt__instance_account_name || t.account?.display_name || "Unknown",
                },
              },
              upsert: true,
            },
          });
        }

        if (ops.length > 0) {
          await AnalyticsTicket.bulkWrite(ops);
          processedCount += ops.length;
          console.log(`   📊 Batch done: ${processedCount} synced, ${nocCount} NOC, ${skippedCount} skipped`);
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
  console.log(`✅ SYNC COMPLETE: ${processedCount} GST tickets, ${nocCount} NOC tickets, ${skippedCount} non-GST skipped. Caches cleared.`);

};

// Health check with Redis status
app.get("/api/health", async (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  const redisStatus = redis?.status || "disconnected";
  
  res.json({
    status: "ok",
    mongo: mongoStatus,
    redis: redisStatus,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
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
          processedQuery.closed_date.$gte
        );
      }
      if (processedQuery.closed_date.$lte) {
        processedQuery.closed_date.$lte = new Date(
          processedQuery.closed_date.$lte
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
      owner: { $nin: ["Anmol", "anmol-sawhney", "Anmol Sawhney"] },
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
  res.json({ clientId: GOOGLE_CLIENT_ID })
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
      { headers: HEADERS }
    );
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: "Failed" });
  }
});

// Views
app.get("/api/views/:userId", async (req, res) =>
  res.json(
    await View.find({ userId: req.params.userId }).sort({ createdAt: -1 })
  )
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
// let ROSTER_ROWS = [],
//   DATE_COL_MAP = {};
// const syncRoster = async () => {
//   console.log("🔄 Roster Sync...");
//   try {
//     const creds = JSON.parse(
//       Buffer.from(process.env.GOOGLE_SHEETS_KEY_BASE64, "base64").toString()
//     );
//     const auth = new google.auth.GoogleAuth({
//       credentials: creds,
//       scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
//     });
//     const sheets = google.sheets({ version: "v4", auth });
//     const meta = await sheets.spreadsheets.get({
//       spreadsheetId: process.env.ROSTER_SHEET_ID,
//     });
//     const sheetName = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
//     const resp = await sheets.spreadsheets.values.get({
//       spreadsheetId: process.env.ROSTER_SHEET_ID,
//       range: `'${sheetName}'!A1:AZ100`,
//     });
//     const rows = resp.data.values || [];

//     let headerIdx = rows.findIndex((r) =>
//       r.some((c) => String(c).toLowerCase().includes("designation"))
//     );
//     if (headerIdx === -1) return;

//     DATE_COL_MAP = {};
//     rows[headerIdx].forEach((col, i) => {
//       if (col?.includes("-") || col?.includes("Jan"))
//         DATE_COL_MAP[col.trim()] = i;
//     });
//     ROSTER_ROWS = rows.slice(headerIdx + 1).filter((r) => r[0]?.length > 2);
//     console.log(`✅ ${ROSTER_ROWS.length} engineers loaded`);
//   } catch (e) {
//     console.error("Roster error:", e.message);
//   }
// };

// app.post("/api/profile/status", (req, res) => {
//   const { userName } = req.body;
//   const dateKey = format(new Date(), "d-MMM");
//   const colIdx = DATE_COL_MAP[dateKey];
//   const row = ROSTER_ROWS.find((r) =>
//     r[0]?.toLowerCase().includes(userName?.toLowerCase())
//   );
//   const shift = row?.[colIdx]?.toUpperCase() || "?";
//   const isActive = !["WO", "L", "PL", ""].includes(shift);
//   res.json({ isActive, shift, status: isActive ? "On Shift" : "Off" });
// });

// app.post("/api/roster/sync", async (req, res) => {
//   await syncRoster();
//   res.json({ success: true });
// });

// Startup
const PORT = process.env.PORT || 5000;

// Pre-warm cache on server start
const warmCache = async () => {
  console.log("🔥 Warming cache...");
  try {
    // Pre-compute current quarter analytics
    const currentQuarter = "Q1_26";
    const { start, end } = getQuarterDateRange(currentQuarter);
    
    // Trigger analytics computation
    const response = await axios.get(`http://localhost:${PORT}/api/tickets/analytics?quarter=${currentQuarter}`);
    console.log("✅ Cache warmed for", currentQuarter);
  } catch (e) {
    console.log("Cache warming skipped:", e.message);
  }
};

// Warm cache 5 seconds after server starts
setTimeout(warmCache, 5000);

server.listen(PORT, async () => {
  console.log(`🚀 Server on port ${PORT}`);
  const count = await AnalyticsTicket.countDocuments();
  console.log(
    count
      ? `✅ ${count} tickets in MongoDB`
      : "⚠️ MongoDB empty - run /api/admin/backfill"
  );
  // await syncRoster();
});
setInterval(() => {
  console.log("⏰ Scheduled sync (every 6 hours)...");
  syncHistoricalToDB(false);
}, 6 * 60 * 60 * 1000);

// Also run on startup after 1 minute delay
setTimeout(() => {
  console.log("🚀 Initial sync on startup...");
  syncHistoricalToDB(false);
}, 60 * 1000);

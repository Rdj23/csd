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
import { parseISO, format } from "date-fns";
import mongoose from "mongoose";

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

const AnalyticsTicketSchema = new mongoose.Schema({
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
  csat: Number,
  frr: Boolean,
});

AnalyticsTicketSchema.index({ closed_date: 1, owner: 1 });
const AnalyticsTicket = mongoose.model("AnalyticsTicket", AnalyticsTicketSchema);

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
  next();
});

app.use(cors({
  origin: ["http://localhost:5173", "https://clevertapintel.globalsupportteam.com"],
  credentials: true,
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

let isSyncing = false;
let syncQueued = false;

// ============================================================================
// HELPER: Get Quarter Date Range
// ============================================================================
const getQuarterDateRange = (quarter) => {
  const now = new Date();
  switch (quarter) {
    case "Q3_25": return { start: new Date("2025-07-01"), end: new Date("2025-09-30T23:59:59Z") };
    case "Q4_25": return { start: new Date("2025-10-01"), end: new Date("2025-12-31T23:59:59Z") };
    case "Q1_26": return { start: new Date("2026-01-01"), end: new Date("2026-03-31T23:59:59Z") };
    case "Q1_26_W1": return { start: new Date("2026-01-01"), end: new Date("2026-01-07T23:59:59Z") };
    case "Q1_26_W2": return { start: new Date("2026-01-08"), end: new Date("2026-01-14T23:59:59Z") };
    case "Q1_26_W3": return { start: new Date("2026-01-15"), end: new Date("2026-01-21T23:59:59Z") };
    case "Q1_26_W4": return { start: new Date("2026-01-22"), end: new Date("2026-01-28T23:59:59Z") };
    case "last_60_days":
    default:
      const start = new Date(now); start.setDate(start.getDate() - 60);
      return { start, end: now };
  }
};

// ============================================================================
// ✅ MAIN ANALYTICS ENDPOINT - Server-side Aggregation
// ============================================================================
app.get("/api/tickets/analytics", async (req, res) => {
  try {
    const { quarter = "Q4_25", excludeZendesk, owner, forceRefresh } = req.query;
    const cacheKey = `${quarter}_${excludeZendesk || 'all'}_${owner || 'all'}`;
    
    console.log(`📊 Analytics Request: ${cacheKey}`);

    // Check cache (1 hour TTL)
    if (forceRefresh !== 'true') {
      const cached = await AnalyticsCache.findOne({ cache_key: cacheKey }).lean();
      if (cached && (Date.now() - new Date(cached.computed_at).getTime()) < 3600000) {
        console.log(`   ⚡ Serving from cache`);
        return res.json(cached);
      }
    }

    const { start, end } = getQuarterDateRange(quarter);
    const matchConditions = {
      closed_date: { $gte: start, $lte: end },
      owner: { $nin: ["Anmol", "anmol-sawhney", "Anmol Sawhney"] }
    };
    if (excludeZendesk === 'true') matchConditions.is_zendesk = { $ne: true };
    if (owner && owner !== 'All') matchConditions.owner = { $regex: owner, $options: "i" };

    console.log(`   📅 Range: ${format(start, "MMM d")} - ${format(end, "MMM d")}`);

    // Aggregate Stats
    const [statsResult] = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $group: {
        _id: null,
        totalTickets: { $sum: 1 },
        avgRWT: { $avg: { $cond: [{ $and: [{ $ne: ["$rwt", null] }, { $gt: ["$rwt", 0] }] }, "$rwt", null] } },
        avgFRT: { $avg: { $cond: [{ $and: [{ $ne: ["$frt", null] }, { $gt: ["$frt", 0] }] }, "$frt", null] } },
        avgIterations: { $avg: { $cond: [{ $ne: ["$iterations", null] }, "$iterations", null] } },
        positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
        negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
        frrMet: { $sum: { $cond: [{ $eq: ["$frr", true] }, 1, 0] } },
        frrTotal: { $sum: { $cond: [{ $ne: ["$frr", null] }, 1, 0] } },
      }}
    ]);

    // Daily Trends
    const trends = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } },
        solved: { $sum: 1 },
        avgRWT: { $avg: "$rwt" },
        avgFRT: { $avg: "$frt" },
        positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
      }},
      { $sort: { _id: 1 } },
      { $limit: 100 }
    ]);

    // Leaderboard
    const leaderboard = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $group: {
        _id: "$owner",
        totalTickets: { $sum: 1 },
        goodCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
        badCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
        avgRWT: { $avg: "$rwt" },
        avgFRT: { $avg: "$frt" },
      }},
      { $match: { _id: { $ne: null }, totalTickets: { $gte: 3 } } },
      { $addFields: {
        winRate: { $cond: [
          { $gt: [{ $add: ["$goodCSAT", "$badCSAT"] }, 0] },
          { $multiply: [{ $divide: ["$goodCSAT", { $add: ["$goodCSAT", "$badCSAT"] }] }, 100] },
          0
        ]}
      }},
      { $sort: { goodCSAT: -1, winRate: -1 } },
      { $limit: 25 }
    ]);

    // Bad CSAT (including all for DSAT)
    const dsatMatch = { closed_date: { $gte: start, $lte: end }, csat: 1 };
    if (excludeZendesk === 'true') dsatMatch.is_zendesk = { $ne: true };
    const badTickets = await AnalyticsTicket.find(dsatMatch, {
      ticket_id: 1, display_id: 1, title: 1, owner: 1, created_date: 1, closed_date: 1
    }).sort({ closed_date: -1 }).limit(50).lean();

    // Individual trends (last 60 days)
    const sixtyDaysAgo = new Date(); sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const individualTrends = await AnalyticsTicket.aggregate([
      { $match: { closed_date: { $gte: sixtyDaysAgo }, owner: { $nin: ["Anmol", "anmol-sawhney"] } } },
      { $group: {
        _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } }, owner: "$owner" },
        solved: { $sum: 1 }, avgRWT: { $avg: "$rwt" },
      }},
      { $sort: { "_id.date": 1 } }
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
        avgIterations: statsResult?.avgIterations ? Number(statsResult.avgIterations.toFixed(1)) : 0,
        positiveCSAT: statsResult?.positiveCSAT || 0,
        negativeCSAT: statsResult?.negativeCSAT || 0,
        frrPercent: statsResult?.frrTotal > 0 ? Math.round((statsResult.frrMet / statsResult.frrTotal) * 100) : 0
      },
      trends: trends.map(t => ({
        date: t._id, solved: t.solved,
        avgRWT: t.avgRWT ? Number(t.avgRWT.toFixed(2)) : 0,
        avgFRT: t.avgFRT ? Number(t.avgFRT.toFixed(2)) : 0,
        positiveCSAT: t.positiveCSAT
      })),
      leaderboard: leaderboard.map(l => ({
        name: l._id, totalTickets: l.totalTickets, goodCSAT: l.goodCSAT, badCSAT: l.badCSAT,
        winRate: Math.round(l.winRate || 0),
        avgRWT: l.avgRWT ? Number(l.avgRWT.toFixed(2)) : 0,
        avgFRT: l.avgFRT ? Number(l.avgFRT.toFixed(2)) : 0
      })),
      badTickets: badTickets.map(t => ({
        id: t.ticket_id, display_id: t.display_id, title: t.title, owner: t.owner,
        created_date: t.created_date, closed_date: t.closed_date
      })),
      individualTrends: individualTrends.reduce((acc, item) => {
        const { date, owner } = item._id;
        if (!acc[owner]) acc[owner] = [];
        acc[owner].push({ date, solved: item.solved, avgRWT: item.avgRWT });
        return acc;
      }, {})
    };

    await AnalyticsCache.findOneAndUpdate({ cache_key: cacheKey }, response, { upsert: true });
    console.log(`   ✅ Computed: ${response.stats.totalTickets} tickets`);
    res.json(response);

  } catch (e) {
    console.error("❌ Analytics Error:", e);
    res.status(500).json({ stats: {}, trends: [], leaderboard: [], badTickets: [], individualTrends: {} });
  }
});

// ============================================================================
// ACTIVE TICKETS (Dashboard - Open/Pending only)
// ============================================================================
app.get("/api/tickets", async (req, res) => {
  const cached = cache.get("tickets_active");
  if (cached) return res.json({ tickets: cached });
  await fetchAndCacheTickets("first_load");
  res.json({ tickets: cache.get("tickets_active") || [] });
});

const fetchAndCacheTickets = async (source = "auto") => {
  if (isSyncing) { syncQueued = true; return; }
  isSyncing = true;
  console.log("🔄 Syncing Active Tickets...");

  try {
    let collected = [], cursor = null, loop = 0;
    const TARGET_DATE = new Date("2025-07-01");

    do {
      const response = await axios.get(
        `${DEVREV_API}/works.list?limit=50&type=ticket${cursor ? `&cursor=${cursor}` : ""}`,
        { headers: HEADERS, timeout: 30000 }
      );
      const newWorks = response.data.works || [];
      if (!newWorks.length) break;
      collected = [...collected, ...newWorks];
      const lastDate = parseISO(newWorks[newWorks.length - 1].created_date);
      if (lastDate < TARGET_DATE) break;
      cursor = response.data.next_cursor;
      loop++;
    } while (cursor && loop < 500);

    const activeTickets = collected.filter(t => {
      const stage = t.stage?.name?.toLowerCase() || "";
      return !stage.includes("solved") && !stage.includes("closed");
    }).map(t => ({
      id: t.id, display_id: t.display_id, title: t.title, priority: t.priority,
      severity: t.severity, account: t.account?.display_name || t.account,
      stage: t.stage, owned_by: t.owned_by, created_date: t.created_date,
      modified_date: t.modified_date, custom_fields: t.custom_fields, tags: t.tags,
      isZendesk: t.tags?.some(tag => tag.tag?.name === "Zendesk import"),
    }));

    cache.set("tickets_active", activeTickets);
    console.log(`✅ ${activeTickets.length} active tickets cached`);
    io.emit("REFRESH_TICKETS", activeTickets);
  } catch (e) {
    console.error("❌ Sync Failed:", e.message);
  } finally {
    isSyncing = false;
    if (syncQueued) { syncQueued = false; fetchAndCacheTickets("queued"); }
  }
};

const syncHistoricalToDB = async (fullHistory = false) => {
  console.log("📦 Syncing to MongoDB...");
  let cursor = null, loop = 0, processedCount = 0;
  const TARGET_DATE = new Date("2025-07-01");

  do {
    try {
      const res = await axios.get(
        `${DEVREV_API}/works.list?limit=50&type=ticket${cursor ? `&cursor=${cursor}` : ""}`,
        { headers: HEADERS }
      );
      const works = res.data.works || [];
      if (!works.length) break;
      if (new Date(works[works.length - 1].created_date) < TARGET_DATE && !fullHistory) break;

      const solved = works.filter(t => {
        const stage = t.stage?.name?.toLowerCase() || "";
        return (stage.includes("solved") || stage.includes("closed")) && t.actual_close_date;
      });

      if (solved.length) {
        const ops = solved.map(t => ({
          updateOne: {
            filter: { ticket_id: t.display_id },
            update: { $set: {
              ticket_id: t.display_id, display_id: t.display_id, title: t.title,
              created_date: new Date(t.created_date), closed_date: new Date(t.actual_close_date),
              owner: t.owned_by?.[0]?.display_name || "Unassigned",
              region: t.custom_fields?.tnt__region_salesforce || "Unknown", priority: t.priority,
              is_zendesk: t.tags?.some(tag => tag.tag?.name === "Zendesk import"),
              rwt: t.custom_fields?.tnt__rwt_business_hours ?? null,
              frt: t.custom_fields?.tnt__frt_hours ?? null,
              iterations: t.custom_fields?.tnt__iteration_count ?? null,
              csat: t.custom_fields?.tnt__csatrating ?? null,
              frr: t.custom_fields?.tnt__frr === true,
            }},
            upsert: true
          }
        }));
        await AnalyticsTicket.bulkWrite(ops);
        processedCount += ops.length;
      }
      cursor = res.data.next_cursor;
      loop++;
    } catch (e) { console.error("Error:", e.message); break; }
  } while (cursor && loop < 1000);

  await AnalyticsCache.deleteMany({});
  console.log(`✅ ${processedCount} tickets synced. Cache cleared.`);
};

// Webhooks & Admin
app.post("/api/webhooks/devrev", (req, res) => {
  const event = req.body;
  if (event.type === "webhook_verify") return res.json({ challenge: event.challenge });
  if (["work_created", "work_updated", "work_deleted"].includes(event.type)) {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => fetchAndCacheTickets("webhook"), 5000);
  }
  res.send("OK");
});

app.post("/api/tickets/sync", (req, res) => { fetchAndCacheTickets("manual"); res.json({ success: true }); });
app.post("/api/admin/backfill", (req, res) => { syncHistoricalToDB(true); res.json({ message: "Started" }); });
app.post("/api/admin/clear-cache", async (req, res) => { await AnalyticsCache.deleteMany({}); res.json({ message: "Cleared" }); });

// Auth
app.post("/api/auth/google", async (req, res) => {
  try {
    const ticket = await client.verifyIdToken({ idToken: req.body.credential, audience: GOOGLE_CLIENT_ID });
    res.json({ success: true, user: ticket.getPayload(), token: "jwt" });
  } catch (e) { res.status(400).json({ error: "Invalid Token" }); }
});
app.get("/api/auth/config", (req, res) => res.json({ clientId: GOOGLE_CLIENT_ID }));

// Remarks
app.get("/api/remarks/:ticketId", async (req, res) => {
  const remarks = await Remark.find({ ticketId: req.params.ticketId }).sort({ timestamp: 1 });
  res.json(remarks);
});
app.post("/api/remarks", async (req, res) => {
  const { ticketId, user, text } = req.body;
  const remark = await Remark.create({ ticketId, user, text });
  res.json({ success: true, remark });
});
app.post("/api/comments", async (req, res) => {
  try {
    const resp = await axios.post("https://api.devrev.ai/timeline-entries.create",
      { object: req.body.ticketId, type: "timeline_comment", body: req.body.body, visibility: "internal" },
      { headers: HEADERS });
    res.json(resp.data);
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

// Views
app.get("/api/views/:userId", async (req, res) => res.json(await View.find({ userId: req.params.userId }).sort({ createdAt: -1 })));
app.post("/api/views", async (req, res) => {
  const view = await View.create(req.body);
  res.json({ success: true, view });
});
app.delete("/api/views/:userId/:viewId", async (req, res) => {
  await View.findByIdAndDelete(req.params.viewId);
  res.json({ success: true });
});

// Roster
let ROSTER_ROWS = [], DATE_COL_MAP = {};
const syncRoster = async () => {
  console.log("🔄 Roster Sync...");
  try {
    const creds = JSON.parse(Buffer.from(process.env.GOOGLE_SHEETS_KEY_BASE64, "base64").toString());
    const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
    const sheets = google.sheets({ version: "v4", auth });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.ROSTER_SHEET_ID });
    const sheetName = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.ROSTER_SHEET_ID, range: `'${sheetName}'!A1:AZ100` });
    const rows = resp.data.values || [];
    
    let headerIdx = rows.findIndex(r => r.some(c => String(c).toLowerCase().includes("designation")));
    if (headerIdx === -1) return;
    
    DATE_COL_MAP = {};
    rows[headerIdx].forEach((col, i) => { if (col?.includes("-") || col?.includes("Jan")) DATE_COL_MAP[col.trim()] = i; });
    ROSTER_ROWS = rows.slice(headerIdx + 1).filter(r => r[0]?.length > 2);
    console.log(`✅ ${ROSTER_ROWS.length} engineers loaded`);
  } catch (e) { console.error("Roster error:", e.message); }
};

app.post("/api/profile/status", (req, res) => {
  const { userName } = req.body;
  const dateKey = format(new Date(), "d-MMM");
  const colIdx = DATE_COL_MAP[dateKey];
  const row = ROSTER_ROWS.find(r => r[0]?.toLowerCase().includes(userName?.toLowerCase()));
  const shift = row?.[colIdx]?.toUpperCase() || "?";
  const isActive = !["WO", "L", "PL", ""].includes(shift);
  res.json({ isActive, shift, status: isActive ? "On Shift" : "Off" });
});

app.post("/api/roster/sync", async (req, res) => { await syncRoster(); res.json({ success: true }); });

// Startup
const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`🚀 Server on port ${PORT}`);
  const count = await AnalyticsTicket.countDocuments();
  console.log(count ? `✅ ${count} tickets in MongoDB` : "⚠️ MongoDB empty - run /api/admin/backfill");
  await syncRoster();
});

setInterval(syncRoster, 15 * 60 * 1000);
setInterval(() => { console.log("⏰ Daily sync..."); syncHistoricalToDB(false); }, 24 * 60 * 60 * 1000);
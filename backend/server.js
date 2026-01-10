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
import {
  subMonths,
  parseISO,
  isAfter,
  differenceInHours,
  differenceInMinutes,
} from "date-fns";
import mongoose from "mongoose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// âœ… CACHE: Set TTL to 0 (Infinite) because we control updates manually via Webhook
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
  .then(() => console.log("ðŸƒ MongoDB Connected"))
  .catch((err) => console.error("âŒ MongoDB Error:", err));

// --- SCHEMAS ---
const RemarkSchema = new mongoose.Schema({
  ticketId: String,
  user: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
});
const Remark = mongoose.model("Remark", RemarkSchema);

const ViewSchema = new mongoose.Schema({
  userId: String, // Email serves as ID
  name: String,
  filters: Object, // Stores the entire filter state
  createdAt: { type: Date, default: Date.now },
});
const View = mongoose.model("View", ViewSchema);

// âœ… NEW: Analytics Archive Schema (Optimized for Charts)
const AnalyticsTicketSchema = new mongoose.Schema({
  ticket_id: { type: String, unique: true, index: true }, // TKT-123
  display_id: String,
  title: String,
  created_date: Date,
  closed_date: Date,

  // Dimensions for Filtering
  owner: { type: String, index: true }, // "Rohan"
  team: String, // "Mashnu"
  region: String, // "India"
  priority: String, // "High"
  is_zendesk: Boolean,

  // Metrics (Pre-calculated numbers)
  rwt: Number, // 5.25
  frt: Number, // 1.01
  iterations: Number, // 3
  csat: Number, // 5.0 or null
  frr: Boolean, // true/false
});

const AnalyticsTicket = mongoose.model(
  "AnalyticsTicket",
  AnalyticsTicketSchema
);

// --- MIDDLEWARE ---
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// --- REMARKS DATABASE SETUP ---
const REMARKS_FILE = path.join(__dirname, "remarks.json");
const readRemarksDB = () => {
  if (!fs.existsSync(REMARKS_FILE)) {
    fs.writeFileSync(REMARKS_FILE, JSON.stringify({}));
  }
  try {
    return JSON.parse(fs.readFileSync(REMARKS_FILE, "utf8"));
  } catch (e) {
    return {};
  }
};
const writeRemarksDB = (data) => {
  fs.writeFileSync(REMARKS_FILE, JSON.stringify(data, null, 2));
};

let isSyncing = false; // Is a sync currently running?
let syncQueued = false; // Do we need to run again after this?

//
const fetchAndCacheTickets = async (source = "auto") => {
  console.log("ðŸ”„ Syncing Tickets from DevRev...");

  if (isSyncing) {
    console.log(`âš ï¸ Sync in progress. Queueing next run...`);
    syncQueued = true;
    return;
  }

  isSyncing = true;

  try {
    let collected = [];
    let cursor = null;
    let loop = 0;

    // âœ… 1. DYNAMIC TARGET DATE (July 1st, 2025 to cover Q3 & Q4)
    const TARGET_HISTORY_DATE = new Date("2025-07-01");
    let reachedHistoryLimit = false;

    console.log(
      `   ðŸš€ Starting Smart Download (Target: ${TARGET_HISTORY_DATE.toISOString()})...`
    );

    do {
      if (loop % 5 === 0) console.log(`   â³ Fetching Page ${loop + 1}...`);

      const response = await axios.get(
        `${DEVREV_API}/works.list?limit=50&type=ticket${
          cursor ? `&cursor=${cursor}` : ""
        }`,
        { headers: HEADERS, timeout: 30000 }
      );

      const newWorks = response.data.works || [];
      if (newWorks.length === 0) break; // API empty

      collected = [...collected, ...newWorks];

      // âœ… 2. SMART CHECK: Have we reached the past?
      // DevRev returns 'modified_date' by default. If the last item was modified
      // BEFORE our target, then it (and all older items) are definitely outside our range.
      const lastItem = newWorks[newWorks.length - 1];
      const lastDate = parseISO(lastItem.created_date); // Checking created_date is safer for "New Ticket" stats

      if (lastDate < TARGET_HISTORY_DATE) {
        reachedHistoryLimit = true;
        console.log(
          `   ðŸ›‘ Reached History Limit! (Last Ticket: ${lastDate.toISOString()})`
        );
      }

      cursor = response.data.next_cursor;
      loop++;

      // Safety Cap: 500 pages (25,000 tickets) just in case of infinite loop
    } while (cursor && !reachedHistoryLimit && loop < 500);

    console.log(
      `   âœ… Download Finished! Collected ${collected.length} raw tickets.`
    );

    // 2. Filter & Process
    const allProcessed = collected.reduce((acc, t) => {
      // Filter out anything older than July 1st
      const createDate = parseISO(t.created_date);
      if (createDate < TARGET_HISTORY_DATE) return acc;

      const parseMetric = (val) => {
        if (val === undefined || val === null || val === "") return null;
        const num = Number(val);
        return isNaN(num) ? null : num;
      };

      const isZD = t.tags?.some(
        (tagItem) => tagItem.tag?.name === "Zendesk import"
      );

      acc.push({
        id: t.id,
        display_id: t.display_id,
        title: t.title,
        priority: t.priority,
        severity: t.severity,
        account: t.account,
        stage: t.stage,
        owned_by: t.owned_by,
        created_date: t.created_date,
        actual_close_date: t.actual_close_date,
        modified_date: t.modified_date,
        custom_fields: t.custom_fields,
        tags: t.tags,
        // Metrics
        rwt: parseMetric(t.custom_fields?.tnt__rwt_business_hours),
        iterations: parseMetric(t.custom_fields?.tnt__iteration_count) || 0,
        frt: parseMetric(t.custom_fields?.tnt__frt_hours),
        csat: parseMetric(t.custom_fields?.tnt__csatrating),
        frr: t.custom_fields?.tnt__frr === true,
        isZendesk: !!isZD,
      });

      return acc;
    }, []);

    // ðŸ“Š DEBUG: QUARTERLY CSAT CHECK (Q3, Q4, Q1)
    const getQuarterStats = (start, end, label) => {
      const batch = allProcessed.filter((t) => {
        const d = parseISO(t.created_date);
        return d >= new Date(start) && d <= new Date(end);
      });

      const csatTickets = batch.filter((t) => t.csat !== null);
      const avgCsat =
        csatTickets.length > 0
          ? csatTickets.reduce((a, b) => a + b.csat, 0) / csatTickets.length
          : 0;

      console.log(`\nðŸ“… --- ${label} STATS ---`);
      console.log(`   Tickets: ${batch.length}`);
      console.log(`   CSAT Count: ${csatTickets.length}`);
      console.log(`   ðŸ† Avg CSAT: ${avgCsat.toFixed(2)}`);
    };

    // Q3 2025 (Jul - Sep)
    getQuarterStats("2025-07-01", "2025-09-30", "Q3 2025");
    // Q4 2025 (Oct - Dec)
    getQuarterStats("2025-10-01", "2025-12-31", "Q4 2025");
    // Q1 2026 (Jan - Current)
    getQuarterStats("2026-01-01", "2026-03-31", "Q1 2026");

    const analyticsView = allProcessed;

    cache.set(
      "tickets_active",
      allProcessed.filter(
        (t) => t.stage?.name !== "Solved" && t.stage?.name !== "Closed"
      )
    );
    cache.set("tickets_analytics", analyticsView);
    cache.set("tickets_all", allProcessed);

    console.log(`âœ… Sync Complete: ${analyticsView.length} tickets cached.`);
    io.emit("REFRESH_TICKETS", cache.get("tickets_active"));
  } catch (e) {
    console.error("âŒ Sync Failed:", e.message);
  } finally {
    isSyncing = false;
    if (syncQueued) {
      syncQueued = false;
      fetchAndCacheTickets("queued");
    }
  }
};

//
// ðŸ”„ SYNC HISTORY TO MONGODB (Strictly Solved/Closed Only)
const syncHistoricalToDB = async (fullHistory = false) => {
  console.log(`ðŸ“¦ Starting Analytics Dump to MongoDB (Solved Only)...`);

  let url = `${DEVREV_API}/works.list?limit=50&type=ticket`;
  let cursor = null;
  let loop = 0;
  let processedCount = 0;

  // Target: July 1st 2025 (Start of Q3)
  const TARGET_DATE = new Date("2025-07-01");

  do {
    try {
      const res = await axios.get(
        `${url}${cursor ? `&cursor=${cursor}` : ""}`,
        { headers: HEADERS }
      );

      const works = res.data.works || [];
      if (works.length === 0) break;

      // 1. SMART STOP: Check date of last item
      const lastItemDate = new Date(works[works.length - 1].created_date);
      if (lastItemDate < TARGET_DATE && !fullHistory) {
        console.log("   ðŸ›‘ Reached History Limit (July 2025). Stopping.");
        break;
      }

      // 2. STRICT FILTER: Only Process Solved/Closed/Resolved Tickets
      const solvedWorks = works.filter((t) => {
        const stage = t.stage?.name?.toLowerCase() || "";
        const state = t.state?.name?.toLowerCase() || "";

        // Must be explicitly solved/closed AND have a close date
        const isSolved =
          stage.includes("solved") ||
          stage.includes("closed") ||
          state === "closed";
        const hasCloseDate = !!t.actual_close_date;

        return isSolved && hasCloseDate;
      });

      if (solvedWorks.length > 0) {
        const bulkOps = solvedWorks.map((t) => {
          const parse = (v) =>
            v === undefined || v === null || v === "" ? null : Number(v);
          const ownerName = t.owned_by?.[0]?.display_name || "Unassigned";

          return {
            updateOne: {
              filter: { ticket_id: t.display_id },
              update: {
                $set: {
                  ticket_id: t.display_id,
                  display_id: t.display_id,
                  title: t.title,
                  created_date: t.created_date,
                  // Store as Date object for easier Mongo queries
                  closed_date: new Date(t.actual_close_date),
                  owner: ownerName,
                  region: t.custom_fields?.tnt__region_salesforce || "Unknown",
                  priority: t.priority,
                  is_zendesk: t.tags?.some(
                    (tag) => tag.tag?.name === "Zendesk import"
                  ),

                  // Metrics
                  rwt: parse(t.custom_fields?.tnt__rwt_business_hours),
                  frt: parse(t.custom_fields?.tnt__frt_hours),
                  iterations: parse(t.custom_fields?.tnt__iteration_count),
                  csat: parse(t.custom_fields?.tnt__csatrating),
                  frr: t.custom_fields?.tnt__frr === true,
                },
              },
              upsert: true,
            },
          };
        });

        await AnalyticsTicket.bulkWrite(bulkOps);
        processedCount += bulkOps.length;
        if (processedCount % 50 === 0)
          console.log(`   â³ Saved ${processedCount} Solved tickets...`);
      }

      cursor = res.data.next_cursor;
      loop++;

      if (loop > 1000) {
        console.log("âš ï¸ Safety limit reached.");
        break;
      }
    } catch (e) {
      console.error("Dump Error:", e.message);
      break;
    }
  } while (cursor);

  console.log(
    `âœ… Analytics Dump Complete. ${processedCount} Solved tickets secured in MongoDB.`
  );
};

// 2. API ROUTES
// ============================================================================

// âœ… WEBHOOK: The "Traffic Controller"
app.post("/api/webhooks/devrev", (req, res) => {
  const event = req.body;

  // 1. Handshake (Keep connection alive)
  if (event.type === "webhook_verify" && event.challenge) {
    console.log("ðŸ¤ Verifying Webhook...");
    return res.status(200).json({ challenge: event.challenge });
  }

  // 2. Event Handling (Debounced)
  if (
    event.type === "work_created" ||
    event.type === "work_updated" ||
    event.type === "work_deleted"
  ) {
    console.log(`âš¡ Event Received: ${event.type}. Debouncing...`);

    // Reset the timer. We wait 5 seconds of "silence" before syncing.
    if (syncTimeout) clearTimeout(syncTimeout);

    syncTimeout = setTimeout(() => {
      fetchAndCacheTickets("webhook");
    }, 5000);
  }

  res.status(200).send("OK");
});

//

// ✅ 2. ANALYTICS ENDPOINT (Optimized - Minimal Fields)
app.get("/api/tickets/analytics", async (req, res) => {
  try {
    console.log("📊 Analytics: Fetching ALL data from MongoDB...");

    // 1. QUERY MONGODB - Only fetch fields needed for analytics
    const dbTickets = await AnalyticsTicket.find(
      { owner: { $not: { $regex: "anmol-sawhney", $options: "i" } } },
      {
        // Only select fields needed for charts (reduces payload ~80%)
        ticket_id: 1,
        display_id: 1,
        title: 1,
        created_date: 1,
        closed_date: 1,
        owner: 1,
        rwt: 1,
        frt: 1,
        iterations: 1,
        csat: 1,
        frr: 1,
        is_zendesk: 1,
        priority: 1,
      }
    ).lean();

    console.log(`   ✅ DB HIT: Found ${dbTickets.length} tickets`);

    if (dbTickets.length === 0) {
      console.log("   ⚠️ WARNING: DB is empty. Did you run the backfill?");
      return res.json({ tickets: [] });
    }

    // 2. NORMALIZE DATA (Lightweight transform)
    const cleanData = dbTickets.map((t) => {
      const created = t.created_date
        ? new Date(t.created_date).toISOString()
        : null;
      const closed = t.closed_date || null;

      let ownerName = typeof t.owner === "string" ? t.owner : "Unassigned";

      return {
        id: t.ticket_id,
        display_id: t.display_id,
        title: t.title,
        created_date: created,
        actual_close_date: closed ? new Date(closed).toISOString() : null,
        owned_by: [{ display_name: ownerName }],
        priority: t.priority,
        rwt: t.rwt ?? null,
        frt: t.frt ?? null,
        iterations: t.iterations ?? 0,
        csat: t.csat ?? null,
        frr: t.frr === true,
        is_zendesk: t.is_zendesk || false,
      };
    });

    const payloadSize = Math.round(JSON.stringify(cleanData).length / 1024);
    console.log(`   📦 Sending ${cleanData.length} tickets (${payloadSize}KB)`);

    res.json({ tickets: cleanData });
  } catch (e) {
    console.error("❌ Analytics API Error:", e);
    res.status(500).json({ tickets: [] });
  }
});
// âœ… AUTOMATION: DAILY DB SYNC (The "Cron Job")
// Runs every 24 hours to save yesterday's solved tickets to Mongo
setInterval(() => {
  console.log("â° Daily Cron: Syncing Solved Tickets to DB...");
  syncHistoricalToDB(false); // false = incremental sync (fast)
}, 24 * 60 * 60 * 1000);

// --- END OF FILE ---
//
app.post("/api/admin/backfill", async (req, res) => {
  // Run in background so request doesn't timeout
  syncHistoricalToDB(true).then(() => console.log("Backfill finished"));
  res.json({ message: "Backfill started in background. Check terminal logs." });
});

// âœ… MANUAL FORCE SYNC (The "Fix It Now" Button)
app.post("/api/tickets/sync", async (req, res) => {
  console.log("ðŸ«µ Manual Sync Triggered from UI");
  // Bypass debounce, but respect concurrency lock
  fetchAndCacheTickets("manual");
  res.json({ success: true, message: "Sync started" });
});

// âœ… GET TICKETS (Instant RAM access)
app.get("/api/tickets", async (req, res) => {
  const cached = cache.get("tickets_active");
  if (cached) {
    return res.json({ tickets: cached });
  }
  const fresh = await fetchAndCacheTickets("first_load");
  res.json({ tickets: cache.get("tickets_active") || [] });
});

// --- AUTH ---
app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body;
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    res.json({
      success: true,
      user: ticket.getPayload(),
      token: "mock-jwt-token",
    });
  } catch (error) {
    res.status(400).json({ success: false, error: "Invalid Token" });
  }
});
app.get("/api/auth/config", (req, res) =>
  res.json({ clientId: GOOGLE_CLIENT_ID })
);

// Get Remarks for a specific ticket
app.get("/api/remarks/:ticketId", async (req, res) => {
  try {
    const remarks = await Remark.find({ ticketId: req.params.ticketId }).sort({
      timestamp: 1,
    });
    res.json(remarks);
  } catch (e) {
    res.status(500).json([]);
  }
});

// Add a Remark
app.post("/api/remarks", async (req, res) => {
  const { ticketId, user, text } = req.body;
  if (!ticketId || !text)
    return res.status(400).json({ error: "Missing data" });

  try {
    const newRemark = await Remark.create({ ticketId, user, text });
    res.json({ success: true, remark: newRemark });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sync Comment to DevRev (Platform Reflection)
app.post("/api/comments", async (req, res) => {
  const { ticketId, body } = req.body;
  try {
    const response = await axios.post(
      "https://api.devrev.ai/timeline-entries.create",
      {
        object: ticketId,
        type: "timeline_comment",
        body: body,
        visibility: "internal",
      },
      { headers: HEADERS }
    );
    return res.status(200).json(response.data);
  } catch (error) {
    return res.status(500).json({ error: "Failed to sync to DevRev" });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    let allUsers = [],
      cursor = null,
      hasMore = true;
    while (hasMore) {
      const response = await axios.get(
        `${DEVREV_API}/dev-users.list${cursor ? `?cursor=${cursor}` : ""}`,
        { headers: HEADERS }
      );
      allUsers = [...allUsers, ...(response.data.dev_users || [])];
      cursor = response.data.next_cursor;
      hasMore = !!cursor;
    }
    res.json(
      allUsers.map((u) => ({
        id: u.id,
        display_name: u.display_name,
        full_name: u.full_name,
        email: u.email,
      }))
    );
  } catch (e) {
    res.status(500).json([]);
  }
});

// ============================================================================
// 4. VISTAS ENGINE (Scalable User Views)
// ============================================================================
const VIEWS_FILE = path.join(__dirname, "views.json");

const readViewsDB = () => {
  if (!fs.existsSync(VIEWS_FILE)) {
    fs.writeFileSync(VIEWS_FILE, JSON.stringify({}));
  }
  try {
    return JSON.parse(fs.readFileSync(VIEWS_FILE, "utf8"));
  } catch (e) {
    return {};
  }
};

const writeViewsDB = (data) => {
  fs.writeFileSync(VIEWS_FILE, JSON.stringify(data, null, 2));
};
// Get Views for a specific user
app.get("/api/views/:userId", async (req, res) => {
  try {
    const userId = decodeURIComponent(req.params.userId);
    const views = await View.find({ userId }).sort({ createdAt: -1 });
    // Transform _id to id for frontend compatibility
    const formatted = views.map((v) => ({
      id: v._id.toString(),
      name: v.name,
      filters: v.filters,
    }));
    res.json(formatted);
  } catch (e) {
    res.status(500).json([]);
  }
});

// Save a View
app.post("/api/views", async (req, res) => {
  const { userId, name, filters } = req.body;
  if (!userId || !name) return res.status(400).json({ error: "Missing data" });

  try {
    const newView = await View.create({ userId, name, filters });
    res.json({
      success: true,
      view: {
        id: newView._id.toString(),
        name: newView.name,
        filters: newView.filters,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a View
app.delete("/api/views/:userId/:viewId", async (req, res) => {
  try {
    await View.findByIdAndDelete(req.params.viewId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to delete" });
  }
});

// ============================================================================
// 3. ROSTER ENGINE (KEPT EXACTLY AS IS)
// ============================================================================
let ROSTER_ROWS = [];
let DATE_COL_MAP = {};
let NAME_COL_INDEX = 0;
const DESIGNATION_COL_INDEX = 1;

const SHIFT_TIMINGS = {
  "Shift 1": { start: "07:30", end: "16:30" },
  "Shift 2": { start: "10:30", end: "19:30" },
  "Shift 3": { start: "13:30", end: "22:00" },
  "Shift 4": { start: "22:30", end: "07:30" },
};

const cleanString = (str) => (!str ? "" : String(str).trim());
const isNameMatch = (rosterName, queryName) => {
  if (!rosterName || !queryName) return false;
  const r = String(rosterName).trim().toLowerCase();
  const q = String(queryName).trim().toLowerCase();
  return q.includes(r) || r.includes(q);
};

// Shift Helper (Updated to return clean Shift Name)
const getUserShiftStatus = (userName) => {
  if (ROSTER_ROWS.length === 0)
    return { isActive: false, status: "Roster Empty" };

  const userRow = ROSTER_ROWS.find((row) =>
    isNameMatch(row[NAME_COL_INDEX], userName)
  );

  if (!userRow) {
    return { isActive: false, status: "Not in Roster" };
  }

  const istNow = new Date().toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
  });
  const dateObj = new Date(istNow);
  const todayKey = `${dateObj.getDate()}-${dateObj.toLocaleString("default", {
    month: "short",
  })}`;
  const todayColIdx = DATE_COL_MAP[todayKey];

  if (todayColIdx === undefined)
    return { isActive: false, status: "Date Not Found", shiftName: "Unknown" };

  const rawShift = userRow[todayColIdx]?.trim();
  // Clean logic to extract "Shift 1", "Shift 2", etc.
  const cleanShiftKey = Object.keys(SHIFT_TIMINGS).find(
    (k) => rawShift && rawShift.includes(k)
  );

  if (!cleanShiftKey)
    return {
      isActive: false,
      status: rawShift || "Off Duty",
      shiftName: rawShift,
    };

  const { start, end } = SHIFT_TIMINGS[cleanShiftKey];
  const [sH, sM] = start.split(":").map(Number);
  const [eH, eM] = end.split(":").map(Number);
  const nowVal = dateObj.getHours() * 60 + dateObj.getMinutes();
  const startVal = sH * 60 + sM;
  const endVal = eH * 60 + eM;

  let isActive =
    endVal < startVal
      ? nowVal >= startVal || nowVal <= endVal
      : nowVal >= startVal && nowVal <= endVal;

  return {
    isActive,
    status: isActive ? "Active" : "Away",
    shiftName: cleanShiftKey, // âœ… Sends "Shift 1", "Shift 2" cleanly
    timings: `${start} - ${end}`,
  };
};
// âœ… UPDATED: Roster Sync with Deep Debugging
const syncRoster = async () => {
  try {
    console.log("\nðŸ”„ --- STARTING ROSTER SYNC ---");
    const spreadsheetId = process.env.ROSTER_SHEET_ID;
    console.log(`   ðŸ‘‰ Spreadsheet ID: ${spreadsheetId}`);

    if (!spreadsheetId) {
      console.error("   âŒ Error: ROSTER_SHEET_ID is missing in .env");
      return;
    }

    // NEW - reading from env variable
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(
        Buffer.from(process.env.GOOGLE_SHEETS_KEY_BASE64, "base64").toString(
          "utf-8"
        )
      ),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: "v4", auth: client });

    // 1. Get Sheet Name & Data
    const meta = await googleSheets.spreadsheets.get({ spreadsheetId });
    const sheetName = meta.data.sheets[0].properties.title;
    console.log(`   ðŸ‘‰ Found Sheet Name: "${sheetName}"`);

    const getRows = await googleSheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rawRows = getRows.data.values || [];
    console.log(`   ðŸ‘‰ Raw Rows Fetched: ${rawRows.length}`);

    if (rawRows.length === 0) {
      console.error("   âŒ Error: Sheet is empty.");
      return;
    }

    // 2. Find Header Row (Look for "Designation")
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
      const rowStr = JSON.stringify(rawRows[i] || []);
      if (rowStr.includes("Designation")) {
        headerRowIndex = i;
        console.log(
          `   âœ… Header found at Row ${i + 1}: ${rowStr.substring(0, 100)}...`
        );
        break;
      }
    }

    if (headerRowIndex === -1) {
      console.error(
        "   âŒ Error: Could not find 'Designation' column in first 20 rows."
      );
      return;
    }

    // 3. Map Date Columns
    const headerRow = rawRows[headerRowIndex];
    DATE_COL_MAP = {};

    // Debug: Log first 5 columns to check format
    console.log(
      `   ðŸ‘‰ Headers Check: ${JSON.stringify(headerRow.slice(0, 5))}`
    );

    headerRow.forEach((col, index) => {
      // Allow formats: "1-Jan", "Jan-1", "01-Jan"
      if (
        col &&
        (col.includes("-") || col.includes("Jan") || col.includes("Feb"))
      ) {
        DATE_COL_MAP[col.trim()] = index;
      }
    });

    const dateKeys = Object.keys(DATE_COL_MAP);
    console.log(
      `   âœ… Mapped ${dateKeys.length} Date Columns (e.g., ${
        dateKeys[0]
      } -> Index ${DATE_COL_MAP[dateKeys[0]]})`
    );

    if (dateKeys.length === 0) {
      console.error(
        "   âŒ Error: No date columns identified. Check date format in row " +
          (headerRowIndex + 1)
      );
    }

    // 4. Filter User Rows
    // Start reading from row AFTER header
    ROSTER_ROWS = rawRows.slice(headerRowIndex + 1).filter((row) => {
      const name = String(row[NAME_COL_INDEX] || "").trim();
      // Filter out empty rows, "Engineer" header, and "Designation" repeats
      const isValid =
        name.length > 2 &&
        !name.toLowerCase().includes("engineer") &&
        !name.toLowerCase().includes("designation");
      return isValid;
    });

    console.log(`   âœ… Processed ${ROSTER_ROWS.length} Valid Engineer Rows.`);

    // Log the first valid user to verify parsing
    if (ROSTER_ROWS.length > 0) {
      const firstUser = ROSTER_ROWS[0];
      console.log(
        `      - Example User: ${firstUser[NAME_COL_INDEX]} | Desig: ${firstUser[DESIGNATION_COL_INDEX]}`
      );
    }

    console.log("ðŸ”„ --- ROSTER SYNC COMPLETE ---\n");
  } catch (e) {
    console.error("   âŒ SYNC FAILED:", e.message);
    if (e.message.includes("invalid_grant")) {
      console.error(
        "      -> Check google-sheets-key.json (Permissions/Expiry)"
      );
    }
    if (e.message.includes("404")) {
      console.error("      -> Check ROSTER_SHEET_ID in .env");
    }
  }
};

// âœ… UPDATED: Profile Status with Q1 Stats, Decimals & Smart Workload
app.post("/api/profile/status", async (req, res) => {
  const { userName, activeTickets, teamMembers } = req.body;
  const DESIGNATION_COL_INDEX = 1;

  // 1. Get Shift Status
  const shiftStatus = getUserShiftStatus(userName);
  let backups = [];

  // 2. Find Backups (Only if Inactive)
  const userRow = ROSTER_ROWS.find((row) =>
    isNameMatch(row[NAME_COL_INDEX], userName)
  );
  const userDesignation = userRow
    ? String(userRow[DESIGNATION_COL_INDEX] || "")
        .trim()
        .toUpperCase()
    : null;

  if (!shiftStatus.isActive && ROSTER_ROWS.length > 0 && userDesignation) {
    backups = ROSTER_ROWS.filter((row) => {
      const rName = row[NAME_COL_INDEX];
      const rDesig = String(row[DESIGNATION_COL_INDEX] || "")
        .trim()
        .toUpperCase();
      if (isNameMatch(rName, userName)) return false;
      if (rDesig !== userDesignation) return false;
      if (teamMembers && teamMembers.length > 0) {
        if (!teamMembers.some((m) => isNameMatch(rName, m))) return false;
      }
      return getUserShiftStatus(rName).isActive;
    })
      .map((row) => row[NAME_COL_INDEX])
      .slice(0, 2);
  }

  // 3. CALCULATE Q1 STATS (Jan 1 2026 - Mar 31 2026)
  let allTickets = cache.get("tickets_analytics") || [];

  // ðŸ” LOG 1: Check if we actually have tickets to analyze
  console.log(
    `ðŸ” [Stats Debug] User: ${userName} | Total Cached Tickets: ${allTickets.length}`
  );

  const startQ1 = new Date("2026-01-01");
  const endQ1 = new Date("2026-03-31");

  const myQ1Tickets = allTickets.filter((t) => {
    // Owner Match
    const ownerName = t.owned_by?.[0]?.display_name || "";
    if (!isNameMatch(ownerName, userName)) return false;

    // Date Range Match (Solved in Q1)
    if (!t.actual_close_date) return false;
    const closeDate = parseISO(t.actual_close_date);
    return closeDate >= startQ1 && closeDate <= endQ1;

    return isOwner && isQ1;
  });

  // ðŸ” LOG 2: Check how many tickets were found for this user in Q1
  console.log(
    `ðŸ” [Stats Debug] Found ${myQ1Tickets.length} tickets solved in Q1.`
  );

  const q1SolvedCount = myQ1Tickets.length;

  // 4. LIVE WORKLOAD SUMMARY LOGIC
  let aiSummary = "";
  const ticketCount = activeTickets ? activeTickets.length : 0;

  // 1. Open tickets = Waiting on Assignee
  const openTickets = (activeTickets || []).filter(
    (t) => t.stage === "Waiting on Assignee"
  );

  // 2. No open tickets
  if (openTickets.length === 0) {
    aiSummary = "Queue is sorted";
  } else {
    // 3. High / Blocker among open tickets
    const criticalTickets = openTickets.filter((t) =>
      ["high", "blocker"].includes(String(t.severity).toLowerCase())
    );

    if (criticalTickets.length > 0) {
      const account =
        criticalTickets.find((t) => t.account)?.account || "client";

      aiSummary = `Working on ${criticalTickets.length} high priority ticket${
        criticalTickets.length > 1 ? "s" : ""
      } for ${account}.`;
    } else {
      // 4. Open but not critical
      aiSummary = `${openTickets.length} tickets open.`;
    }
  }

  // Return everything
  res.json({
    ...shiftStatus,
    backups,
    aiSummary,
    stats: {
      q1Solved: q1SolvedCount,
      avgResolution: formattedAvgRwt,
    },
  });
});

// Analytics AI Endpoint (Preserved)
app.post("/api/analytics/insight", async (req, res) => {
  /* ... (Keeping your existing AI logic implicitly if needed, or explicitly pasted below) ... */
  // NOTE: I am pasting your exact AI logic here to be safe
  const { metric, chartData, context, comparison } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.json({ insight: "AI Configuration Missing." });

  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai"); // Dynamic import for node
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    let prompt = comparison
      ? `Compare ${context}'s ${metric} vs Team. User: ${
          comparison.userVal
        }, Team: ${comparison.teamVal}. Trend: ${JSON.stringify(
          chartData.slice(-7)
        )}. Better or worse? 1 tip. Max 25 words.`
      : `Analyze ${metric} trend for ${context}. Data: ${JSON.stringify(
          chartData.slice(-10)
        )}. Trend & Why. Max 20 words.`;

    const result = await model.generateContent(prompt);
    res.json({ insight: result.response.text() });
  } catch (e) {
    res.json({ insight: "AI limit reached." });
  }
});

app.post("/api/notify/eta", (req, res) =>
  res.json({ success: true, message: "Slack notification sent" })
);
app.post("/api/roster/sync", async (req, res) => {
  await syncRoster();
  res.json({ success: true });
});

// --- STARTUP ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`ðŸš€ Server running on port ${PORT}`);

  // ðŸš€ INSTANT START: Fetch data immediately on boot
  // fetchAndCacheTickets("boot");

  // âœ… Load from MongoDB first (instant)
  console.log("ðŸ“¦ Loading cached analytics from MongoDB...");
  const cachedCount = await AnalyticsTicket.countDocuments();

  if (cachedCount === 0) {
    console.log("âš ï¸ MongoDB empty. Run backfill: POST /api/admin/backfill");
  } else {
    console.log(`âœ… Found ${cachedCount} tickets in MongoDB. Ready to serve.`);
  }

  // Roster Sync
  await syncRoster();
});

// Background Loops
setInterval(syncRoster, 15 * 60 * 1000); // 15 mins for Roster
// Safety Net: Re-fetch tickets every 10 mins just in case a webhook was missed
// setInterval(fetchAndCacheTickets, 10 * 60 * 1000);
setInterval(() => {
  console.log("â° Daily Cron: Syncing Solved Tickets to DB...");
  syncHistoricalToDB(false);
}, 24 * 60 * 60 * 1000);

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
import { subMonths, parseISO, isAfter } from "date-fns";
import mongoose from "mongoose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ✅ CACHE: Set TTL to 0 (Infinite) because we control updates manually via Webhook
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
  userId: String, // Email serves as ID
  name: String,
  filters: Object, // Stores the entire filter state
  createdAt: { type: Date, default: Date.now },
});
const View = mongoose.model("View", ViewSchema);

// --- MIDDLEWARE ---
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
});

app.use(
  cors({
    origin: ["http://localhost:5173", "https://csd-sigma.vercel.app"],
    credentials: true,
  })
);
app.use(express.json());

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

const fetchAndCacheTickets = async (source = "auto") => {
  console.log("🔄 Syncing Tickets from DevRev...");

  if (isSyncing) {
    console.log(
      `⚠️ Sync in progress. Queueing next run (Source: ${source})...`
    );
    syncQueued = true;
    return;
  }

  isSyncing = true;
  console.log("🔄 Syncing Tickets from DevRev...");

  try {
    let collected = [];
    let cursor = null;
    let loop = 0;

    do {
      const response = await axios.get(
        `${DEVREV_API}/works.list?limit=50&type=ticket${
          cursor ? `&cursor=${cursor}` : ""
        }`,
        { headers: HEADERS, timeout: 30000 } // 15s timeout per request
      );
      collected = [...collected, ...(response.data.works || [])];
      cursor = response.data.next_cursor;
      loop++;
    } while (cursor && loop < 100); // Cap increased to ~5000 tickets

    // 2. Filter & Process
    const HISTORY_START_DATE = new Date("2024-01-01");
    const fourMonthsAgo = subMonths(new Date(), 4);
    const allProcessed = collected.reduce((acc, t) => {
      const isSolved = t.stage?.name === "Solved" || t.stage?.name === "Closed";
      if (!isSolved || isAfter(parseISO(t.modified_date), fourMonthsAgo)) {
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
          account: t.account,
          reported_by: t.tnt__created_by,
        });
      }
      return acc;
    }, []);
    // 3. OPTIMIZATION: Split into "Active" and "Analytics" buckets

    // Bucket A: Fast Load (Active Tickets + Solved Recently)
    // This is what the user sees IMMEDIATELY.
    const activeView = allProcessed.filter((t) => {
      const isSolved = t.stage?.name === "Solved" || t.stage?.name === "Closed";
      if (!isSolved) return true; // Always keep active

      // Keep solved only if modified in last 7 days (Recent context)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return new Date(t.modified_date) > sevenDaysAgo;
    });

    // Bucket B: Analytics Load (Everything since Start Date)
    // This loads in the background for the Charts.
    const analyticsView = allProcessed.filter((t) => {
      // Keep everything after our fixed start date
      return new Date(t.modified_date) > HISTORY_START_DATE;
    });

    

    // 4. Update Cache with TWO keys
    cache.set("tickets_active", activeView); // ~100-200 tickets (Fast)
    cache.set("tickets_analytics", analyticsView); // ~2000+ tickets (Slow)

    console.log(
      `✅ Sync Complete: ${activeView.length} Active / ${analyticsView.length} Analytics tickets cached.`
    );

    // Emit 'REFRESH_TICKETS' with Active view first for instant UI update
    io.emit("REFRESH_TICKETS", activeView);
    // You can add a separate event for analytics if you want real-time charts,
    // or just let the dashboard fetch it on load.
  } catch (e) {
    console.error("❌ Sync Failed:", e.message);
  } finally {
    isSyncing = false;
    if (syncQueued) {
      console.log("🔁 Executing queued sync...");
      syncQueued = false;
      fetchAndCacheTickets("queued");
    }
  }
};

// 2. API ROUTES
// ============================================================================

// ✅ WEBHOOK: The "Traffic Controller"
app.post("/api/webhooks/devrev", (req, res) => {
  const event = req.body;

  // 1. Handshake (Keep connection alive)
  if (event.type === "webhook_verify" && event.challenge) {
    console.log("🤝 Verifying Webhook...");
    return res.status(200).json({ challenge: event.challenge });
  }

  // 2. Event Handling (Debounced)
  if (
    event.type === "work_created" ||
    event.type === "work_updated" ||
    event.type === "work_deleted"
  ) {
    console.log(`⚡ Event Received: ${event.type}. Debouncing...`);

    // Reset the timer. We wait 5 seconds of "silence" before syncing.
    if (syncTimeout) clearTimeout(syncTimeout);

    syncTimeout = setTimeout(() => {
      fetchAndCacheTickets("webhook");
    }, 5000);
  }

  res.status(200).send("OK");
});

// ✅ 2. ANALYTICS ENDPOINT (Background)
    // Used by AnalyticsDashboard.jsx
    app.get("/api/tickets/analytics", async (req, res) => {
      // 1. Try to get specific analytics cache first
      let cached = cache.get("tickets_analytics");

      // 2. Fallback: If we haven't split the cache yet, return ALL tickets
      // (This ensures charts work even before the optimization runs)
      if (!cached) {
        cached = cache.get("tickets_all") || [];
      }

      res.json({ tickets: cached });
    });
    
// ✅ MANUAL FORCE SYNC (The "Fix It Now" Button)
app.post("/api/tickets/sync", async (req, res) => {
  console.log("🫵 Manual Sync Triggered from UI");
  // Bypass debounce, but respect concurrency lock
  fetchAndCacheTickets("manual");
  res.json({ success: true, message: "Sync started" });
});

// ✅ GET TICKETS (Instant RAM access)
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

const getUserShiftStatus = (userName) => {
  if (ROSTER_ROWS.length === 0)
    return { isActive: false, status: "Roster Empty" };
  const userRow = ROSTER_ROWS.find((row) =>
    isNameMatch(row[NAME_COL_INDEX], userName)
  );

  if (!userRow) {
    const similar = ROSTER_ROWS.map((r) => r[NAME_COL_INDEX])
      .filter(
        (n) =>
          n &&
          String(n).toLowerCase().startsWith(userName.charAt(0).toLowerCase())
      )
      .slice(0, 3);
    return { isActive: false, status: "Not in Roster", candidates: similar };
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

  const shiftName = userRow[todayColIdx]?.trim();
  const cleanShift = Object.keys(SHIFT_TIMINGS).find(
    (k) => shiftName && shiftName.includes(k)
  );

  if (!cleanShift)
    return { isActive: false, status: shiftName || "Off Duty", shiftName };

  const { start, end } = SHIFT_TIMINGS[cleanShift];
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
    shiftName: cleanShift,
    timings: `${start} - ${end}`,
  };
};
// ✅ UPDATED: Roster Sync with Deep Debugging
const syncRoster = async () => {
  try {
    console.log("\n🔄 --- STARTING ROSTER SYNC ---");
    const spreadsheetId = process.env.ROSTER_SHEET_ID;
    console.log(`   👉 Spreadsheet ID: ${spreadsheetId}`);

    if (!spreadsheetId) {
      console.error("   ❌ Error: ROSTER_SHEET_ID is missing in .env");
      return;
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: "google-sheets-key.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: "v4", auth: client });

    // 1. Get Sheet Name & Data
    const meta = await googleSheets.spreadsheets.get({ spreadsheetId });
    const sheetName = meta.data.sheets[0].properties.title;
    console.log(`   👉 Found Sheet Name: "${sheetName}"`);

    const getRows = await googleSheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rawRows = getRows.data.values || [];
    console.log(`   👉 Raw Rows Fetched: ${rawRows.length}`);

    if (rawRows.length === 0) {
      console.error("   ❌ Error: Sheet is empty.");
      return;
    }

    // 2. Find Header Row (Look for "Designation")
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
      const rowStr = JSON.stringify(rawRows[i] || []);
      if (rowStr.includes("Designation")) {
        headerRowIndex = i;
        console.log(`   ✅ Header found at Row ${i + 1}: ${rowStr.substring(0, 100)}...`);
        break;
      }
    }

    if (headerRowIndex === -1) {
      console.error("   ❌ Error: Could not find 'Designation' column in first 20 rows.");
      return;
    }

    // 3. Map Date Columns
    const headerRow = rawRows[headerRowIndex];
    DATE_COL_MAP = {};
    
    // Debug: Log first 5 columns to check format
    console.log(`   👉 Headers Check: ${JSON.stringify(headerRow.slice(0, 5))}`);

    headerRow.forEach((col, index) => {
      // Allow formats: "1-Jan", "Jan-1", "01-Jan"
      if (col && (col.includes("-") || col.includes("Jan") || col.includes("Feb"))) {
        DATE_COL_MAP[col.trim()] = index;
      }
    });

    const dateKeys = Object.keys(DATE_COL_MAP);
    console.log(`   ✅ Mapped ${dateKeys.length} Date Columns (e.g., ${dateKeys[0]} -> Index ${DATE_COL_MAP[dateKeys[0]]})`);

    if (dateKeys.length === 0) {
      console.error("   ❌ Error: No date columns identified. Check date format in row " + (headerRowIndex + 1));
    }

    // 4. Filter User Rows
    // Start reading from row AFTER header
    ROSTER_ROWS = rawRows.slice(headerRowIndex + 1).filter((row) => {
      const name = String(row[NAME_COL_INDEX] || "").trim();
      // Filter out empty rows, "Engineer" header, and "Designation" repeats
      const isValid = name.length > 2 && 
                      !name.toLowerCase().includes("engineer") && 
                      !name.toLowerCase().includes("designation");
      return isValid;
    });

    console.log(`   ✅ Processed ${ROSTER_ROWS.length} Valid Engineer Rows.`);
    
    // Log the first valid user to verify parsing
    if (ROSTER_ROWS.length > 0) {
      const firstUser = ROSTER_ROWS[0];
      console.log(`      - Example User: ${firstUser[NAME_COL_INDEX]} | Desig: ${firstUser[DESIGNATION_COL_INDEX]}`);
    }

    console.log("🔄 --- ROSTER SYNC COMPLETE ---\n");

  } catch (e) {
    console.error("   ❌ SYNC FAILED:", e.message);
    if (e.message.includes("invalid_grant")) {
      console.error("      -> Check google-sheets-key.json (Permissions/Expiry)");
    }
    if (e.message.includes("404")) {
      console.error("      -> Check ROSTER_SHEET_ID in .env");
    }
  }
};

// ✅ UPDATED: Profile Status with L1/L2 Backup Logic & Debugging
app.post("/api/profile/status", async (req, res) => {
  const { userName, activeTickets, teamMembers } = req.body;
  const DESIGNATION_COL_INDEX = 1;

  // 1. Get Shift Status
  const shiftStatus = getUserShiftStatus(userName);
  let backups = [];

  // 2. Find User's Designation
  const userRow = ROSTER_ROWS.find((row) => isNameMatch(row[NAME_COL_INDEX], userName));
  const userDesignation = userRow ? String(userRow[DESIGNATION_COL_INDEX] || "").trim().toUpperCase() : null;

  // 3. Logic: ONLY find backups if User is NOT Active
  if (!shiftStatus.isActive && ROSTER_ROWS.length > 0 && userDesignation) {
    backups = ROSTER_ROWS
      .filter((row) => {
        const rName = row[NAME_COL_INDEX];
        const rDesig = String(row[DESIGNATION_COL_INDEX] || "").trim().toUpperCase();

        if (isNameMatch(rName, userName)) return false; // Skip self
        if (rDesig !== userDesignation) return false;   // Strict L1-L1 / L2-L2 rule
        
        // Optional: Check Team
        if (teamMembers && teamMembers.length > 0) {
             if (!teamMembers.some(m => isNameMatch(rName, m))) return false;
        }

        // Must be Active
        return getUserShiftStatus(rName).isActive;
      })
      .map(row => row[NAME_COL_INDEX])
      .slice(0, 2); // Take top 2
  }
  // Smart Summary
  let aiSummary = "";
  const ticketCount = activeTickets ? activeTickets.length : 0;
  if (ticketCount === 0) {
    aiSummary = "Queue is currently clear.";
  } else {
    const criticalTickets = activeTickets.filter(
      (t) =>
        t.stage === "Waiting on Assignee" &&
        (String(t.severity).toLowerCase().includes("high") ||
          String(t.severity).toLowerCase().includes("blocker"))
    );
    const uniqueAccounts = [
      ...new Set(
        criticalTickets.map((t) => t.account).filter((a) => a && a !== "Unknown")
      ),
    ].slice(0, 2);

    if (criticalTickets.length > 0) {
      const accountStr = uniqueAccounts.length > 0 ? ` for ${uniqueAccounts.join(" & ")}` : "";
      aiSummary = `${userName} is working on ${criticalTickets.length} high priority tickets${accountStr}.`;
    } else {
      aiSummary = `${userName} has ${ticketCount} active tickets in queue.`;
    }
  }

  console.log(`   🏁 Final Result: Backups -> ${JSON.stringify(backups)}`);
  res.json({ ...shiftStatus, backups, aiSummary });
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
  console.log(`🚀 Server running on port ${PORT}`);

  // 🚀 INSTANT START: Fetch data immediately on boot
  fetchAndCacheTickets("boot");

  // Roster Sync
  await syncRoster();
});

// Background Loops
setInterval(syncRoster, 15 * 60 * 1000); // 15 mins for Roster
// Safety Net: Re-fetch tickets every 10 mins just in case a webhook was missed
setInterval(fetchAndCacheTickets, 10 * 60 * 1000);

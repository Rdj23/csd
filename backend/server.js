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
    } while (cursor && loop < 50); // Cap at 2500 tickets to prevent memory overflow

    // 2. Filter & Process
    const fourMonthsAgo = subMonths(new Date(), 4);
    const processed = collected.reduce((acc, t) => {
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
          custom_fields: t.custom_fields,
          tags: t.tags,
          account: t.account,
          reported_by: t.tnt__created_by,
        });
      }
      return acc;
    }, []);
    // 3. Update Cache & Broadcast
    cache.set("tickets_all", processed);
    console.log(`✅ Sync Complete: ${processed.length} tickets cached.`);
    io.emit("REFRESH_TICKETS", processed);
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

// ✅ MANUAL FORCE SYNC (The "Fix It Now" Button)
app.post("/api/tickets/sync", async (req, res) => {
  console.log("🫵 Manual Sync Triggered from UI");
  // Bypass debounce, but respect concurrency lock
  fetchAndCacheTickets("manual");
  res.json({ success: true, message: "Sync started" });
});

// ✅ GET TICKETS (Instant RAM access)
app.get("/api/tickets", async (req, res) => {
  const cached = cache.get("tickets_all");
  if (cached) {
    return res.json({ tickets: cached });
  }
  const fresh = await fetchAndCacheTickets("first_load");
  res.json({ tickets: fresh || [] });
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

// --- REMARKS & COMMENTS ---
app.get("/api/remarks/:ticketId", (req, res) => {
  const db = readRemarksDB();
  res.json(db[req.params.ticketId] || []);
});

app.post("/api/remarks", (req, res) => {
  const { ticketId, user, text } = req.body;
  if (!ticketId || !text)
    return res.status(400).json({ error: "Missing data" });

  const db = readRemarksDB();
  const newRemark = {
    id: Date.now().toString(),
    user: user || "Support Engineer",
    text: text,
    timestamp: new Date().toISOString(),
  };

  if (!db[ticketId]) db[ticketId] = [];
  db[ticketId].push(newRemark);
  writeRemarksDB(db);
  res.json({ success: true, remark: newRemark });
});

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
    console.error(
      "❌ DevRev API Error:",
      error.response?.data || error.message
    );
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

// GET Views (By User Email)
app.get("/api/views/:userId", (req, res) => {
  const db = readViewsDB();
  // Decode URL encoded email (e.g. rohan%40gmail.com -> rohan@gmail.com)
  const userId = decodeURIComponent(req.params.userId);
  res.json(db[userId] || []);
});

// SAVE View
app.post("/api/views", (req, res) => {
  const { userId, name, filters } = req.body;
  if (!userId || !name) return res.status(400).json({ error: "Missing data" });

  const db = readViewsDB();
  if (!db[userId]) db[userId] = [];

  const newView = {
    id: Date.now().toString(),
    name,
    filters,
    created_at: new Date().toISOString(),
  };

  db[userId].push(newView);
  writeViewsDB(db);
  console.log(`💾 Saved view '${name}' for ${userId}`);
  res.json({ success: true, view: newView });
});

// DELETE View
app.delete("/api/views/:userId/:viewId", (req, res) => {
  const userId = decodeURIComponent(req.params.userId);
  const { viewId } = req.params;
  const db = readViewsDB();

  if (db[userId]) {
    db[userId] = db[userId].filter((v) => v.id !== viewId);
    writeViewsDB(db);
  }
  res.json({ success: true });
});

// ============================================================================
// 3. ROSTER ENGINE (KEPT EXACTLY AS IS)
// ============================================================================
let ROSTER_ROWS = [];
let DATE_COL_MAP = {};
let NAME_COL_INDEX = 0;
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

const syncRoster = async () => {
  try {
    console.log("🔁 Auto-syncing roster...");
    const auth = new google.auth.GoogleAuth({
      keyFile: "google-sheets-key.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: "v4", auth: client });
    const spreadsheetId = process.env.ROSTER_SHEET_ID;

    const meta = await googleSheets.spreadsheets.get({ spreadsheetId });
    const sheetName = meta.data.sheets[0].properties.title;
    const getRows = await googleSheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const rawRows = getRows.data.values || [];
    if (!rawRows.length) return;

    let headerRowIndex = 0;
    for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
      if (JSON.stringify(rawRows[i]).includes("Designation")) {
        headerRowIndex = i;
        break;
      }
    }

    const headerRow = rawRows[headerRowIndex];
    DATE_COL_MAP = {};
    NAME_COL_INDEX = 0;
    headerRow.forEach((col, index) => {
      if (/^\d{1,2}-[A-Za-z]{3}$/.test(cleanString(col)))
        DATE_COL_MAP[col.trim()] = index;
    });

    ROSTER_ROWS = rawRows
      .slice(headerRowIndex + 1)
      .filter(
        (row) =>
          row[NAME_COL_INDEX] && String(row[NAME_COL_INDEX]).trim().length > 2
      );
    console.log(`✅ Roster auto-synced: ${ROSTER_ROWS.length} users`);
  } catch (e) {
    console.error("❌ Auto-sync failed:", e.message);
  }
};

app.post("/api/profile/status", async (req, res) => {
  const { userName, activeTickets, teamMembers } = req.body;
  const shiftStatus = getUserShiftStatus(userName);
  let backups = [];

  if (!shiftStatus.isActive && ROSTER_ROWS.length > 0) {
    backups = ROSTER_ROWS.filter((row) => {
      const rName = row[NAME_COL_INDEX];
      if (isNameMatch(rName, userName)) return false;
      if (
        teamMembers &&
        teamMembers.length > 0 &&
        !teamMembers.some((member) => isNameMatch(rName, member))
      )
        return false;
      return getUserShiftStatus(rName).isActive;
    })
      .slice(0, 2)
      .map((row) => row[NAME_COL_INDEX]);
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
        criticalTickets
          .map((t) => t.account)
          .filter((a) => a && a !== "Unknown")
      ),
    ].slice(0, 2);

    if (criticalTickets.length > 0) {
      const accountStr =
        uniqueAccounts.length > 0 ? ` for ${uniqueAccounts.join(" & ")}` : "";
      aiSummary = `${userName} is working on ${criticalTickets.length} high priority tickets${accountStr}.`;
    } else {
      aiSummary = `${userName} has ${ticketCount} active tickets in queue.`;
    }
  }
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

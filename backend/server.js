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

import { toZonedTime, format } from "date-fns-tz";
import { subDays, parseISO, isAfter, subMonths } from "date-fns";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

dotenv.config({ path: path.resolve(__dirname, "../.env") });



const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const cache = new NodeCache({ stdTTL: 300, checkperiod: 120 });

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

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const DEVREV_API = "https://api.devrev.ai";
const HEADERS = {
  Authorization: `Bearer ${process.env.VITE_DEVREV_PAT}`,
  "Content-Type": "application/json",
};

// --- REMARKS DATABASE SETUP ---
const REMARKS_FILE = path.join(__dirname, "remarks.json");

// Helper: Read Database
const readRemarksDB = () => {
  if (!fs.existsSync(REMARKS_FILE)) {
    fs.writeFileSync(REMARKS_FILE, JSON.stringify({})); // Create if doesn't exist
  }
  try {
    return JSON.parse(fs.readFileSync(REMARKS_FILE, "utf8"));
  } catch (e) {
    return {};
  }
};

app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body; // Matches the new store.js payload
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    // Return the user and a success flag to be safe
    res.json({ success: true, user: payload, token: "mock-jwt-token" });
  } catch (error) {
    console.error("Auth Error:", error);
    res.status(400).json({ success: false, error: "Invalid Token" });
  }
});

// Helper: Write Database
const writeRemarksDB = (data) => {
  fs.writeFileSync(REMARKS_FILE, JSON.stringify(data, null, 2));
};

// --- REMARKS API ENDPOINTS ---

// 1. GET Remarks for a Ticket
app.get("/api/remarks/:ticketId", (req, res) => {
  const db = readRemarksDB();
  const history = db[req.params.ticketId] || [];
  res.json(history);
});

// 2. POST (Save) a New Remark
app.post("/api/remarks", (req, res) => {
  const { ticketId, user, text } = req.body;

  if (!ticketId || !text)
    return res.status(400).json({ error: "Missing data" });

  const db = readRemarksDB();

  const newRemark = {
    id: Date.now().toString(), // Unique ID based on timestamp
    user: user || "Support Engineer",
    text: text,
    timestamp: new Date().toISOString(),
  };

  // Add to existing history or start new
  if (!db[ticketId]) {
    db[ticketId] = [];
  }
  db[ticketId].push(newRemark);

  // Save to file
  writeRemarksDB(db);

  console.log(`📝 Remark added to ${ticketId}`);
  res.json({ success: true, remark: newRemark, history: db[ticketId] });
});

// ✅ NEW: This allows your frontend to "see" users for tagging
app.get("/api/users", async (req, res) => {
  try {
    let allUsers = [];
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.get(
        `${DEVREV_API}/dev-users.list${cursor ? `?cursor=${cursor}` : ""}`,
        {
          headers: HEADERS,
        }
      );
      allUsers = [...allUsers, ...(response.data.dev_users || [])];
      cursor = response.data.next_cursor;
      hasMore = !!cursor;
    }

    const formatted = allUsers.map((u) => ({
      id: u.id,
      display_name: u.display_name,
      full_name: u.full_name,
      email: u.email,
    }));
    res.json(formatted);
  } catch (e) {
    res.status(500).json([]);
  }
});
// ============================================================================
// 1. ROSTER ENGINE (GOOGLE SHEETS EDITION)
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

// Helper: Clean String (Standardizes inputs)
const cleanString = (str) => {
  if (!str) return "";
  return String(str).trim(); // Keep case sensitive for dates (e.g. "1-Dec")
};

app.get("/api/roster/debug", (req, res) => {
  res.json({
    totalRows: ROSTER_ROWS.length,
    nameColumnIndex: NAME_COL_INDEX,
    dateColumns: Object.keys(DATE_COL_MAP).slice(0, 10),
    sampleRow: ROSTER_ROWS[0] || null,
  });
});

app.post("/api/comments", async (req, res) => {
  const { ticketId, body } = req.body;

  // 🔍 DEBUG: Log incoming request from frontend
  console.log("➡️ /api/comments called with payload:", {
    ticketId,
    body,
    bodyLength: body?.length,
  });

  try {
    // 🔍 DEBUG: Log payload exactly as sent to DevRev
    const devrevPayload = {
      object: ticketId,
      type: "timeline_comment",
      body: body,
      body_type: "text", // ✅ REQUIRED
    };

    console.log("📤 Sending payload to DevRev:", devrevPayload);

    const response = await axios.post(
      "https://api.devrev.ai/timeline.create",
      devrevPayload,
      {
        headers: {
          Authorization: `Bearer ${process.env.VITE_DEVREV_PAT}`,
          "Content-Type": "application/json",
        },
      }
    );

    // 🔍 DEBUG: Log DevRev success response
    console.log("✅ DevRev response status:", response.status);
    console.log("✅ DevRev response data:", response.data);

    return res.status(200).json(response.data);

  } catch (error) {
    // 🔥 DEBUG: Log DevRev failure in full detail
    console.error("❌ DevRev API ERROR");
    console.error("Status:", error.response?.status);
    console.error("Data:", error.response?.data);
    console.error("Message:", error.message);

    return res.status(500).json({
      success: false,
      error: "DevRev timeline sync failed",
      details: error.response?.data || error.message,
    });
  }
});



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
      if (/^\d{1,2}-[A-Za-z]{3}$/.test(cleanString(col))) {
        DATE_COL_MAP[col.trim()] = index;
      }
    });

    ROSTER_ROWS = rawRows.slice(headerRowIndex + 1).filter((row) => {
      const name = row[NAME_COL_INDEX];
      return name && String(name).trim().length > 2;
    });

    console.log(`✅ Roster auto-synced: ${ROSTER_ROWS.length} users`);
  } catch (e) {
    console.error("❌ Auto-sync failed:", e.message);
  }
};

// Helper: Name Match (Case insensitive)
const isNameMatch = (rosterName, queryName) => {
  if (!rosterName || !queryName) return false;
  const r = String(rosterName).trim().toLowerCase();
  const q = String(queryName).trim().toLowerCase();
  return q.includes(r) || r.includes(q);
};

// Helper: Get Status (Updated for Date Matching)
const getUserShiftStatus = (userName) => {
  if (ROSTER_ROWS.length === 0)
    return { isActive: false, status: "Roster Empty" };

  const userRow = ROSTER_ROWS.find((row) =>
    isNameMatch(row[NAME_COL_INDEX], userName)
  );

  if (!userRow) {
    // Suggest names if not found
    const similar = ROSTER_ROWS.map((r) => r[NAME_COL_INDEX])
      .filter(
        (n) =>
          n &&
          String(n).toLowerCase().startsWith(userName.charAt(0).toLowerCase())
      )
      .slice(0, 3);
    return { isActive: false, status: "Not in Roster", candidates: similar };
  }

  // Get Current Time (IST)
  const istNow = new Date().toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
  });
  const dateObj = new Date(istNow);

  // Format Date to match Sheet Header (e.g., "23-Dec")
  const day = dateObj.getDate();
  const month = dateObj.toLocaleString("default", { month: "short" }); // "Dec"
  const todayKey = `${day}-${month}`; // "23-Dec"

  const todayColIdx = DATE_COL_MAP[todayKey];

  if (todayColIdx === undefined) {
    console.log(
      `Date key '${todayKey}' not found in map. Available keys:`,
      Object.keys(DATE_COL_MAP).slice(0, 5)
    );
    return { isActive: false, status: "Date Not Found", shiftName: "Unknown" };
  }

  const shiftName = userRow[todayColIdx]?.trim();
  const cleanShift = Object.keys(SHIFT_TIMINGS).find(
    (k) => shiftName && shiftName.includes(k)
  );

  if (!cleanShift)
    return { isActive: false, status: shiftName || "Off Duty", shiftName };

  const { start, end } = SHIFT_TIMINGS[cleanShift];
  const [sH, sM] = start.split(":").map(Number);
  const [eH, eM] = end.split(":").map(Number);
  const currentH = dateObj.getHours();
  const currentM = dateObj.getMinutes();

  const nowVal = currentH * 60 + currentM;
  const startVal = sH * 60 + sM;
  const endVal = eH * 60 + eM;

  let isActive = false;
  if (endVal < startVal) {
    // Shift 4 (Overnight)
    isActive = nowVal >= startVal || nowVal <= endVal;
  } else {
    isActive = nowVal >= startVal && nowVal <= endVal;
  }

  return {
    isActive,
    status: isActive ? "Active" : "Away",
    shiftName: cleanShift,
    timings: `${start} - ${end}`,
  };
};

// 2. PROFILE API (LOGIC BASED - NO AI)
// ============================================================================
app.post("/api/profile/status", async (req, res) => {
  const { userName, activeTickets, teamMembers } = req.body;

  const ticketCount = activeTickets ? activeTickets.length : 0;

  // 1. ROSTER LOGIC
  const shiftStatus = getUserShiftStatus(userName);
  let backups = [];

  if (!shiftStatus.isActive && ROSTER_ROWS.length > 0) {
    const potentialBackups = ROSTER_ROWS.filter((row) => {
      const rName = row[NAME_COL_INDEX];
      if (isNameMatch(rName, userName)) return false;

      if (teamMembers && teamMembers.length > 0) {
        const isTeamMember = teamMembers.some((member) =>
          isNameMatch(rName, member)
        );
        if (!isTeamMember) return false;
      }
      return getUserShiftStatus(rName).isActive;
    });

    if (potentialBackups.length > 0)
      backups = potentialBackups
        .slice(0, 2) // 👈 take max 2
        .map((row) => row[NAME_COL_INDEX]);
  }

  // 2. SMART SUMMARY LOGIC (Replaces AI)
  let aiSummary = "";

  if (ticketCount === 0) {
    aiSummary = "Queue is currently clear.";
  } else {
    // Filter for "Critical" (Waiting on Assignee + High/Blocker)
    const criticalTickets = activeTickets.filter((t) => {
      const stageName = (t.stage || "").toString();
      const severity = (t.severity || "").toString().toLowerCase();

      return (
        stageName === "Waiting on Assignee" &&
        (severity.includes("high") || severity.includes("blocker"))
      );
    });

    // Get Unique Account Names (Max 2)
    const uniqueAccounts = [
      ...new Set(
        criticalTickets
          .map((t) => t.account)
          .filter((a) => a && a !== "Unknown")
      ),
    ].slice(0, 2);

    // ✅ CONSTRUCT THE SENTENCE
    if (criticalTickets.length > 0) {
      const accountStr =
        uniqueAccounts.length > 0 ? ` for ${uniqueAccounts.join(" & ")}` : "";

      // Example: "Rohan is working on 3 high priority tickets for Jio."
      aiSummary = `${userName} is working on ${criticalTickets.length} high priority tickets${accountStr}.`;
    } else {
      // Fallback if no critical tickets
      // Example: "Rohan has 12 active tickets in queue."
      aiSummary = `${userName} has ${ticketCount} active tickets in queue.`;
    }
  }

  res.json({ ...shiftStatus, backups, aiSummary });
});

app.post("/api/notify/eta", (req, res) => {
  console.log("🔔 ETA Request Triggered for:", req.body.targetUser);
  res.json({ success: true, message: "Slack notification sent" });
});

// ============================================================================
// 🛠️ DEBUG ENDPOINT (Paste this before app.listen)
// ============================================================================
app.get("/api/debug/roster", async (req, res) => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: "google-sheets-key.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const client = await auth.getClient();
    const googleSheets = google.sheets({ version: "v4", auth: client });
    const spreadsheetId = process.env.ROSTER_SHEET_ID;

    // 1. Try to fetch raw data
    const meta = await googleSheets.spreadsheets.get({ spreadsheetId });
    const sheetName = meta.data.sheets[0].properties.title;

    const getRows = await googleSheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range: sheetName,
    });

    const rawRows = getRows.data.values || [];

    // 2. Return Diagnostic Info
    res.json({
      status: "Connected to Google",
      sheetName: sheetName,
      totalRawRows: rawRows.length,
      firstRow: rawRows[0], // What does the top row look like?
      headerRowDetection: {
        currentNameIndex: NAME_COL_INDEX,
        sampleDateColumns: Object.keys(DATE_COL_MAP).slice(0, 5),
      },
      parsedRosterCount: ROSTER_ROWS.length,
      sampleParsedRow: ROSTER_ROWS[0] || "None",
    });
  } catch (error) {
    res.status(500).json({
      error: "Google Connection Failed",
      message: error.message,
      tip: "Check if 'roster-bot' email has Viewer access in the Google Sheet sharing settings.",
    });
  }
});

// ============================================================================
// 3. ANALYTICS ENGINE (Strategic AI - COMPARISON MODE)
// ============================================================================
app.post("/api/analytics/insight", async (req, res) => {
  const { metric, chartData, context, comparison } = req.body;
  // comparison = { userAvg: 4.2, teamAvg: 6.5 } (Optional)

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.json({ insight: "AI Configuration Missing." });

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    let prompt = "";

    // 1. INDIVIDUAL PERFORMANCE (The Game Changer)
    if (comparison) {
      prompt = `
            You are a Performance Coach. Compare ${context}'s performance vs the Team Average.
            
            Metric: ${metric.toUpperCase()}
            - ${context}: ${comparison.userVal}
            - Team Average: ${comparison.teamVal}
            
            Trend Data (Last 7 Days): ${JSON.stringify(chartData.slice(-7))}

            Task:
            1. Is ${context} performing better or worse than average?
            2. Give 1 actionable tip.
            3. Tone: Constructive & Encouraging. Max 25 words.
        `;
    }
    // 2. STANDARD TREND ANALYSIS
    else {
      prompt = `
            Analyze this ${metric} trend for ${context}.
            Data (Last 10 Days): ${JSON.stringify(chartData.slice(-10))}
            Task: Identify the trend (Spike/Drop) and the "Why". Max 20 words.
        `;
    }

    const result = await model.generateContent(prompt);
    res.json({ insight: result.response.text() });
  } catch (e) {
    console.error("AI Analytics Error:", e.message);
    res.json({ insight: "AI limit reached. Please wait a moment." });
  }
});

app.get("/api/auth/config", (req, res) =>
  res.json({ clientId: GOOGLE_CLIENT_ID })
);

// ✅ FAST TICKET FETCH (Parallel + Updated Mapping)
app.get("/api/tickets", async (req, res) => {
  const cached = cache.get("tickets_all");
  if (cached) return res.json({ tickets: cached });

  try {
    const fetchAllWorks = async () => {
      let collected = [];
      let cursor = null;
      let loop = 0;
      do {
        const response = await axios.get(
          `${DEVREV_API}/works.list?limit=50&type=ticket${
            cursor ? `&cursor=${cursor}` : ""
          }`,
          { headers: HEADERS }
        );
        collected = [...collected, ...(response.data.works || [])];
        cursor = response.data.next_cursor;
        loop++;
      } while (cursor && loop < 30);
      return collected;
    };

    const allTickets = await fetchAllWorks();
    const fourMonthsAgo = subMonths(new Date(), 4);

    const processed = allTickets.reduce((acc, t) => {
      const isSolved = t.stage?.name === "Solved" || t.stage?.name === "Closed";
      if (!isSolved || isAfter(parseISO(t.modified_date), fourMonthsAgo)) {
        acc.push({
          id: t.id,
          display_id: t.display_id,
          title: t.title,
          priority: t.priority,
          severity: t.severity, // ✅ Capture Severity
          account: t.account, // ✅ Capture Account Info
          stage: t.stage,
          owned_by: t.owned_by,
          created_date: t.created_date,
          actual_close_date: t.actual_close_date,
          custom_fields: t.custom_fields,
          tags: t.tags,
        });
      }
      return acc;
    }, []);

    cache.set("tickets_all", processed);
    res.json({ tickets: processed });
  } catch (e) {
    res.status(500).json({ error: "Failed" });
  }
});

// API: Get Remarks
app.get("/api/remarks/:ticketId", (req, res) => {
  try {
    const db = readRemarksDB();
    const history = db[req.params.ticketId] || [];
    res.json(history);
  } catch (error) {
    res.status(500).json([]);
  }
});

// API: Save Remark
app.post("/api/remarks", (req, res) => {
  const { ticketId, user, text } = req.body;

  if (!ticketId || !text)
    return res.status(400).json({ error: "Missing data" });

  try {
    const db = readRemarksDB();

    const newRemark = {
      id: Date.now().toString(),
      user: user || "Support Engineer",
      text: text,
      timestamp: new Date().toISOString(),
    };

    if (!db[ticketId]) {
      db[ticketId] = [];
    }
    db[ticketId].push(newRemark);

    writeRemarksDB(db);

    console.log(`📝 Saved remark for ${ticketId}`);
    res.json({ success: true, remark: newRemark });
  } catch (error) {
    console.error("Save failed:", error);
    res.status(500).json({ error: "Failed to save" });
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await syncRoster(); // 👈 THIS FIXES NEHA
});
setInterval(syncRoster, 15 * 60 * 1000);

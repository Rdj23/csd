const fs = require("fs");
const path = require("path");
const express = require("express");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const NodeCache = require("node-cache");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { toZonedTime, format } = require("date-fns-tz");
const { subDays, parseISO, isAfter, subMonths } = require("date-fns");
const multer = require("multer");
const csv = require("csv-parser");


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
  
  if (!ticketId || !text) return res.status(400).json({ error: "Missing data" });

  const db = readRemarksDB();
  
  const newRemark = {
    id: Date.now().toString(), // Unique ID based on timestamp
    user: user || "Support Engineer",
    text: text,
    timestamp: new Date().toISOString()
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


// ============================================================================
// 1. ROSTER ENGINE
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

const upload = multer({ dest: "uploads/" });

app.post("/api/roster/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const rawRows = [];

  fs.createReadStream(req.file.path)
    .pipe(csv({ headers: false }))
    .on("data", (data) => {
      const row = Object.keys(data)
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map((k) => data[k]);
      rawRows.push(row);
    })
    .on("end", () => {
      fs.unlinkSync(req.file.path);

      let headerRowIndex = -1;
      for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
        const rowStr = JSON.stringify(rawRows[i]);
        if (rowStr.includes("-Dec") || rowStr.includes("Engineer")) {
          headerRowIndex = i;
          break;
        }
      }

      if (headerRowIndex === -1) {
        return res.status(400).json({ error: "Could not find header row" });
      }

      const headerRow = rawRows[headerRowIndex];
      DATE_COL_MAP = {};
      NAME_COL_INDEX = -1;

      headerRow.forEach((col, index) => {
        if (!col) return;
        const cleanCol = String(col).trim();
        if (cleanCol.includes("-")) DATE_COL_MAP[cleanCol] = index;
        if (
          cleanCol.toLowerCase().includes("engineer") ||
          cleanCol.toLowerCase().includes("name")
        ) {
          NAME_COL_INDEX = index;
        }
      });

      if (NAME_COL_INDEX === -1) NAME_COL_INDEX = 0;

      ROSTER_ROWS = rawRows.slice(headerRowIndex + 1).filter((row) => {
        const name = row[NAME_COL_INDEX];
        return (
          name &&
          name !== "Designation" &&
          name !== "Engineer" &&
          name.length > 2
        );
      });

      console.log(`✅ Loaded ${ROSTER_ROWS.length} engineers.`);
      res.json({ success: true, count: ROSTER_ROWS.length });
    });
});

const cleanString = (str) => {
  if (!str) return "";
  return String(str)
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();
};

const isNameMatch = (rosterName, queryName) => {
  const r = cleanString(rosterName);
  const q = cleanString(queryName);
  if (!r || !q) return false;
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
        (n) => n && n.toLowerCase().startsWith(userName.charAt(0).toLowerCase())
      )
      .slice(0, 3);
    return { isActive: false, status: "Not in Roster", candidates: similar };
  }

  const istNow = toZonedTime(new Date(), "Asia/Kolkata");
  const todayKey = format(istNow, "d-MMM");

  const currentH = istNow.getHours();
  if (currentH < 8) {
    const yesterday = subDays(istNow, 1);
    const yesterdayKey = format(yesterday, "d-MMM");
    const yesterdayColIdx = DATE_COL_MAP[yesterdayKey];

    if (yesterdayColIdx !== undefined) {
      const yShift = userRow[yesterdayColIdx]?.trim();
      if (yShift && yShift.includes("Shift 4")) {
        return {
          isActive: true,
          status: "Active (Shift 4)",
          shiftName: "Shift 4",
          timings: "22:30 - 07:30",
        };
      }
    }
  }

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
  const currentM = istNow.getMinutes();
  const nowVal = currentH * 60 + currentM;
  const startVal = sH * 60 + sM;
  const endVal = eH * 60 + eM;

  let isActive = false;
  if (endVal < startVal) {
    isActive = nowVal >= startVal;
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
  let backup = null;

  if (!shiftStatus.isActive && ROSTER_ROWS.length > 0) {
    const potentialBackups = ROSTER_ROWS.filter(row => {
      const rName = row[NAME_COL_INDEX];
      if (isNameMatch(rName, userName)) return false; 
      
      if (teamMembers && teamMembers.length > 0) {
        const isTeamMember = teamMembers.some(member => isNameMatch(rName, member));
        if (!isTeamMember) return false;
      }
      return getUserShiftStatus(rName).isActive;
    });

    if (potentialBackups.length > 0) backup = potentialBackups[0][NAME_COL_INDEX];
  }

  // 2. SMART SUMMARY LOGIC (Replaces AI)
  let aiSummary = "";

  if (ticketCount === 0) {
      aiSummary = "Queue is currently clear.";
  } else {
      // Filter for "Critical" (Waiting on Assignee + High/Blocker)
      const criticalTickets = activeTickets.filter(t => {
          const stageName = (t.stage || "").toString();
          const severity = (t.severity || "").toString().toLowerCase();
          
          return stageName === "Waiting on Assignee" && 
                 (severity.includes("high") || severity.includes("blocker"));
      });

      // Get Unique Account Names (Max 2)
      const uniqueAccounts = [...new Set(
          criticalTickets.map(t => t.account).filter(a => a && a !== "Unknown")
      )].slice(0, 2);

      // ✅ CONSTRUCT THE SENTENCE
      if (criticalTickets.length > 0) {
          const accountStr = uniqueAccounts.length > 0 
              ? ` for ${uniqueAccounts.join(" & ")}` 
              : "";
              
          // Example: "Rohan is working on 3 high priority tickets for Jio."
          aiSummary = `${userName} is working on ${criticalTickets.length} high priority tickets${accountStr}.`;
      } else {
          // Fallback if no critical tickets
          // Example: "Rohan has 12 active tickets in queue."
          aiSummary = `${userName} has ${ticketCount} active tickets in queue.`;
      }
  }

  res.json({ ...shiftStatus, backup, aiSummary });
});

app.post("/api/notify/eta", (req, res) => {
  console.log("🔔 ETA Request Triggered for:", req.body.targetUser);
  res.json({ success: true, message: "Slack notification sent" });
});

app.get("/api/debug/roster", (req, res) => {
  const istNow = toZonedTime(new Date(), "Asia/Kolkata");
  const todayKey = format(istNow, "d-MMM");
  res.json({
    total_engineers: ROSTER_ROWS.length,
    looking_for_today: todayKey,
    today_column_index: DATE_COL_MAP[todayKey],
    name_column_index: NAME_COL_INDEX,
    loaded_names: ROSTER_ROWS.map((r) => r[NAME_COL_INDEX]).slice(0, 10),
  });
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
app.get("/api/users", async (req, res) => {
  const cachedUsers = cache.get("dev_users");
  if (cachedUsers) return res.json(cachedUsers);
  try {
    let allUsers = [];
    let cursor = null;
    let count = 0;
    do {
      const url = `${DEVREV_API}/dev-users.list?limit=50${
        cursor ? `&cursor=${cursor}` : ""
      }`;
      const response = await axios.get(url, { headers: HEADERS });
      allUsers = [...allUsers, ...response.data.dev_users];
      cursor = response.data.next_cursor;
      count++;
    } while (cursor && count < 10);
    cache.set("dev_users", allUsers, 3600);
    res.json(allUsers);
  } catch (error) {
    res.status(500).json([]);
  }
});

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
  
  if (!ticketId || !text) return res.status(400).json({ error: "Missing data" });

  try {
    const db = readRemarksDB();
    
    const newRemark = {
      id: Date.now().toString(),
      user: user || "Support Engineer",
      text: text,
      timestamp: new Date().toISOString()
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
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

const path = require("path");
const express = require("express");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const NodeCache = require("node-cache");
const { subDays, parseISO, isBefore } = require("date-fns");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

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

// --- CONSTANTS ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);
const DEVREV_API = "https://api.devrev.ai";
const HEADERS = {
  Authorization: `Bearer ${process.env.VITE_DEVREV_PAT}`,
  "Content-Type": "application/json",
};

/// --- 1. GLOBAL USER CACHE (Pagination Fix) ---
let ALL_DEVREV_USERS = [];

async function refreshDevRevUsers() {
  console.log("🔄 Fetching All DevRev Users...");
  let collectedUsers = [];
  let nextCursor = null;

  try {
    do {
      // ✅ FIX: No limit specified, only cursor when needed
      const url = `${DEVREV_API}/dev-users.list${
        nextCursor ? `?cursor=${nextCursor}` : ""
      }`;

      const response = await axios.get(url, { headers: HEADERS });
      
      const users = response.data.dev_users || [];
      collectedUsers = [...collectedUsers, ...users];

      // Update cursor for the next loop
      nextCursor = response.data.next_cursor;
      
    } while (nextCursor);

    ALL_DEVREV_USERS = collectedUsers;
    console.log(`✅ Loaded ${ALL_DEVREV_USERS.length} users from DevRev.`);
  } catch (error) {
    console.error("❌ Failed to load users:", error.message);
  }
}
refreshDevRevUsers();

const TEAM_GROUPS = {
  Mashnu: {
    "DEVU-1111": "Rohan",
    "DEVU-1114": "Archie",
    "DEVU-1072": "Neha",
    "DEVU-1115": "Shreya",
    "DEVU-1122": "Vaibhav",
    "DEVU-1076": "Adarsh",
    "DEVU-1108": "Abhishek",
  },
  Debashish: {
    "DEVU-1087": "Shubhankar",
    "DEVU-736": "Musaveer",
    "DEVU-550": "Anurag",
    "DEVU-1102": "Debashish",
  },
  Shweta: { "DEVU-5": "Aditya", "DEVU-1113": "Shweta", "DEVU-4": "Nikita" },
  Tuaha: {
    "DEVU-1123": "Tuaha Khan",
    "DEVU-1098": "Harsh",
    "DEVU-689": "Tamanna",
    "DEVU-1110": "Shreyas",
  },
};
const OWNER_IDS = Object.values(TEAM_GROUPS).flatMap((group) => Object.keys(group));

// --- ROUTES ---

// 2. GET USERS (For Frontend)
app.get("/api/users", (req, res) => {
  res.json(ALL_DEVREV_USERS);
});

// 3. AUTH LOGIN (Dynamic Match)
app.post("/api/auth/google", async (req, res) => {
  const { token } = req.body;
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email;

    const foundUser = ALL_DEVREV_USERS.find((u) => u.email === email);

    if (foundUser) {
      console.log(`✅ Login Success: ${email}`);
      res.json({
        success: true,
        user: {
          email: foundUser.email,
          name: foundUser.display_name,
          id: foundUser.id, // Sends "don:identity..."
          display_id: foundUser.display_id,
          picture: payload.picture,
        },
      });
    } else {
      res.status(403).json({ error: "User not found in DevRev." });
    }
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
});

app.get("/api/auth/config", (req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID });
});

// --- ⚡️ PARALLEL FETCHING LOGIC (The Speed Fix) ---

// Helper: Split array into smaller chunks
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// --- FETCHING LOGIC ---
async function fetchTicketsWithCutoff(states, daysBack = null,specificOwners = null) {
  let allTickets = [];
  let nextCursor = undefined;
  let page = 0;
  const cutoffDate = daysBack ? subDays(new Date(), daysBack) : null;
  const ownersToFetch = specificOwners || OWNER_IDS;

  do {
    try {
      const payload = {
        type: ["ticket"],
        limit: 100,
        owned_by: ownersToFetch,
        state: states,
        sort_by: ["created_date:desc"],
      };
      if (nextCursor) payload.cursor = nextCursor;

      const response = await axios.post(`${DEVREV_API}/works.list`, payload, {
        headers: HEADERS,
      });
      const works = response.data.works || [];

      if (works.length === 0) break;

      if (cutoffDate) {
        const oldestTicketDate = parseISO(works[works.length - 1].created_date);
        if (isBefore(oldestTicketDate, cutoffDate)) {
          const validWorks = works.filter((t) => !isBefore(parseISO(t.created_date), cutoffDate));
          allTickets = [...allTickets, ...validWorks];
          break;
        }
      }

      allTickets = [...allTickets, ...works];
      nextCursor = response.data.next_cursor;
      await new Promise((r) => setTimeout(r, 20));
    } catch (error) {
      console.error("❌ Fetch Error:", error.message);
      break;
    }
  } while (nextCursor);

  return allTickets;
}

async function refreshCache() {
  console.log("🌍 Starting Parallel Sync for 500+ Users...");
  
  try {
    // 1. Split users into chunks of 20 (25 parallel requests for 500 users)
    // This fits easily within your 10,000 rate limit.
    const chunks = chunkArray(OWNER_IDS, 20);
    console.log(`🚀 Launching ${chunks.length} parallel workers...`);

    // 2. Fetch 'Active' tickets in parallel
    const activePromises = chunks.map(chunk => 
      fetchTicketsWithCutoff(["open", "in_progress"], null, chunk)
    );
    
    // 3. Fetch 'Closed' tickets (Global fetch is fine here if limited to 30 days)
    // Or you can chunk this too if it's too slow.
    const closedPromise = fetchTicketsWithCutoff(["completed", "closed"], 30, OWNER_IDS);

    // Wait for EVERYTHING to finish
    const [activeResults, closedTickets] = await Promise.all([
      Promise.all(activePromises),
      closedPromise
    ]);

    // Flatten the array of arrays
    const allActiveTickets = activeResults.flat();
    const combined = [...allActiveTickets, ...closedTickets];

    // Remove duplicates just in case
    const uniqueTickets = Array.from(new Map(combined.map((t) => [t.display_id, t])).values());

    cache.set("all_tickets", uniqueTickets);
    console.log(`🎉 Sync Complete! Cached ${uniqueTickets.length} tickets.`);
    io.emit("data_refresh", { count: uniqueTickets.length });
    return uniqueTickets;

  } catch (e) {
    console.error("Sync Failed:", e);
    return [];
  }
}

// 3. GET TICKETS (Updated with Optional Pagination)
app.get("/api/tickets", async (req, res) => {
  // Check if frontend requested a specific page
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10000; // Default to "All" for now to keep your UI working

  let data = cache.get("all_tickets");
  
  if (!data) {
    data = await refreshCache();
  } else if (cache.getTtl("all_tickets") - Date.now() < 300000) {
    refreshCache(); // Background refresh
  }

  // Slice data for pagination (if limit is set)
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const paginatedData = data.slice(startIndex, endIndex);

  res.json({ 
    source: "cache", 
    tickets: paginatedData,
    total: data.length
  });
});

// Add this inside server.js
app.get("/api/timeline", async (req, res) => {
  const { ticket_id } = req.query;
  try {
    const response = await axios.get(
      `${DEVREV_API}/timeline-entries.list?object=${ticket_id}&limit=50`, 
      { headers: HEADERS }
    );
    res.json(response.data.timeline_entries || []);
  } catch (error) {
    console.error("Fetch Timeline Error:", error.message);
    res.status(500).json([]);
  }
});

// 4. POST COMMENT (Smart Pass-through)
app.post("/api/comments", async (req, res) => {
  const { ticketId, body } = req.body;
  console.log(`📝 Posting comment to ${ticketId}`);

  if (!ticketId) return res.status(400).json({ error: "Missing ticketId" });

  try {
    const response = await axios.post(
      `${DEVREV_API}/timeline-entries.create`,
      {
        type: "timeline_comment",
        body: body,
        object: ticketId,
        visibility: "internal",
      },
      { headers: HEADERS }
    );

    io.emit("ticket_updated", { id: ticketId, action: "comment" });
    res.json(response.data);
  } catch (error) {
    console.error("❌ Post Comment Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to post comment" });
  }
});

refreshCache();
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
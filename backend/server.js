const path = require('path');
const express = require('express');
// 👇 THIS IS THE FIX
// It tells the server: "Go up one folder (..) and find the .env file there"
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const NodeCache = require('node-cache');
const { subDays, parseISO, isBefore } = require('date-fns');
const { OAuth2Client } = require('google-auth-library');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// 👇 ADD THIS MIDDLEWARE
app.use((req, res, next) => {
  // "same-origin-allow-popups" allows the Google Login popup to talk to your app
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  next();
});


app.use(cors());
app.use(express.json());

const GOOGLE_CLIENT_ID =  process.env.GOOGLE_CLIENT_ID 
console.log("My Client ID is:", GOOGLE_CLIENT_ID);
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

const USER_DIRECTORY = {
  "rohan.jadhav@clevertap.com": { id: "DEVU-1111", name: "Rohan", role: "admin" },
  "archie@clevertap.com":       { id: "DEVU-1114", name: "Archie", role: "member" },
  "neha@clevertap.com":         { id: "DEVU-1072", name: "Neha", role: "member" },
  "abhishek.vishwakarma@clevertap.com":       { id: "DEVU-1108", name: "Abhishek", role: "member" },
  "ruben@clevertap.com":         { id: "DEVU-1085", name: "Ruben", role: "member" },
  "anmol.sawhney@clevertap.com":         { id: "DEVU-1", name: "Anmol", role: "admin" },
  "tamanna@clevertap.com":         { id: "DEVU-689", name: "Tamanna", role: "member" },
};

const TEAM_GROUPS = {
  "Mashnu": { "DEVU-1111": "Rohan", "DEVU-1114": "Archie", "DEVU-1072": "Neha", "DEVU-1115": "Shreya", "DEVU-1122": "Vaibhav", "DEVU-1076": "Adarsh", "DEVU-1108": "Abhishek" },
  "Debashish": { "DEVU-1087": "Shubhankar", "DEVU-736": "Musaveer", "DEVU-550": "Anurag", "DEVU-1102": "Debashish" },
  "Shweta": { "DEVU-5": "Aditya", "DEVU-1113": "Shweta", "DEVU-4": "Nikita" },
  "Tuaha": { "DEVU-1123": "Tuaha Khan", "DEVU-1098": "Harsh Singh", "DEVU-689": "Tamanna", "DEVU-1110": "Shreyas" }
};
const OWNER_IDS = Object.values(TEAM_GROUPS).flatMap(group => Object.keys(group));

// 1. AUTHENTICATION ROUTE (New)
app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body;
  
  try {
    // Verify the token with Google
    const ticket = await client.verifyIdToken({
        idToken: token,
        audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email;

    // Check if user is in our directory
    const user = USER_DIRECTORY[email];

    if (user) {
      console.log(`✅ Login Success: ${email} -> ${user.name}`);
      res.json({ 
        success: true, 
        user: { 
          email, 
          name: user.name, 
          id: user.id, 
          picture: payload.picture 
        } 
      });
    } else {
      console.log(`❌ Login Denied: ${email} (Not in directory)`);
      res.status(403).json({ error: "Access denied. Email not recognized." });
    }
  } catch (error) {
    console.error("Auth Error:", error);
    res.status(401).json({ error: "Invalid token" });
  }
});

const DEVREV_API = "https://api.devrev.ai";
const HEADERS = {
  Authorization: `Bearer ${process.env.VITE_DEVREV_PAT}`,
  "Content-Type": "application/json"
};

// --- FETCH HELPER ---
async function fetchTicketsWithCutoff(states, daysBack = null) {
  let allTickets = [];
  let nextCursor = undefined;
  let page = 0;
  const cutoffDate = daysBack ? subDays(new Date(), daysBack) : null;

  console.log(`🔄 Fetching [${states.join(", ")}]...`);

  do {
    try {
      const payload = {
        type: ["ticket"],
        limit: 200, 
        owned_by: OWNER_IDS,
        state: states,
        sort_by: ["created_date:desc"]
      };
      if (nextCursor) payload.cursor = nextCursor;

      const response = await axios.post(`${DEVREV_API}/works.list`, payload, { headers: HEADERS });
      const works = response.data.works || [];
      
      if (works.length === 0) break;

      if (cutoffDate) {
        const oldestTicketDate = parseISO(works[works.length - 1].created_date);
        if (isBefore(oldestTicketDate, cutoffDate)) {
          const validWorks = works.filter(t => !isBefore(parseISO(t.created_date), cutoffDate));
          allTickets = [...allTickets, ...validWorks];
          console.log(`🛑 Reached cutoff date. Stopping.`);
          break; 
        }
      }

      allTickets = [...allTickets, ...works];
      nextCursor = response.data.next_cursor;
      page++;

      if (page % 2 === 0) console.log(`   ...Loaded ${allTickets.length} tickets`);
      await new Promise(r => setTimeout(r, 50)); 

    } catch (error) {
      console.error("❌ Fetch Error:", error.message);
      break; 
    }
  } while (nextCursor);

  return allTickets;
}

// --- SYNC ---
async function refreshCache() {
  console.log("🌍 Starting Background Sync...");
  try {
    const [active, closed] = await Promise.all([
      fetchTicketsWithCutoff(["open", "in_progress"], null), 
      fetchTicketsWithCutoff(["completed", "closed"], 90) 
    ]);

    const combined = [...active, ...closed];
    const uniqueTickets = Array.from(new Map(combined.map(t => [t.display_id, t])).values());
    
    cache.set("all_tickets", uniqueTickets);
    console.log(`🎉 Cache Updated: ${uniqueTickets.length} tickets ready.`);
    
    io.emit('data_refresh', { count: uniqueTickets.length });
    return uniqueTickets;
  } catch (e) {
    console.error("Sync Failed, keeping old cache if available.");
    return [];
  }
}

// --- ROUTES ---

app.get('/api/auth/config', (req, res) => {
  // We only send the Client ID. NEVER send the Client Secret!
  res.json({ 
    clientId: process.env.GOOGLE_CLIENT_ID 
  });
});

// 1. GET TICKETS
app.get('/api/tickets', async (req, res) => {
  const cachedData = cache.get("all_tickets");
  if (cachedData) {
    if (cache.getTtl("all_tickets") - Date.now() < 300000) refreshCache();
    return res.json({ source: 'cache', tickets: cachedData });
  }
  const data = await refreshCache();
  res.json({ source: 'api', tickets: data });
});


// 2. POST COMMENT (FIXED: ID in Body, not URL)
app.post('/api/comments', async (req, res) => {
  // Read 'ticketId' from the JSON body instead of the URL
  const { ticketId, body } = req.body;
  
  console.log(`📝 Posting comment to ${ticketId}`);

  if (!ticketId) {
    return res.status(400).json({ error: "Missing ticketId" });
  }

  try {
    const response = await axios.post(`${DEVREV_API}/timeline-entries.create`, {
      type: "timeline_comment",
      body: body,
      object: ticketId, // Use the ID from the body
      visibility: "internal"
    }, { headers: HEADERS });
    
    console.log("✅ Comment posted successfully");
    io.emit('ticket_updated', { id: ticketId, action: 'comment' }); 
    res.json(response.data);
  } catch (error) {
    console.error("❌ Post Comment Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to post comment" });
  }
});
refreshCache();
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
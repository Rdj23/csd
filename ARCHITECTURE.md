# CSD (CleverTap Support Dashboard) - Architecture

## What is this app?

A dashboard for the CleverTap Global Support Team (GST) to track support tickets, measure team performance, and manage daily operations. It pulls ticket data from DevRev (our ticketing system), crunches analytics, and shows everything in a clean web interface.

---

## Where does everything run?

```
                    +-----------------------+
                    |       RENDER          |
                    |   (Cloud Hosting)     |
                    |                       |
  Users ---------> |  Backend (Node.js)    |
  (Browser)        |  - API server         |
                    |  - Background jobs    |
                    |  - Webhook listener   |
                    +-----------+-----------+
                                |
                   Connects to external services:
                                |
              +-----------------+-----------------+
              |                 |                 |
      +-------v------+  +------v-------+  +------v-------+
      |   MongoDB    |  |    Redis     |  |   DevRev     |
      |   Atlas      |  |   (Cache)    |  |   API        |
      | (Database)   |  |              |  | (Tickets)    |
      +--------------+  +--------------+  +--------------+
```

### Services we use

| Service | What it does | Where it runs | Free tier? |
|---------|-------------|---------------|------------|
| **Render** | Hosts our backend server (the Node.js app) | Render cloud | Yes - 512 MB RAM limit |
| **MongoDB Atlas** | Stores all permanent data (tickets, analytics, user views) | MongoDB cloud | Yes |
| **Redis** | Fast temporary cache (speeds up page loads) | Render or external | Yes |
| **DevRev** | Source of all support tickets (our CRM) | DevRev cloud | N/A (company tool) |
| **Google Sheets** | Team roster / shift schedules | Google cloud | Yes |
| **Slack** | Alert notifications for NOC escalations | Slack | Yes |
| **Google OAuth** | Login authentication (@clevertap.com only) | Google cloud | Yes |

---

## What depends on Render?

**Only the backend server runs on Render.** If Render goes down or restarts, the backend API is temporarily unavailable. But:

- MongoDB Atlas runs independently (our data is safe)
- Redis runs independently (cache may be lost but rebuilds automatically)
- The frontend is a static site (can be hosted anywhere)

**The 512 MB memory limit on Render's free tier is why the crash happened** - too many background jobs running at the same time during server startup.

---

## What data is stored where?

### MongoDB Atlas (Permanent Storage - survives restarts)

| Data | Description |
|------|-------------|
| **AnalyticsTicket** | Every solved ticket with metrics: owner, CSAT rating, response times, FRR, NOC info |
| **PrecomputedDashboard** | Pre-calculated analytics results (so pages load instantly) |
| **Remark** | Team comments/notes on specific tickets |
| **View** | Saved filter combinations per user |
| **AnalyticsCache** | Backup cache for analytics (fallback if Redis is down) |

### Redis (Temporary Cache - fast but not permanent)

| Data | Lifetime | Why |
|------|----------|-----|
| Active tickets list | 5 minutes | Avoids re-fetching from DevRev on every page load |
| Analytics results | 30 minutes | Pre-computed stats served instantly |
| Timeline replies | 10 minutes | Last reply timestamps for each ticket |
| Leaderboard | 1 hour | Gamification rankings |

### In-Memory (Lives only while server is running)

| Data | Why |
|------|-----|
| Roster / Shift schedule | Read from Google Sheets at startup, kept in memory for fast lookup |

---

## How does data flow?

### 1. Ticket data (DevRev -> our system)

```
DevRev (source of truth)
    |
    |-- [Every few minutes / on webhook trigger]
    |   Backend calls DevRev API to fetch tickets
    |   |
    |   v
    |   Redis (cached for 5 min) --> Served to frontend instantly
    |
    |-- [Every 6 hours]
    |   Backend syncs solved tickets to MongoDB
    |   Calculates: CSAT, FRR, response times, NOC links
    |   |
    |   v
    |   MongoDB (permanent) --> Used for analytics & gamification
```

### 2. Analytics & Gamification (MongoDB only, NOT Render-dependent)

```
MongoDB (has all historical tickets)
    |
    |-- Backend runs aggregation queries
    |   Groups by: owner, date, region, quarter
    |   Calculates: avg response time, CSAT %, FRR %, leaderboard
    |   |
    |   v
    |   PrecomputedDashboard (saved in MongoDB)
    |   |
    |   v
    |   Frontend loads pre-computed results (instant)
```

**Analytics and Gamification use MongoDB for all calculations.** Render just runs the code that queries MongoDB. If Render restarts, the data in MongoDB is untouched - only the running computation is interrupted and restarts automatically.

### 3. Real-time updates (WebSocket)

```
DevRev webhook --> Backend receives event
    |
    v
Backend re-syncs tickets from DevRev
    |
    v
Socket.io pushes update to all connected browsers
    |
    v
Dashboard updates without page refresh
```

---

## All features and what they use

| Feature | What it shows | Data source | Stored in |
|---------|--------------|-------------|-----------|
| **Ongoing Tickets** | All open/active support tickets | DevRev API (live) | Redis cache |
| **Analytics Dashboard** | CSAT %, FRR %, response times, trends | Historical solved tickets | MongoDB |
| **Gamification / Leaderboard** | Individual performance rankings (L1/L2) | Historical solved tickets | MongoDB |
| **NOC Tracking** | Tickets linked to NOC incidents | Historical + DevRev links | MongoDB |
| **Roster / Backup Finder** | Who is on shift, find backup for absent person | Google Sheets | In-memory |
| **Custom Views** | Saved ticket filters per user | User preferences | MongoDB |
| **Remarks** | Internal notes on tickets | User input | MongoDB |
| **Slack Alerts** | NOC escalation notifications | Triggered during sync | Slack webhook |

---

## Background jobs (what runs automatically)

| Job | When | What it does | Memory impact |
|-----|------|-------------|---------------|
| **Ticket sync** | On webhook + startup | Fetches active tickets from DevRev, caches in Redis | Medium |
| **Historical sync** | Every 6 hours | Syncs solved tickets to MongoDB, checks NOC links | Medium |
| **Analytics precompute** | Every 15 min + startup | Runs MongoDB aggregations, saves results | Medium |
| **Timeline enrichment** | After ticket sync | Fetches last reply timestamps per ticket | Low |
| **Roster sync** | On startup | Reads Google Sheets for shift data | Low |

**The memory crash happened because Ticket sync + Analytics precompute + Roster sync all ran simultaneously at startup, exceeding the 512 MB limit.**

---

## What happened in the Feb 15 incident

### Timeline
1. Server started on Render (512 MB RAM limit)
2. Multiple background jobs launched simultaneously:
   - Ticket sync from DevRev (fetches hundreds of tickets)
   - Analytics pre-computation (heavy MongoDB aggregations)
   - Roster sync from Google Sheets
3. Combined memory usage exceeded 512 MB
4. Render killed the process (OOM - Out of Memory)
5. Render automatically restarted the service
6. Service recovered and is now healthy

### Root causes fixed
1. **Memory spike at startup** - Background jobs now start one at a time with delays between them (staggered)
2. **Inefficient array handling** - Ticket sync was copying the entire ticket array every batch instead of appending in place
3. **Rate limiter error** - Render's proxy headers weren't being trusted by Express, causing a validation error

### Why data was NOT lost
- All permanent data lives in MongoDB Atlas (separate service, not on Render)
- Redis cache rebuilds automatically on restart
- The crash only affected the running process, not stored data

---

## Quick reference: what talks to what

```
Frontend (Browser)
    |
    | HTTPS requests + WebSocket
    v
Render (Backend Server) -----> MongoDB Atlas (permanent data)
    |                    |
    |                    +----> Redis (temporary cache)
    |
    +----> DevRev API (fetch tickets)
    +----> Google Sheets API (roster)
    +----> Google OAuth (login)
    +----> Slack Webhook (alerts)
    +----> Google Gemini (AI insights, optional)
```

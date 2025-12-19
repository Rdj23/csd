# Architectural & Code Decisions

This document explains the **"Why"** behind every major technical decision in the Support Dashboard.

---

## 1. BullMQ + Redis Instead of Standard Async/Await API Calls

### The Problem

The DevRev API is the source of truth for all ticket data. A naive approach would be:

```javascript
// BAD: Direct API call in request handler
app.get("/api/tickets", async (req, res) => {
  const tickets = await fetchAllTicketsFromDevRev();  // 5-30 seconds
  res.json(tickets);
});
```

This fails in three ways:

1. **Rate Limiting**: DevRev limits API calls. With 70 concurrent users refreshing their dashboard, we'd need 70 simultaneous DevRev API calls — instant rate limit.

2. **Event Loop Blocking**: Fetching and processing thousands of tickets involves CPU-intensive operations (JSON parsing, filtering, trimming). In a single-threaded Node.js process, this blocks the event loop for all other users.

3. **No Retry Guarantees**: If a DevRev API call fails mid-sync (network blip, 503), the entire user request fails. No automatic retry.

### The Solution: BullMQ

```
User Request → Read from Redis Cache (< 5ms)
                    ↑
BullMQ Worker → Fetch from DevRev API → Write to Redis/MongoDB
                    ↑
Cron / Webhook → Enqueue Job
```

**BullMQ solves all three problems:**

| Problem                | BullMQ Solution                                                |
| ---------------------- | -------------------------------------------------------------- |
| Rate Limiting          | `concurrency: 1` per queue — only one job runs at a time, serial API calls |
| Event Loop Blocking    | Workers can run in a separate process (`NODE_ROLE=worker`), isolating CPU work from the API server |
| Retry Guarantees       | Exponential backoff (5s → 10s → 20s for ticket-sync, 30s → 60s → 120s → 240s for historical) |

**Additional benefits:**
- **Job deduplication**: Webhooks use `jobId: "webhook-sync"` — 10 webhooks in 5s = 1 sync job
- **Progress tracking**: Workers report % progress via Socket.IO for the frontend progress bar
- **Observability**: Bull Board UI at `/api/admin/queues` shows job history, errors, retries
- **Graceful shutdown**: Workers finish current jobs before process exit (20s budget)

### Why 5 Separate Queues?

Different sync types have different failure profiles:

| Queue             | External API | Typical Duration | Retry Strategy                        |
| ----------------- | ------------ | ---------------- | ------------------------------------- |
| ticket-sync       | DevRev       | 30s-2min         | 3 attempts, 5s exp backoff            |
| historical-sync   | DevRev       | 5-15min          | 4 attempts, 30s exp backoff           |
| analytics         | None (CPU)   | 2-5s             | 4 attempts, 15s exp backoff           |
| roster            | Google Sheets | 5-10s           | 3 attempts, 10s exp backoff           |
| activity-sync     | DevRev       | 2-10min          | 3 attempts, 30s exp backoff           |

If these shared one queue, a 15-minute historical sync would block ticket refreshes. Separate queues ensure independent processing.

---

## 2. Redis Caching Strategy

### Two Caching Modes: Raw String vs. Parsed JSON

**Raw String Caching** (`redisGetRaw()`):

```javascript
// Used for GET /api/tickets (hot path)
const raw = await redis.get("tickets:active");  // Returns string
res.setHeader("Content-Type", "application/json");
res.send(raw);  // Send string directly — NO JSON.parse/stringify
```

**Why?** The active tickets payload is 20-50MB. `JSON.parse()` + `JSON.stringify()` costs:
- ~150ms parse + ~100ms stringify = 250ms per request
- ~40MB memory allocation per request
- With 70 concurrent users: 2.8GB memory, 17.5 seconds of CPU time

By piping the raw string, we serve 70 users with **zero** parsing overhead.

**Parsed JSON Caching** (`redisGet()`):

```javascript
// Used for analytics, live stats (need manipulation before sending)
const data = await redisGet("livestats:Q1_26:...");  // Returns parsed object
data.generatedAt = new Date();  // Modify before sending
res.json(data);
```

Used when the backend needs to modify cached data before sending (e.g., add metadata, merge with other sources).

### Redis Hash for Per-Ticket Lookups

```
tickets:active       → String (full JSON array, 20-50MB)
tickets:active:hash  → Hash  (per-ticket, O(1) lookup)
```

**Why both?**
- The String serves the full dashboard (GET /api/tickets)
- The Hash serves point lookups: "Who owns TKT-1234?" for activity enrichment and dependency resolution

Without the Hash, every single-ticket lookup would require parsing the 20MB array. The Hash gives O(1) access via `HGET`.

**Batch writes** use Redis pipelines:

```javascript
const pipeline = redis.pipeline();
tickets.forEach(t => pipeline.hset("tickets:active:hash", t.display_id, JSON.stringify(t)));
pipeline.expire("tickets:active:hash", TTL);
await pipeline.exec();  // Single round-trip for all writes
```

### Cache Stampede Prevention

When a cache expires and 70 users hit the analytics endpoint:

```
WITHOUT protection:  70 identical MongoDB aggregations (5s each) = server overload
WITH protection:     1 aggregation + 69 users served from fresh cache
```

**Implementation**: Distributed lock using Redis `SET NX EX`:

```javascript
const token = uuid();
const acquired = await redis.set(`lock:${key}`, token, "EX", 60, "NX");
// NX = Only set if key doesn't exist (atomic)
// EX = Auto-expire after 60s (prevents deadlock)

// Release: Lua script ensures only owner can unlock
await redis.eval(`
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end
`, 1, `lock:${key}`, token);
```

### Cache Invalidation Strategy

**On sync completion**: Delete all analytics-related caches using `SCAN` (not `KEYS`):

```javascript
// KEYS * is O(N) and BLOCKS Redis for 100ms+ on large keyspaces
// SCAN iterates in small batches (COUNT=100), non-blocking
let cursor = "0";
do {
  const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
  if (keys.length) await redis.del(...keys);
  cursor = nextCursor;
} while (cursor !== "0");
```

### TTL Strategy

| Cache Type    | TTL    | Rationale                                          |
| ------------- | ------ | -------------------------------------------------- |
| Active Tickets | 300s  | Must be fresh (webhook-triggered refresh anyway)   |
| Analytics      | 900s  | Expensive to compute, data changes slowly          |
| Leaderboard    | 1800s | Only changes after historical sync (daily)         |
| Drill-down     | 300s  | Medium cost, moderate freshness need               |
| Roster         | 86400s | Changes rarely (manual updates only)              |

---

## 3. MongoDB Design Decisions

### Connection Pooling

```javascript
maxPoolSize: 50,    // Increased from default 5
minPoolSize: 10,    // Keep warm connections ready
```

**Why 50?** With 70 concurrent users, each request may need 1-2 MongoDB operations. The default pool (5 connections) caused connection queuing under peak load — requests would wait 200-500ms just to get a connection. Pool of 50 handles peak with headroom.

**Why minPoolSize: 10?** Cold connections take 10-50ms to establish. Keeping 10 warm avoids latency spikes after idle periods.

### Schema Design: AnalyticsTicket

**Denormalized for read performance:**

```javascript
{
  ticket_id: "TKT-1234",       // Duplicate of display_id (for different access patterns)
  owner: "Rohan",               // Pre-resolved (not a DevRev ID reference)
  account_cohort: "Enterprise", // Pre-classified (not joined from accounts collection)
  is_noc: true,                 // Pre-computed flag (not derived from linked issues)
  noc_jira_key: "NOC-567",     // Pre-fetched (not requiring API call)
}
```

**Why denormalize?** Analytics queries need to filter + group by owner, cohort, NOC status. If these were references requiring joins/lookups, every analytics query would need N+1 lookups. By pre-resolving during sync, reads are instant.

### Compound Indexes

```javascript
// Most common query pattern: "leaderboard for Q1"
{ closed_date: 1, owner: 1 }

// "Tickets I closed, newest first"
{ owner: 1, stage_name: 1, closed_date: -1 }

// "Cursor pagination" (no .skip())
{ closed_date: -1, _id: -1 }
```

**Index design principle**: Each compound index matches a common query's `$match` + `$sort` fields in order. MongoDB can satisfy the query entirely from the index (covered query) without touching documents.

### Cursor-Based Pagination

```javascript
// Offset-based (BAD at scale):
.skip(10000).limit(200)  // MongoDB scans 10,000 docs, discards them

// Cursor-based (GOOD at scale):
$or: [
  { closed_date: { $lt: cursorDate } },
  { closed_date: cursorDate, _id: { $lt: cursorId } }
]
.sort({ closed_date: -1, _id: -1 }).limit(200)
// MongoDB seeks directly to cursor position via index — O(1)
```

### `.allowDiskUse(true)` on Aggregations

MongoDB limits aggregation pipeline memory to 100MB by default. Our analytics aggregations (grouping thousands of tickets by owner + date + metrics) can exceed this. `allowDiskUse(true)` allows spilling to disk, preventing OOM crashes at the cost of slightly slower aggregation.

### Upsert Strategy (Idempotent Sync)

```javascript
AnalyticsTicket.bulkWrite([{
  updateOne: {
    filter: { ticket_id: "TKT-1234" },
    update: { $set: { owner: "Rohan", csat: 2, ... } },
    upsert: true
  }
}]);
```

**Why upsert?** Tickets change (owner reassignment, CSAT updates, status changes). Running the sync twice must produce the same result. `upsert` handles both inserts (new ticket) and updates (changed ticket) idempotently.

### TTL Indexes for Auto-Cleanup

```javascript
// Remarks: auto-delete after 30 days
{ timestamp: 1 }, { expireAfterSeconds: 2592000 }

// AnalyticsCache: auto-delete after 24 hours
{ computed_at: 1 }, { expireAfterSeconds: 86400 }

// PrecomputedDashboard: auto-delete after 48 hours
{ computed_at: 1 }, { expireAfterSeconds: 172800 }
```

No manual cleanup needed — MongoDB's background thread handles deletion.

---

## 4. Real-Time Updates: Redis Pub/Sub + Socket.IO

### Why Not Direct Socket.IO?

In a multi-process deployment (`NODE_ROLE=api` + `NODE_ROLE=worker`), the worker process doesn't have Socket.IO connections. Redis Pub/Sub bridges the gap:

```
Worker Process                    API Process
┌──────────────┐                 ┌───────────────┐
│ BullMQ Worker │ ──pub/sub───→  │ Socket.IO     │ → Browser 1
│ completes sync│                │ Server        │ → Browser 2
└──────────────┘                 │               │ → Browser 70
                                 └───────────────┘
```

Two dedicated Redis clients (pubClient, subClient) handle the channel:
- `worker:socket-events` — generic events (SYNC_PROGRESS, DATA_UPDATED)
- `worker:roster-updated` — roster-specific updates

### Why Separate Clients?

Redis Pub/Sub requires a **dedicated** connection once subscribed — you can't send regular commands on the same connection. Hence two clients.

---

## 5. Authentication Layers

### Why Both JWT and API Keys?

| Auth Method | For                   | Lifetime | Scope            |
| ----------- | --------------------- | -------- | ---------------- |
| JWT         | Human users (browser) | 30 days  | Full access      |
| API Key     | Machine-to-machine    | Optional expiry | Scoped (read:analytics, etc.) |

**JWT** is convenient for browsers (Google OAuth → JWT → stored in localStorage).

**API Keys** enable external services to consume analytics without a Google login. They're HMAC-SHA256 hashed before storage — a database breach doesn't expose valid keys.

### Rate Limiting Tiers

| Tier           | Limit           | Applied To                |
| -------------- | --------------- | ------------------------- |
| Auth attempts  | 10 req / 15min  | `/api/auth/*`             |
| API key attempts | 20 req / 15min | API key validation      |
| General API    | 5000 req / 15min | All `/api/*` endpoints  |
| Webhooks       | No limit        | `/api/webhooks/*` (DevRev bursts) |

---

## 6. Process Architecture

### Hybrid Mode (Default)

```
Single Process:
  Express API Server + Socket.IO + BullMQ Workers
  
  Pros: Simple deployment (1 dyno on Render), no inter-process communication needed
  Cons: CPU-heavy worker jobs can stall API responses
```

### Split Mode (Production-Ready)

```
API Process (NODE_ROLE=api):
  Express + Socket.IO + Redis Pub/Sub subscriber
  
Worker Process (NODE_ROLE=worker):
  BullMQ workers + Redis Pub/Sub publisher
  
Communication: Via Redis (BullMQ queues + Pub/Sub channels)
```

**Decision**: Currently running hybrid on Render's free tier. The `NODE_ROLE` flag is ready for split deployment when scaling requires it.

### Graceful Shutdown (20s Budget)

```
SIGTERM received
    ↓
1. Stop accepting new HTTP connections (http-terminator)
2. Drain in-flight requests (up to 10s)
3. Close Socket.IO connections
4. Close BullMQ workers (let current jobs finish)
5. Close MongoDB + Redis connections
6. Force exit if 20s exceeded
```

This prevents data corruption during deploys.

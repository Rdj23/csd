# How We Access DevRev's Massive Database

## The Problem

DevRev's database contains hundreds of thousands of tickets. The DevRev API has rate limits and each paginated request takes 200-500ms. With 70+ concurrent users hitting the dashboard, we can't have each user request trigger a fresh DevRev API call — we'd hit rate limits instantly and responses would take 10+ seconds.

## The Solution: Multi-Layer Caching + Background Sync

We **never** let user requests touch the DevRev API directly. Instead:

```
DevRev API ──(background sync)──→ MongoDB + Redis ──(user request)──→ Frontend
```

### Layer 1: Background Sync (BullMQ Workers)

All DevRev API calls happen in background workers, not in the request path:

| Sync Type      | Trigger              | What It Fetches                        | Where It Stores       |
| -------------- | -------------------- | -------------------------------------- | --------------------- |
| Active Tickets | Webhook / 5min cron  | All active tickets via `works.list`    | Redis (String + Hash) |
| Historical     | Daily 9:30 AM cron   | All solved tickets via `works.list`    | MongoDB (AnalyticsTicket) |
| Activity       | Every 10 minutes     | Timeline entries (comments)            | MongoDB (UserActivityEntry + Daily) |
| Roster         | Startup + triggered  | Google Sheets data                     | Redis + module state  |

### Layer 2: Redis (Hot Cache, 5-15 min TTL)

For data that changes frequently (active tickets):

```
GET /api/tickets →
  1. redisGetRaw("tickets:active")  // Return raw JSON string (no parse!)
  2. If miss: quickFetchTickets()   // Single page, 50 tickets, 10s timeout
     + Kick off background full sync
```

The `redisGetRaw()` optimization is critical — it returns the Redis value as a raw string directly to the HTTP response, avoiding:
- `JSON.parse()` on 20-50MB of data (~150ms saved)
- `JSON.stringify()` when sending response (~100ms saved)
- Memory allocation for parsed objects (~40MB saved)

### Layer 3: MongoDB (Warm Cache, 24-48h TTL)

For precomputed analytics:

```
GET /api/tickets/analytics →
  1. Check PrecomputedDashboard (nightly precomputed, 48h TTL)
  2. Check Redis analytics cache (filtered queries, 15min TTL)
  3. Check MongoDB AnalyticsCache (24h TTL)
  4. If all miss: Compute fresh + cache everywhere
```

### Layer 4: Per-Ticket Hash (O(1) Lookups)

For single-ticket lookups (dependency resolution, activity enrichment):

```
Redis Hash: tickets:active:hash
  Key: display_id (e.g., "TKT-1234")
  Value: ticket object

Lookup: HGET tickets:active:hash TKT-1234  // O(1), no array scan
```

Without this, finding one ticket in the active list would require parsing 20MB of JSON and scanning the array. The Hash gives O(1) access.

---

## DevRev API Interaction Patterns

### Pagination

DevRev uses cursor-based pagination. We iterate until the cursor is exhausted:

```javascript
let cursor = undefined;
do {
  const response = await fetchWithRetry("/works.list", { cursor, limit: 50 });
  tickets.push(...response.data.works);
  cursor = response.data.next_cursor;
} while (cursor);
```

### Rate Limiting: fetchWithRetry()

```javascript
// devrevApi.js
async fetchWithRetry(endpoint, body, { attempts = 2, delay = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await axios.post(DEVREV_API + endpoint, body, { headers, timeout: 15000 });
    } catch (err) {
      if (i < attempts - 1) await sleep(delay * (i + 1));  // Linear backoff
      else throw err;
    }
  }
}
```

This is **per-API-call** retry. On top of this, BullMQ provides **per-job** retry with exponential backoff (30s, 60s, 120s, 240s).

### Early Exit Optimization

During historical sync, we stop early when we've seen enough "already known" tickets:

```javascript
let consecutiveKnownBatches = 0;
for each batch:
  newTickets = batch.filter(t => !existsInDB(t.ticket_id));
  if (newTickets.length === 0) consecutiveKnownBatches++;
  else consecutiveKnownBatches = 0;
  
  if (consecutiveKnownBatches >= 5) break;  // No new data, stop
```

This means a delta sync (daily) only scans recent pages instead of the entire DevRev database.

### Batch Concurrency Control

When resolving NOC links or ownership, we process in batches of 5:

```javascript
for (let i = 0; i < tickets.length; i += 5) {
  const batch = tickets.slice(i, i + 5);
  await Promise.allSettled(batch.map(t => fetchTicketLinks(t.id)));
  // allSettled: partial failures don't block the batch
}
```

Why 5? Empirically, this balances throughput vs. DevRev rate limits.

---

## Cache Stampede Prevention

When a cache expires and 70 users simultaneously request analytics:

```
WITHOUT protection:
  User 1 → cache miss → compute (5s) → cache set
  User 2 → cache miss → compute (5s) → cache set  ← DUPLICATE WORK
  User 3 → cache miss → compute (5s) → cache set  ← DUPLICATE WORK
  ... 70 identical computations

WITH distributed lock:
  User 1 → cache miss → acquire lock → compute (5s) → cache set → release lock
  User 2 → cache miss → lock taken → wait 2s → retry cache → HIT
  User 3 → cache miss → lock taken → wait 2s → retry cache → HIT
```

Implementation using Redis atomic operations:

```javascript
// Acquire lock (SET NX EX pattern)
redisLock(key, ttlSeconds) {
  const token = uuid();
  const acquired = await redis.set(`lock:${key}`, token, "EX", ttlSeconds, "NX");
  return acquired ? token : null;
}

// Release lock (Lua script for atomicity)
redisUnlock(key, token) {
  await redis.eval(
    `if redis.call("get", KEYS[1]) == ARGV[1] then
       return redis.call("del", KEYS[1])
     end`,
    1, `lock:${key}`, token
  );
}
```

The Lua script ensures only the lock owner can release it (prevents accidental unlock by a different process).

---

## Cache Invalidation

When a sync completes, all relevant caches are cleared:

```javascript
// After historical sync
await redisDelete("analytics:*");    // Uses SCAN, not KEYS (non-blocking)
await redisDelete("livestats:*");
await redisDelete("bydate:*");
await AnalyticsCache.deleteMany({});
await PrecomputedDashboard.deleteMany({});
```

`redisDelete()` uses `SCAN` instead of `KEYS` to iterate Redis entries in small batches (COUNT=100). `KEYS` is O(N) and blocks Redis for 100ms+ on large keyspaces, stalling all concurrent users.

---

## Connection Pooling

### MongoDB

```javascript
// database.js
maxPoolSize: 50,          // 70 users need ~50 concurrent DB connections
minPoolSize: 10,          // Keep 10 warm connections ready
socketTimeoutMS: 30000,   // 30s timeout per socket
maxIdleTimeMS: 30000,     // Close idle connections after 30s
```

**Why 50?** With 70 concurrent users, each request may need 1-2 MongoDB connections. The default pool size (5) caused connection queuing under load. 50 handles peak load with headroom.

### Redis

```javascript
maxRetriesPerRequest: null,   // Never give up (BullMQ requirement)
retryStrategy: (times) => Math.min(times * 2000, 30000),  // 2s, 4s, ..., 30s max
lazyConnect: true,            // Don't connect until first command
```

---

## Reference Files

| File | Purpose |
| ---- | ------- |
| `backend/services/devrevApi.js` | `fetchWithRetry()`, all DevRev API calls |
| `backend/services/syncService.js` | `fetchAndCacheTickets()`, `syncHistoricalToDB()` |
| `backend/config/database.js` | Redis helpers, MongoDB config, cache stampede prevention |
| `backend/lib/queues.js` | BullMQ queue definitions |
| `backend/lib/workers.js` | Worker processors |
| `backend/controllers/ticketController.js` | `getActiveTickets()` (raw JSON piping) |

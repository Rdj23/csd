# Scaling Considerations

What the next team needs to watch out for as the app scales beyond 100 users or as the DevRev database grows to hundreds of thousands of tickets.

---

## 1. Current Bottlenecks & Their Limits

### 1.1 Single-Process Hybrid Mode

**Current**: API server + BullMQ workers run in the same Node.js process (`NODE_ROLE=hybrid`).

**Problem at scale**: A 15-minute historical sync or a CPU-heavy analytics precompute starves the event loop, adding 100-500ms latency to API responses for all 70+ users.

**Fix**: Split into two processes:
```
NODE_ROLE=api    → Express + Socket.IO (responds to users)
NODE_ROLE=worker → BullMQ workers (background processing)
```

The infrastructure is already ready — `NODE_ROLE` env var is implemented, Redis Pub/Sub bridges events between processes. Just deploy two separate services.

**When to split**: When you see API response times spike during sync windows (check `/api/health` uptime + latency).

### 1.2 Memory Ceiling (384MB)

**Current**: `--max-old-space-size=384` (Render free tier constraint).

**What breaks**: Full backfill sync loads ticket data incrementally, but peak memory during a historical sync of 100K+ tickets can approach this limit. `global.gc()` is called after heavy operations, but this is a band-aid.

**Fix options**:
- Increase heap to 1-2GB on a paid tier
- Implement streaming processing (process tickets one batch at a time, write to DB, discard batch)
- The incremental save (every 3 batches) already helps, but verify it's aggressive enough for your data size

### 1.3 Redis Memory (Active Tickets Cache)

**Current**: `tickets:active` stores all active tickets as a single JSON string (20-50MB).

**What breaks at 500+ active tickets**: The string grows to 100MB+. Redis memory pressure increases, and the raw-string optimization saves CPU but not memory.

**Fix options**:
- Switch to paginated Redis storage (split into `tickets:active:page:1`, `tickets:active:page:2`, etc.)
- Use Redis Streams instead of a single key
- Move to a dedicated Redis instance with more memory
- Compress the JSON with zlib before storing (trade CPU for memory)

### 1.4 MongoDB Connection Pool

**Current**: `maxPoolSize: 50` connections.

**What breaks at 200+ concurrent users**: Each user request needs 1-2 connections. At 200 users with concurrent requests, you'll exhaust the pool and see connection queuing.

**Fix**: Increase to 100-200. But also check your MongoDB Atlas tier — free/shared clusters have connection limits (500 for M10, lower for free tier). You may need to upgrade the Atlas tier.

### 1.5 Analytics Aggregation Performance

**Current**: Analytics queries run on the full `AnalyticsTicket` collection with `allowDiskUse(true)`.

**What breaks at 100K+ tickets**: Aggregation time grows linearly. A query that takes 2s with 10K tickets will take 20s with 100K tickets. Even with caching, the first user after cache expiry waits 20s.

**Fix options**:
- **Materialized views**: Pre-aggregate daily stats into a `DailyStats` collection (1 doc per owner per day instead of 1 doc per ticket)
- **Time-based partitioning**: Archive old quarters to a separate collection; only query active quarter
- **Increase precompute frequency**: Run analytics precompute every hour instead of daily
- **Add `closed_date` range indexes** with `hint()` to force optimal index usage

---

## 2. DevRev API Scaling

### 2.1 Rate Limits

**Current**: BullMQ concurrency: 1 serializes all API calls. At ~200ms per call with 50 tickets/page, a full sync of 10K tickets takes:
```
10,000 tickets / 50 per page = 200 pages × 200ms = 40 seconds (just pagination)
+ NOC link resolution: 200 pages × 5 concurrent × 200ms = additional 40s
Total: ~2 minutes
```

**At 100K tickets**: ~20 minutes for a full sync. Delta sync helps (early exit after 5 known batches), but the first-ever sync or a backfill will be painful.

**Fix options**:
- Negotiate higher API rate limits with DevRev
- Implement true incremental sync using DevRev's `modified_date` field (only fetch tickets changed since last sync)
- Use DevRev webhooks more aggressively to avoid polling (already partially implemented)
- Parallelize API calls within a single job (increase batch concurrency from 5 to 10-20)

### 2.2 Webhook Volume

**Current**: All DevRev webhooks hit a single endpoint. Job deduplication (`jobId: "webhook-sync"`, 5s delay) coalesces multiple webhooks into one sync.

**What breaks**: At high webhook volume (thousands/hour), the 5s coalescing window may not be enough, or the single sync job may not complete before the next batch.

**Fix**: Implement event-level processing — instead of "sync everything on any webhook", update only the specific ticket that changed. This requires parsing the webhook payload and doing targeted upserts.

---

## 3. Frontend Scaling

### 3.1 Active Ticket List in Memory

**Current**: All active tickets are loaded into the Zustand store as a single array. Filtering and sorting happen client-side.

**What breaks at 2000+ active tickets**: React re-renders become expensive. Sorting 2000 objects with 20+ fields on every filter change causes visible lag.

**Fix options**:
- **Server-side filtering**: Move filters to API query params, return pre-filtered data
- **Virtualization**: Use `react-window` or `react-virtualized` to render only visible rows
- **Pagination on server**: Return 50-100 tickets per page, not all at once
- **Web Workers**: Offload sorting/filtering to a Web Worker to keep the UI thread free

### 3.2 Socket.IO Connections

**Current**: Every browser tab opens a Socket.IO connection. 70 users with 2 tabs each = 140 connections.

**What breaks at 500+ connections**: Socket.IO's default in-memory adapter doesn't scale beyond a single process. Sticky sessions are required with multiple API processes.

**Fix**: Use `@socket.io/redis-adapter` (not just Pub/Sub) for multi-process Socket.IO. This is the standard solution for horizontal scaling.

### 3.3 Bundle Size

**Current**: React 19 + Nivo + Recharts + TailwindCSS. Charting libraries are heavy (500KB+ combined).

**Fix options**:
- Lazy-load chart components (`React.lazy()` + `Suspense`)
- Tree-shake unused chart types
- Consider lighter alternatives (e.g., Chart.js instead of both Nivo and Recharts)

---

## 4. Database Scaling

### 4.1 Collection Growth

| Collection            | Current Growth Rate | At 100K tickets/quarter |
| --------------------- | ------------------- | ----------------------- |
| `AnalyticsTicket`     | ~3K docs/quarter    | 100K docs/quarter       |
| `UserActivityEntry`   | ~10K docs/quarter   | 500K+ docs/quarter      |
| `UserActivityDaily`   | ~2K docs/quarter    | ~10K docs/quarter       |

**UserActivityEntry** is the fastest-growing collection. At 500K+ docs, queries without proper indexes will time out.

**Fix options**:
- **Archive old data**: Move entries older than 6 months to an archive collection
- **Increase rollup reliance**: Use `UserActivityDaily` for all queries except drill-downs; only hit `UserActivityEntry` for specific date+hour drill-downs
- **TTL index on UserActivityEntry**: Auto-delete entries older than 1 year

### 4.2 Index Storage

More indexes = more storage + slower writes. The `AnalyticsTicket` schema has **11 compound indexes**. At 100K+ documents, index storage alone could be 500MB+.

**Monitor**: Check `db.analyticstickets.stats()` for `totalIndexSize`. If it exceeds available RAM, queries fall back to disk.

**Fix**: Audit indexes periodically. Remove any that aren't used (check with `$indexStats` aggregation). Consolidate overlapping indexes.

### 4.3 Write Amplification

Every `syncHistoricalToDB()` does a `bulkWrite` with upserts. At 100K tickets, this means 100K upsert operations hitting 11 indexes each.

**Fix**: Use `bulkWrite` with `ordered: false` (already done) to parallelize. Consider writing to a staging collection first, then swapping.

---

## 5. Operational Concerns

### 5.1 Monitoring Gaps

**Currently missing**:
- No APM (Application Performance Monitoring)
- No alerting on slow queries or high error rates
- No Redis memory monitoring
- No MongoDB slow query log analysis

**Recommended**:
- Add Datadog, New Relic, or at minimum a `/api/metrics` endpoint exposing:
  - API response time percentiles (p50, p95, p99)
  - Redis hit/miss ratio
  - MongoDB query time distribution
  - BullMQ job completion/failure rates
  - Active Socket.IO connections

### 5.2 Backup & Recovery

**Current**: MongoDB Atlas handles backups. But Redis is ephemeral — a Redis restart loses all cached data.

**Impact of Redis loss**: Dashboard shows stale data for ~5 minutes until background sync repopulates the cache. Not catastrophic, but users see "loading" states.

**Fix**: Ensure Redis persistence is enabled (RDB snapshots or AOF), or accept the cold-start cost and document it.

### 5.3 Secret Rotation

**Current**: DevRev PAT, JWT secret, API key HMAC secret are all static.

**Concern**: If the DevRev PAT expires or is rotated, all syncs fail silently until someone notices.

**Fix**: Add health checks that test DevRev API connectivity (`GET /api/health` already checks DB and Redis — add DevRev API check). Alert on failures.

---

## 6. Scaling Roadmap (Recommended Order)

| Priority | Action | Effort | Impact |
| -------- | ------ | ------ | ------ |
| 1 | Split to api + worker processes | Low (config change) | High (unblocks API during sync) |
| 2 | Increase heap to 1GB+ | Low (config change) | High (prevents OOM on large syncs) |
| 3 | Add server-side ticket filtering | Medium | High (reduces frontend memory + re-renders) |
| 4 | Implement incremental sync (modified_date) | Medium | High (10x faster syncs) |
| 5 | Add materialized daily stats view | Medium | High (10x faster analytics queries) |
| 6 | Add APM/monitoring | Medium | Medium (visibility into degradation) |
| 7 | Archive old UserActivityEntry docs | Low | Medium (prevents collection bloat) |
| 8 | Redis adapter for multi-process Socket.IO | Low | Medium (enables horizontal API scaling) |
| 9 | Lazy-load frontend chart libraries | Low | Low (faster initial page load) |
| 10 | Paginate Redis ticket storage | High | Medium (reduces Redis memory at scale) |

---

## 7. Key Numbers to Watch

| Metric | Current | Warning Threshold | Critical |
| ------ | ------- | ----------------- | -------- |
| API p95 response time | ~200ms | > 1s | > 3s |
| Historical sync duration | ~2 min | > 10 min | > 30 min |
| Redis memory usage | ~100MB | > 500MB | > 1GB |
| MongoDB AnalyticsTicket count | ~10K | > 50K | > 200K |
| MongoDB UserActivityEntry count | ~30K | > 200K | > 1M |
| Active Socket.IO connections | ~70 | > 200 | > 500 |
| BullMQ failed jobs (24h) | 0-2 | > 10 | > 50 |
| MongoDB connection pool usage | ~20/50 | > 40/50 | > 48/50 |

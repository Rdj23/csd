# Cron Jobs & Background Processing

## What It Does (User Perspective)

Cron jobs are invisible to users but critical to the dashboard's freshness. They ensure:
- Ticket data is synced from DevRev daily
- Analytics are precomputed so the dashboard loads in < 200ms instead of 2-5s
- Activity data (comments) is captured near-real-time (every 10 minutes)
- Roster data stays current

---

## Scheduled Jobs

All cron jobs are registered as **BullMQ repeatable jobs** at server startup (`backend/server.js` lines 157-205).

| Schedule (UTC)    | IST Equivalent   | Queue             | Job Name                    | What It Does                                        |
| ----------------- | ---------------- | ----------------- | --------------------------- | --------------------------------------------------- |
| `0 4 * * *`       | 9:30 AM IST      | historical-sync   | `delta-sync`                | Sync all solved tickets from DevRev since last cursor |
| `30 4 * * *`      | 10:00 AM IST     | analytics         | `daily-analytics-precompute` | Recompute dashboard stats for current quarter       |
| `0 5 * * *`       | 10:30 AM IST     | activity-sync     | `daily-activity-sync`       | Full activity sync (comments) for last 24h          |
| `*/10 * * * *`    | Every 10 minutes | activity-sync     | `frequent-activity-sync`    | Catch-up sync, looks back 15 min                    |

### Startup Jobs (One-Time)

On server boot, these jobs are dispatched immediately:

| Delay   | Queue           | Purpose                                 |
| ------- | --------------- | --------------------------------------- |
| 0s      | roster          | Sync roster from Google Sheets          |
| 5s      | ticket-sync     | Refresh active tickets cache            |
| 90s     | analytics       | Precompute current quarter analytics    |

### Cleanup on Startup

Before registering new cron schedules, old repeatable jobs are removed:

```javascript
// server.js line 180
const existingJobs = await queue.getRepeatableJobs();
for (const job of existingJobs) {
  await queue.removeRepeatableByKey(job.key);
}
// Then register fresh cron patterns
```

This prevents duplicate cron entries from accumulating across server restarts.

---

## How It Maps to the Backend

### Queue Architecture

Five separate BullMQ queues, each with tailored retry strategies:

| Queue             | Attempts | Backoff Base | Lock Duration | Rationale                              |
| ----------------- | -------- | ------------ | ------------- | -------------------------------------- |
| `ticket-sync`     | 3        | 5s exp       | 5 min         | Fast transient failures, quick retry   |
| `historical-sync` | 4        | 30s exp      | 10 min        | Heavy operation, more breathing room   |
| `analytics`       | 4        | 15s exp      | 5 min         | CPU-heavy aggregations                 |
| `roster`          | 3        | 10s exp      | 2 min         | Independent from DevRev API            |
| `activity-sync`   | 3        | 30s exp      | 10 min        | Bulk API calls, needs rate-limit room  |

All queues use **concurrency: 1** — only one job per queue runs at a time. This prevents DevRev API rate limiting and ensures serial processing consistency.

### Worker Processing (`backend/lib/workers.js`)

Each queue has a dedicated worker:

#### ticket-sync Worker
```javascript
processor: async (job) => {
  await fetchAndCacheTickets(job.data.source || "cron");
}
```

#### historical-sync Worker
```javascript
processor: async (job) => {
  if (job.name === "full-sync") await syncHistoricalToDB(true);
  else await syncHistoricalToDB(false);  // delta-sync
  global.gc();  // Force garbage collection (--expose-gc flag)
}
```

#### analytics Worker
```javascript
processor: async (job) => {
  await precomputeAnalytics(job.data.quarter);
  global.gc();
}
```

#### roster Worker
```javascript
processor: async (job) => {
  await syncRoster();
  publishSocketEvent("ROSTER_UPDATED");
}
```

#### activity-sync Worker
```javascript
processor: async (job) => {
  if (job.name === "backfill") await syncActivityBatch({ fullBackfill: true, quarter });
  else if (job.name === "frequent") await syncActivityBatch({ since: 15min_ago });
  else await syncActivityBatch({ since: job.data.since });
}
```

### Memory Management

Workers run with constrained heap:
```
node --max-old-space-size=384 --expose-gc server.js
```

- **384MB max heap**: Render's free tier constraint
- **--expose-gc**: Allows `global.gc()` calls after heavy syncs to free memory immediately
- **Incremental saves**: During sync loops, data is saved every 3 batches (not just at the end) to avoid accumulating objects

### Job Deduplication (Webhooks)

When multiple webhooks fire within seconds (e.g., bulk ticket update):

```javascript
// webhookController.js
ticketSyncQueue.add("sync-active", { source: "webhook" }, {
  jobId: "webhook-sync",  // Same jobId = deduplicated
  delay: 5000              // 5-second delay allows coalescing
});
```

BullMQ deduplicates jobs with the same `jobId`, so 10 webhooks in 5 seconds result in **one** sync job, not 10.

### Bull Board UI

An admin dashboard for monitoring queues is available at:
```
/api/admin/queues (requires admin authentication)
```

Shows job history, progress, errors, and retry status for all 5 queues.

---

## Reference Files

| File | Purpose |
| ---- | ------- |
| `backend/server.js` (lines 157-205) | Cron registration, startup jobs |
| `backend/lib/queues.js` | Queue definitions (5 queues with configs) |
| `backend/lib/workers.js` | Worker processors (5 workers) |
| `backend/lib/bullboard.js` | Bull Board admin UI |
| `backend/services/syncService.js` | `fetchAndCacheTickets()`, `syncHistoricalToDB()` |
| `backend/services/activityService.js` | `syncActivityBatch()` |
| `backend/services/analyticsService.js` | `precomputeAnalytics()` |
| `backend/services/rosterService.js` | `syncRoster()` |

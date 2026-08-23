# Developer Guide: How to Modify the Support Dashboard

This guide maps common change scenarios to the exact files and steps needed.

---

## 1. Add a New Metric to the Analytics Dashboard

**Example**: Add "Average CSAT Response Time" to the analytics KPI cards.

### Steps

1. **Add the field to AnalyticsTicket schema** (if not already stored):
   ```
   File: backend/models/index.js (AnalyticsTicketSchema, line ~62)
   Add: csat_response_time: Number
   ```

2. **Populate the field during sync**:
   ```
   File: backend/services/syncService.js (syncHistoricalToDB function, line ~238)
   In the upsert $set block, add: csat_response_time: extractFromDevRevFields(ticket)
   ```

3. **Add aggregation stage**:
   ```
   File: backend/utils/aggregationStages.js
   Add to avgMetricFields():
     avgCSATResponseTime: { $avg: { $cond: [{ $gt: ["$csat_response_time", 0] }, "$csat_response_time", null] } }
   ```

4. **Include in analytics controller response**:
   ```
   File: backend/controllers/analyticsController.js (getAnalytics function)
   The new field will automatically appear in stats since it uses ...avgMetricFields()
   ```

5. **Clear caches** (so precomputed data refreshes):
   ```
   POST /api/cache/clear (admin endpoint)
   OR wait for the nightly analytics precompute cron (04:30 UTC)
   ```

6. **Add frontend KPI card**:
   ```
   File: src/features/analytics/components/PerformanceOverview.jsx
   Add a new card consuming analyticsData.stats.avgCSATResponseTime
   ```

### Caches to Clear
- Redis: `analytics:*` keys
- MongoDB: `AnalyticsCache` and `PrecomputedDashboard` collections

---

## 2. Add a New BullMQ Queue for a Background Task

**Example**: Add a "slack-notifications" queue for batch Slack alerts.

### Steps

1. **Define the queue** in `backend/lib/queues.js`:
   ```javascript
   // After existing queue definitions (line ~126)
   let slackQueue = null;
   
   function getSlackQueue() {
     if (!slackQueue && connection) {
       slackQueue = new Queue("slack-notifications", {
         connection,
         defaultJobOptions: {
           attempts: 3,
           backoff: { type: "exponential", delay: 10000 },
           removeOnComplete: 10,
           removeOnFail: 20
         }
       });
     }
     return slackQueue;
   }
   
   // Export it
   module.exports = { ..., getSlackQueue };
   ```

2. **Define the worker** in `backend/lib/workers.js`:
   ```javascript
   // After existing worker registrations
   const slackWorker = new Worker("slack-notifications", async (job) => {
     const { ticketIds } = job.data;
     await sendBatchSlackAlerts(ticketIds);
   }, { connection, concurrency: 1, lockDuration: 120000 });
   
   slackWorker.on("completed", (job) => logger.info(`Slack job ${job.id} done`));
   slackWorker.on("failed", (job, err) => logger.error(`Slack job ${job.id} failed`, err));
   ```

3. **Register cron schedule** (if recurring) in `backend/server.js`:
   ```javascript
   // In the cron registration section (line ~188)
   await getSlackQueue().add("check-pending", {}, {
     repeat: { pattern: "0 */6 * * *" },  // Every 6 hours
     jobId: "periodic-slack-check"
   });
   ```

4. **Add to Bull Board** in `backend/lib/bullboard.js`:
   ```javascript
   const { getSlackQueue } = require("./queues");
   // Add to the serverAdapter setup
   new BullMQAdapter(getSlackQueue())
   ```

5. **Add to graceful shutdown** in `backend/server.js`:
   ```javascript
   // In the shutdown handler
   await slackWorker?.close();
   ```

---

## 3. Add a New Filter to the Ticket Views

**Example**: Add a "Priority" filter (P0, P1, P2, P3).

### Steps

1. **Add filter to frontend UI** in `src/App.jsx`:
   ```javascript
   // In the filter section (after existing MultiSelectFilter components)
   <MultiSelectFilter
     icon={AlertCircle}
     label="Priority"
     options={["P0", "P1", "P2", "P3"]}
     selected={filters.priorities}
     onChange={(val) => setFilters(prev => ({ ...prev, priorities: val }))}
   />
   ```

2. **Add client-side filtering logic** in `src/App.jsx`:
   ```javascript
   // In the filtering logic (line ~714)
   if (filters.priorities.length > 0) {
     filtered = filtered.filter(t => filters.priorities.includes(t.priority));
   }
   ```

3. **For server-side filtering** (All Tickets / Analytics), add query builder:
   ```
   File: backend/utils/queryBuilders.js
   
   function applyPriorityFilter(match, priorities) {
     if (priorities && priorities !== "All") {
       match.priority = { $in: priorities.split(",") };
     }
   }
   ```

4. **Use in controller**:
   ```
   File: backend/controllers/ticketController.js (getTicketsByRange)
   
   const { priorities } = req.query;
   applyPriorityFilter(match, priorities);
   ```

5. **Include in saved views** — No schema change needed! The `View.filters` field is `Object` type, so `{ priorities: ["P0", "P1"] }` is stored automatically.

---

## 4. Add a New Tab/Page

### Steps

1. **Create feature directory**:
   ```
   src/features/my-feature/
   ├── components/
   │   └── MyFeatureDashboard.jsx
   └── index.js
   ```

2. **Add tab in `src/App.jsx`** (line ~1481):
   ```javascript
   { id: "myfeature", label: "My Feature", icon: SomeIcon, component: MyFeatureDashboard }
   ```

3. **Add API endpoint** (if needed):
   ```
   backend/routes/myfeature.js → Define routes
   backend/controllers/myfeatureController.js → Handler logic
   backend/server.js → app.use("/api/myfeature", myfeatureRoutes)
   ```

4. **Add API client**:
   ```
   src/api/myfeatureApi.js → Axios calls to /api/myfeature/*
   ```

5. **Access control** (if admin-only):
   ```javascript
   // In App.jsx tab definition
   { id: "myfeature", ..., adminOnly: true }
   
   // Check SUPER_ADMIN_EMAILS in analyticsConfig.js
   ```

---

## 5. Add a New Field from DevRev to Ticket Display

### Steps

1. **Add to `trimTicket()`** in `backend/services/syncService.js` (line ~51):
   ```javascript
   // Add the field extraction
   my_new_field: ticket.custom_fields?.my_devrev_field || null,
   ```

2. **If it should appear in analytics**, also add to `syncHistoricalToDB()` upsert block.

3. **Add to frontend table column** in `src/features/tickets/components/TicketList.jsx`:
   ```javascript
   // In the table header and body, add the column
   ```

4. **Force a re-sync** to populate the field:
   ```
   POST /api/admin/sync-now (for historical)
   POST /api/tickets/sync (for active)
   ```

---

## 6. Modify Gamification Scoring Weights

### File: `backend/utils/scoring.js` (line ~10)

```javascript
const METRIC_WEIGHTS = {
  productivity:   0.30,   // ← Adjust these weights
  csatPercent:    0.15,
  positiveCSAT:   0.10,
  avgRWT:         0.15,   // Lower is better
  avgIterations:  0.15,   // Lower is better
  frrPercent:     0.15
};
```

**After changing weights:**
1. Clear analytics cache: `POST /api/cache/clear`
2. The next `GET /api/gamification` request will recompute with new weights

**To add a new metric:**
1. Add to `METRIC_WEIGHTS` with a weight
2. Add the metric to the aggregation in `gamificationController.js`
3. Add `{ key: "newMetric", lowerIsBetter: false }` to the metric config array in `scoreAndRank()`
4. The scoring pipeline (percentile → normalize → weight) handles the rest automatically

---

## 7. Add a New Cron Job

### Steps

1. **Choose the right queue** (or create a new one — see #2 above)
2. **Register in `backend/server.js`** (line ~188):
   ```javascript
   await getHistoricalSyncQueue().add("my-job-name", { param: "value" }, {
     repeat: { pattern: "0 6 * * 1" },  // Every Monday at 6 AM UTC
     jobId: "weekly-my-job"
   });
   ```

3. **Handle in the worker** (`backend/lib/workers.js`):
   ```javascript
   // In the appropriate worker's processor
   if (job.name === "my-job-name") {
     await myJobFunction(job.data);
   }
   ```

### Common Cron Patterns
| Pattern           | Meaning                    |
| ----------------- | -------------------------- |
| `0 4 * * *`       | Daily at 4:00 AM UTC      |
| `*/10 * * * *`    | Every 10 minutes           |
| `0 */6 * * *`     | Every 6 hours              |
| `0 6 * * 1`       | Every Monday at 6 AM UTC  |
| `0 0 1 * *`       | First of every month       |

---

## 8. Add a New MongoDB Collection

### Steps

1. **Define schema** in `backend/models/index.js`:
   ```javascript
   const MyModelSchema = new Schema({
     field1: { type: String, index: true },
     field2: Number,
     createdAt: { type: Date, default: Date.now }
   });
   
   // Add compound index if needed
   MyModelSchema.index({ field1: 1, createdAt: -1 });
   
   const MyModel = mongoose.model("MyModel", MyModelSchema);
   module.exports = { ..., MyModel };
   ```

2. **Create indexes** (for production):
   ```
   Add to backend/create-indexes.js and run manually
   OR let Mongoose auto-create on first use (slower, but works)
   ```

3. **Use in controller/service**:
   ```javascript
   const { MyModel } = require("../models");
   const docs = await MyModel.find({ field1: "value" }).lean();
   ```

---

## 9. Debug a Failed Sync Job

### Steps

1. **Check Bull Board**: Navigate to `/api/admin/queues` (requires admin login)
2. **Check job status via API**: `GET /api/admin/job-status/:jobId`
3. **Check sync status**: `GET /api/admin/sync-status` (returns DB ticket count, latest close date, staleness)
4. **Manual re-trigger**: `POST /api/admin/sync-now` (delta) or `POST /api/admin/backfill` (full)
5. **Single ticket debug**: `POST /api/admin/sync-ticket` with `{ ticket_id: "TKT-1234" }`

### Common Failure Causes
| Symptom | Likely Cause | Fix |
| ------- | ------------ | --- |
| Job retries then fails | DevRev API rate limit | Wait + retry manually |
| Job hangs (no progress) | Lock duration exceeded | Job auto-releases lock, will retry |
| "Out of memory" in logs | Large sync + 384MB heap limit | Use delta sync, not full backfill |
| Stale cache after sync | Cache clear failed | Manual: `POST /api/cache/clear` |

---

## 10. Environment Variable Reference

| Variable | Required | Default | Purpose |
| -------- | -------- | ------- | ------- |
| `PORT` | No | 5000 | HTTP server port |
| `NODE_ROLE` | No | hybrid | `api`, `worker`, or `hybrid` |
| `MONGODB_URI` / `MONGO_URI` | Yes | — | MongoDB Atlas connection string |
| `REDIS_URL` | Yes | — | Redis connection URL |
| `DEVREV_PAT` | Yes | — | DevRev Personal Access Token |
| `DEVREV_API` | No | https://api.devrev.ai | DevRev API base URL |
| `DEVREV_AGENT_DON` | Yes | — | AI Agent DON identifier |
| `DEVREV_WEBHOOK_SECRET` | Yes | — | Webhook HMAC verification key |
| `JWT_SECRET` | Yes | — | JWT signing secret |
| `API_KEY_HMAC_SECRET` | Yes | — | API key hashing secret |
| `GOOGLE_CLIENT_ID` | Yes | — | Google OAuth client ID |
| `GOOGLE_SHEETS_KEY_BASE64` | Yes | — | Service account JSON (base64 encoded) |
| `ROSTER_SHEET_ID` | Yes | — | Google Sheets ID for roster |
| `SLACK_WEBHOOK_URL` | No | — | Slack webhook for NOC alerts |
| `ADMIN_EMAILS` | No | — | Comma-separated admin email list |

---

## Project Structure Quick Reference

```
backend/
├── config/
│   ├── constants.js        ← Team structure, quarters, shifts, status maps
│   ├── database.js         ← MongoDB + Redis config, cache helpers
│   └── logger.js           ← Structured logging
├── lib/
│   ├── queues.js           ← 5 BullMQ queue definitions
│   ├── workers.js          ← 5 BullMQ worker processors
│   ├── pubsub.js           ← Redis Pub/Sub → Socket.IO bridge
│   └── bullboard.js        ← Admin queue UI
├── middleware/
│   ├── auth.js             ← JWT, API keys, rate limiting
│   └── webhookVerify.js    ← HMAC signature verification
├── models/
│   └── index.js            ← All 10 Mongoose schemas
├── controllers/            ← Request handlers (one per feature)
├── services/               ← Business logic (DevRev API, sync, activity)
├── utils/
│   ├── queryBuilders.js    ← Filter → MongoDB $match
│   ├── aggregationStages.js ← Reusable $group definitions
│   ├── formatters.js       ← Response formatting
│   └── scoring.js          ← Gamification 3-stage pipeline
├── routes/                 ← Express route definitions
├── validations/            ← Zod request schemas
├── server.js               ← Express + Socket.IO + cron registration
└── worker.js               ← Standalone worker process

src/
├── App.jsx                 ← Main app (tabs, filters, CSV export)
├── store.js                ← Zustand state + Socket.IO
├── api/                    ← One file per backend feature
├── features/               ← Feature modules (tickets, analytics, agent, etc.)
├── components/common/      ← Shared UI (MultiSelectFilter, DatePicker, etc.)
└── hooks/                  ← Custom React hooks
```

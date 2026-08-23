# Ongoing Tickets View

## What It Does (User Perspective)

The **Ongoing Tickets** tab is the primary operational view. It shows all currently active support tickets owned by the GST (Global Support Team). Engineers use this as their daily working queue — it answers "what needs my attention right now?"

### KPI Cards (Above Table)

Three color-coded summary cards sit above the table:

| Card    | Threshold     | Meaning                       |
| ------- | ------------- | ----------------------------- |
| **Red** | > 15 days old | Critical: tickets aging badly |
| **Yellow** | Medium range | Needs attention soon          |
| **Green** | < threshold  | Healthy age                   |

Cards are **clickable** — clicking one filters the table to show only tickets in that priority bucket.

### Table Columns

| Column            | Data Source                          | Notes                                                    |
| ----------------- | ------------------------------------ | -------------------------------------------------------- |
| Ticket            | `display_id`, `title`, `account`     | Clickable link to DevRev                                 |
| Region            | `custom_fields.tnt__region_salesforce` | Badge (APAC, EMEA, Americas)                           |
| Cohort            | `account_cohort`                     | Enterprise/Key Commercial/Commercial/C4S, color-coded    |
| Owner             | `owned_by[0].display_name`           | Clickable → opens ProfileStatsModal                      |
| Sentiment         | `sentimentLabel`                     | Emoji: delighted/happy/neutral/frustrated/unhappy        |
| CSM               | `csm`                                | Customer Success Manager                                 |
| TAM               | `tam`                                | Technical Account Manager                                |
| Team (Dependency) | Computed from linked issues          | NOC/Whatsapp/Billing/Email/Internal/Other                |
| Assignee          | Dependency team member               | Who on the dependency team is handling it                 |
| Stage             | `stage.name`                         | Waiting on Assignee / Awaiting Customer / etc.           |
| RWT               | `custom_fields.tnt__rwt_business_hours` | Color-coded: red >24h, amber 12-24h, green <12h      |
| ITR               | `custom_fields.tnt__iteration_count` | Red >5, amber >3, gray <=3                               |
| Age               | Computed from `created_date`         | Days since creation (sticky right column)                |
| CT Reply          | Last DevRev message timestamp        | Sticky right                                             |
| Customer Reply    | Last customer message timestamp      | Sticky right                                             |
| Status            | Ticket state                         | Includes Remark button for priority-1 (red) tickets      |

### Sorting

Click any column header to toggle sort direction (asc/desc). Default sort is by **Priority**. Supported sort keys: Days, RWT, ITR, CT Updated, Customer Updated, Sentiment, Priority.

### Pagination

- 20 tickets per page
- Previous/Next navigation buttons + page indicator

---

## How It Maps to the Backend

### API Endpoint

```
GET /api/tickets
```

**Handler**: `ticketController.getActiveTickets()` in `backend/controllers/ticketController.js`

### Data Flow

```
Browser Request → GET /api/tickets
    ↓
ticketController.getActiveTickets()
    ↓
1. Try Redis: redisGetRaw("tickets:active")
   → Returns raw JSON string WITHOUT parsing (perf optimization)
    ↓
2. If cache miss → quickFetchTickets() (single page, 50 tickets, 10s timeout)
   → Also kicks off background full sync via BullMQ
    ↓
3. Response: { tickets, total, isPartial, isSyncing }
```

### Why Raw JSON?

The active tickets cache can be 20-50MB. `redisGetRaw()` returns the Redis string directly to the HTTP response **without** `JSON.parse()` → `JSON.stringify()`. This avoids ~200ms of CPU time per request with 70+ concurrent users.

### Cache Keys

| Key                    | Type   | TTL    | Purpose                              |
| ---------------------- | ------ | ------ | ------------------------------------ |
| `tickets:active`       | String | 300s   | Full ticket array (stable)           |
| `tickets:active:hash`  | Hash   | 300s   | Per-ticket O(1) lookup               |
| `tickets:syncing`      | String | 1800s  | Partial data during active sync      |
| `tickets:active:initial` | String | 1800s | Initial load marker                  |

### Dependencies Fetch (Batch)

After the main ticket list loads, the frontend calls:

```
POST /api/tickets/dependencies
Body: { ticketIds: ["don:core:...", ..."] }
```

**Handler**: `ticketController.getBatchDependencies()`

- Fetches linked issues in batches of 5 concurrent tickets
- Uses `Set`-based dedup (O(1) vs Array.includes O(n))
- Response: `{ [ticketId]: { hasDependency, issues, primary } }`
- Frontend debounces this call by 500ms and batches by 50

### Real-Time Updates

When a webhook fires (ticket created/updated/deleted):

1. Webhook → `webhookController` → enqueue BullMQ "sync-active" job (5s delay for dedup)
2. Worker runs `fetchAndCacheTickets()` → updates Redis
3. Worker publishes `DATA_UPDATED` via Redis Pub/Sub
4. API server receives → broadcasts via Socket.IO
5. Frontend Zustand store receives → calls `fetchTickets()` → UI updates (no page refresh)

---

## Reference Files

| File | Purpose |
| ---- | ------- |
| `src/features/tickets/components/TicketList.jsx` | Frontend table component |
| `src/store.js` (lines 54-95) | Zustand store, Socket.IO listeners |
| `src/api/ticketApi.js` | API client (`GET /api/tickets`, `POST /api/tickets/dependencies`) |
| `backend/controllers/ticketController.js` | `getActiveTickets()`, `getBatchDependencies()` |
| `backend/services/syncService.js` (lines 127-216) | `fetchAndCacheTickets()` |
| `backend/services/devrevApi.js` | `fetchTicketLinks()`, `fetchWorkItem()` |
| `backend/config/database.js` (lines 20-38) | `redisGetRaw()`, `redisGet()` |
| `backend/lib/pubsub.js` | Redis Pub/Sub → Socket.IO bridge |

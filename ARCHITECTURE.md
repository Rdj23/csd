# CSD (CleverTap Support Dashboard) — Architecture & Technical Documentation

## 1. Project Overview

An internal operations dashboard for the CleverTap Global Support Team (GST). Tracks support tickets from DevRev, computes team performance analytics, manages shift rosters, and gamifies productivity — all in a real-time web interface.

| Attribute | Value |
|-----------|-------|
| Total users | ~250 |
| Concurrent users | 45–50 |
| Exposure | Internal only (not public internet) |
| Primary users | Operations / Admin / Support Engineers |
| Scale classification | Moderate — optimized for clarity over throughput |

---

## 2. Tech Stack

### Backend
| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js | 20+ | Runtime |
| Express | 5.2 | HTTP framework |
| Mongoose | 9.0 | MongoDB ODM |
| Socket.IO | 4.8 | Real-time WebSocket |
| BullMQ | 5.69 | Job queue (Redis-backed) |
| ioredis | 5.9 | Redis client |
| jsonwebtoken | 9.0 | JWT auth |
| helmet | 8.1 | Security headers |
| express-rate-limit | 8.2 | Rate limiting |
| googleapis | 169.0 | Google Sheets / OAuth |
| axios | 1.13 | HTTP client (DevRev API) |
| @google/generative-ai | 0.24 | Gemini AI insights |

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19.2 | UI framework |
| Vite | latest | Build tool |
| Zustand | 5.0 | State management |
| Socket.IO Client | 4.8 | Real-time updates |
| Tailwind CSS | latest | Styling |
| Recharts | 3.6 | Charts |
| Lucide React | 0.561 | Icons |
| date-fns | 4.1 | Date utilities |
| @react-oauth/google | 0.13 | Google OAuth |

### Infrastructure
| Service | Purpose | Hosted on |
|---------|---------|-----------|
| Backend server | API + Workers | Render (512MB free tier) |
| MongoDB Atlas | Persistent storage | MongoDB Cloud |
| Redis | Cache + Job queue | Render / External |
| DevRev API | Ticket source of truth | DevRev Cloud |
| Google Sheets | Shift roster data | Google Cloud |
| Slack Webhooks | NOC alert notifications | Slack |
| Vercel | Frontend hosting | Vercel |

---

## 3. Folder Structure

```
support-dashboard/
├── backend/
│   ├── server.js                   # Main API server entry point
│   ├── worker.js                   # Standalone worker process (optional)
│   ├── create-indexes.js           # MongoDB index migration script
│   ├── package.json
│   ├── config/
│   │   ├── database.js             # MongoDB + Redis connections, cache helpers
│   │   └── constants.js            # Team groups, shift hours, Slack IDs, name maps
│   ├── middleware/
│   │   ├── auth.js                 # JWT verification, RBAC, rate limiting
│   │   └── server.js               # CORS, Helmet, compression, readiness check
│   ├── models/
│   │   └── index.js                # All Mongoose schemas (6 models)
│   ├── controllers/                # Request handlers (12 files)
│   │   ├── authController.js       # Google OAuth login
│   │   ├── ticketController.js     # Active tickets, dependencies, timeline
│   │   ├── analyticsController.js  # Pre-computed analytics
│   │   ├── gamificationController.js # Leaderboard + personal stats
│   │   ├── nocController.js        # NOC ticket queries
│   │   ├── adminController.js      # Sync, backfill, alerts, cleanup
│   │   ├── rosterController.js     # Shift status, backup, workload
│   │   ├── remarkController.js     # Internal ticket comments
│   │   ├── viewController.js       # Saved filter views
│   │   ├── webhookController.js    # DevRev webhook receiver
│   │   ├── healthController.js     # Health check + metrics
│   │   └── cacheController.js      # Cache status + clearing
│   ├── services/                   # Business logic (6 files)
│   │   ├── syncService.js          # Ticket sync from DevRev → Redis/MongoDB
│   │   ├── analyticsService.js     # Quarterly analytics pre-computation
│   │   ├── rosterService.js        # Google Sheets roster parsing
│   │   ├── timelineService.js      # Timeline reply enrichment
│   │   ├── slackService.js         # Slack webhook notifications
│   │   └── devrevApi.js            # DevRev API wrapper + retry logic
│   ├── routes/                     # Express route definitions (13 files)
│   │   ├── index.js                # Route mount orchestrator
│   │   ├── auth.js, tickets.js, analytics.js, noc.js
│   │   ├── admin.js, gamification.js, roster.js
│   │   ├── remarks.js, views.js, webhooks.js
│   │   ├── health.js, cache.js
│   └── lib/                        # Infrastructure utilities (4 files)
│       ├── queues.js               # BullMQ queue definitions (5 queues)
│       ├── workers.js              # Job processors (5 workers)
│       ├── pubsub.js               # Redis Pub/Sub (Worker → API → Socket.IO)
│       └── bullboard.js            # Bull Board admin monitoring UI
├── src/                            # Frontend (React)
│   ├── main.jsx                    # React entry point
│   ├── App.jsx                     # Main app (tabs, filters, KPI, routing)
│   ├── store.js                    # Zustand global state
│   ├── design-tokens.js            # Design system (colors, spacing, typography)
│   ├── index.css                   # Tailwind + global styles
│   ├── api/                        # API service layer
│   │   ├── index.js                # Central exports
│   │   ├── apiClient.js            # Base URL + auth exports
│   │   ├── authApi.js              # Google OAuth login
│   │   ├── ticketApi.js            # Ticket CRUD + dependencies
│   │   ├── analyticsApi.js         # Analytics data fetching
│   │   ├── gamificationApi.js      # Leaderboard + personal stats
│   │   ├── remarkApi.js            # Remarks + DevRev comments
│   │   ├── rosterApi.js            # Roster + backup lookup
│   │   └── viewApi.js              # Saved views CRUD
│   ├── components/
│   │   ├── common/
│   │   │   ├── SmartDateRangePicker.jsx
│   │   │   └── MultiSelectFilter.jsx
│   │   └── ui/
│   │       ├── SkeletonLoader.jsx
│   │       └── TicketSkeleton.jsx
│   ├── features/
│   │   ├── analytics/components/   # Analytics dashboard + sub-sections
│   │   ├── auth/components/        # Login screen
│   │   ├── gamification/components/ # Leaderboard view
│   │   ├── remarks/components/     # Remark popover + profile modal
│   │   ├── roster/components/      # Roster view
│   │   └── tickets/components/     # Ticket list, grouped list, all tickets
│   ├── hooks/                      # Custom React hooks
│   │   ├── useTheme.js, useGamification.js
│   │   ├── useRemarks.js, useProfileStats.js
│   └── utils/
│       ├── authAxios.js            # Axios interceptor (JWT + 401 logout)
│       ├── authFetch.js            # Fetch wrapper (JWT + 401 logout)
│       ├── clevertap.js            # CleverTap analytics SDK
│       └── utils.js                # Team config, SLA logic, formatters
```

---

## 4. Backend Flow: Route → Controller → Service → DB

```
Client Request
    │
    ▼
Express Middleware Stack
    ├── CORS (allowed origins)
    ├── Helmet (security headers)
    ├── Compression (gzip)
    ├── Body Parser (5MB limit)
    ├── Readiness Check (503 during startup)
    ├── Rate Limiter (1500/15min API, 10/15min auth)
    ├── JWT Verification (skip: /auth, /webhooks, /health)
    └── RBAC Admin Check (/admin/* routes only)
    │
    ▼
Route (routes/*.js)
    │  Defines HTTP method + path
    │  Maps to controller function
    ▼
Controller (controllers/*.js)
    │  Validates request params
    │  Calls service or DB directly
    │  Returns JSON response
    ▼
Service (services/*.js)
    │  Contains business logic
    │  Orchestrates API calls, DB queries, caching
    ▼
Data Layer
    ├── MongoDB (Mongoose models) — persistent storage
    ├── Redis (ioredis) — cache with TTL
    └── External APIs (DevRev, Google Sheets, Slack)
```

### Request lifecycle example: GET /api/tickets/analytics

1. Rate limiter checks IP hasn't exceeded 1500 requests/15min
2. JWT middleware extracts + verifies Bearer token, checks @clevertap.com domain
3. `analyticsRoutes` maps GET to `getAnalytics` controller
4. Controller checks Redis cache → MongoDB AnalyticsCache → triggers fresh computation
5. `analyticsService.precomputeAnalytics()` queries AnalyticsTicket collection
6. Result cached in both Redis (15min TTL) and MongoDB AnalyticsCache
7. JSON response returned with stats, trends, leaderboard, individualTrends

---

## 5. Frontend Flow: Component → API → State → UI

```
User Interaction (click, filter, tab switch)
    │
    ▼
React Component (features/*/components/*.jsx)
    │  Dispatches action or calls API
    ▼
Zustand Store Action (store.js)
    │  Calls API layer
    ▼
API Layer (api/*.js)
    │  Uses authAxios or authFetch
    │  Injects Bearer token automatically
    │  Handles 401 → auto-logout
    ▼
Backend API Response
    │
    ▼
Zustand State Update
    │
    ▼
React Re-render (only affected components)
```

### Real-time update flow (Socket.IO):

```
Worker completes job
    │
    ▼
Redis Pub/Sub: publishSocketEvent()
    │
    ▼
API Server Subscriber → Socket.IO broadcast
    │
    ▼
Frontend socket listener (store.js)
    ├── SYNC_PROGRESS → update progress bar
    ├── DATA_UPDATED → re-fetch tickets
    └── timeline_batch_updated → merge timeline data
```

---

## 6. Authentication Flow

```
1. User clicks "Sign in with Google"
    │
    ▼
2. Google OAuth returns credential (JWT)
    │
    ▼
3. Frontend POSTs to /api/auth/google
    │
    ▼
4. Backend verifies Google token via OAuth2Client
    │  Checks email ends with @clevertap.com
    │  Signs custom JWT (30-day expiry)
    ▼
5. Frontend stores JWT + user info in Zustand (persisted to localStorage)
    │
    ▼
6. All subsequent requests include: Authorization: Bearer <jwt>
    │
    ▼
7. verifyToken middleware validates JWT on every /api/* request
    │  Skips: /auth/*, /webhooks/*, /health
    │
    ▼
8. On 401 response → frontend auto-logout (authAxios interceptor)
```

---

## 7. Role Handling

| Role | Detection | Access |
|------|-----------|--------|
| **Regular user** | Any @clevertap.com email | All dashboard features, personal stats |
| **Admin** | Email in ADMIN_EMAILS array (`rohan.jadhav@clevertap.com`) | All features + admin panel, sync controls, backfill, Slack alerts, Bull Board |
| **Super Admin** | Email in SUPER_ADMIN_EMAILS (frontend config) | Full analytics drill-down, advanced insights |
| **CSM/TAM** | Auto-detected from ticket data (email match) | Auto-filtered view showing only their accounts |

Admin routes (`/api/admin/*`) are protected by `requireAdmin` middleware that checks `req.user.email` against ADMIN_EMAILS.

---

## 8. API Responsibility Table

| Module | Endpoint | Method | Purpose | Auth | Admin |
|--------|----------|--------|---------|------|-------|
| **Auth** | `/api/auth/google` | POST | Google OAuth login | No | No |
| **Auth** | `/api/auth/config` | GET | Google Client ID | No | No |
| **Tickets** | `/api/tickets` | GET | Active tickets (Redis cache) | Yes | No |
| **Tickets** | `/api/tickets/live-stats` | GET | Real-time ticket stats | Yes | No |
| **Tickets** | `/api/tickets/drilldown` | GET | Ticket detail breakdown | Yes | No |
| **Tickets** | `/api/tickets/by-range` | GET | Tickets in date range | Yes | No |
| **Tickets** | `/api/tickets/by-date` | GET | Tickets by date/week/month | Yes | No |
| **Tickets** | `/api/tickets/links` | POST | Linked issues lookup | Yes | No |
| **Tickets** | `/api/tickets/dependencies` | POST | Batch dependency fetch | Yes | No |
| **Tickets** | `/api/tickets/timeline-replies` | POST | Batch timeline replies | Yes | No |
| **Tickets** | `/api/tickets/sync` | POST | Trigger manual sync | Yes | No |
| **Tickets** | `/api/issues/get` | POST | Issue details from DevRev | Yes | No |
| **Analytics** | `/api/tickets/analytics` | GET | Pre-computed analytics | Yes | No |
| **NOC** | `/api/tickets/noc` | GET | NOC ticket data | Yes | No |
| **Gamification** | `/api/gamification` | GET | Full leaderboard (admin) | Yes | No |
| **Gamification** | `/api/gamification/my-stats` | GET | Personal stats (secure) | Yes | No |
| **Roster** | `/api/profile/status` | POST | User shift status | Yes | No |
| **Roster** | `/api/roster/backup` | GET | Find backup for user | Yes | No |
| **Roster** | `/api/roster/workload` | GET | Team workload | Yes | No |
| **Roster** | `/api/roster/full` | GET | Full roster data | Yes | No |
| **Roster** | `/api/roster/sync` | POST | Sync roster from Sheets | Yes | No |
| **Remarks** | `/api/remarks/:ticketId` | GET | Ticket remarks history | Yes | No |
| **Remarks** | `/api/remarks` | POST | Create internal remark | Yes | No |
| **Remarks** | `/api/comments` | POST | Post comment to DevRev | Yes | No |
| **Views** | `/api/views/:userId` | GET | Saved views for user | Yes | No |
| **Views** | `/api/views` | POST | Create saved view | Yes | No |
| **Views** | `/api/views/:userId/:viewId` | DELETE | Delete saved view | Yes | No |
| **Webhooks** | `/api/webhooks/devrev` | POST | DevRev event receiver | No | No |
| **Health** | `/api/health` | GET | System health check | No | No |
| **Cache** | `/api/cache/status` | GET | Redis cache info | Yes | No |
| **Cache** | `/api/cache/clear` | POST | Clear all cache | Yes | No |
| **Admin** | `/api/admin/sync-now` | POST | Force ticket sync | Yes | Yes |
| **Admin** | `/api/admin/sync-status` | GET | Data staleness info | Yes | Yes |
| **Admin** | `/api/admin/backfill` | POST | Full historical backfill | Yes | Yes |
| **Admin** | `/api/admin/job-status/:jobId` | GET | BullMQ job status | Yes | Yes |
| **Admin** | `/api/admin/verify-gst-names` | GET | Verify GST member names | Yes | Yes |
| **Admin** | `/api/admin/pending-alerts` | GET | Pending Slack alerts | Yes | Yes |
| **Admin** | `/api/admin/send-pending-alerts` | POST | Send pending alerts | Yes | Yes |
| **Admin** | `/api/admin/test-slack` | POST | Test Slack webhook | Yes | Yes |
| **Admin** | `/api/admin/sync-ticket` | POST | Sync single ticket | Yes | Yes |
| **Admin** | `/api/admin/cleanup-old-tickets` | POST | Delete old tickets | Yes | Yes |
| **Admin** | `/api/admin/queues` | GET | Bull Board UI | Yes | Yes |

---

## 9. Database Models Overview

### AnalyticsTicket (Primary data model)
Stores every solved/closed ticket with computed metrics.

| Field | Type | Indexed | Purpose |
|-------|------|---------|---------|
| ticket_id | String | unique | DevRev ticket ID |
| display_id | String | — | Human-readable ID (TKT-1234) |
| title | String | — | Ticket title |
| created_date | Date | compound | Ticket creation date |
| closed_date | Date | compound | Resolution date |
| owner | String | compound | Assigned engineer |
| team | String | — | Team name |
| region | String | compound | Customer region |
| priority | String | — | Ticket priority |
| is_zendesk | Boolean | yes | Zendesk migration flag |
| rwt | Number | — | Resolution Wait Time (hours) |
| frt | Number | — | First Response Time (hours) |
| iterations | Number | — | Back-and-forth count |
| csat | Number | — | Customer satisfaction (0/1) |
| frr | Number | — | First Response Resolution (0/1) |
| account_name | String | yes | Customer account |
| is_noc | Boolean | yes | NOC incident flag |
| noc_issue_id | String | — | Linked NOC issue |
| noc_jira_key | String | — | Linked Jira key |
| stage_name | String | compound | Current stage |
| actual_close_date | Date | compound | Actual close timestamp |
| slack_alerted_at | Date | — | When Slack alert was sent |

**Compound indexes:** `{closed_date, owner}`, `{closed_date, is_noc}`, `{closed_date, is_zendesk}`, `{owner, closed_date, region}`, `{stage_name, actual_close_date}`, `{created_date, stage_name}`

### AnalyticsCache
Fallback cache for analytics when Redis is down.

| Field | Type | Purpose |
|-------|------|---------|
| cache_key | String (unique) | Cache identifier |
| computed_at | Date | Computation timestamp |
| stats | Object | Aggregated statistics |
| trends | Array | Daily trend data |
| leaderboard | Array | Engineer rankings |
| badTickets | Array | Low-performing tickets |
| individualTrends | Object | Per-engineer daily trends |

### PrecomputedDashboard
Pre-computed dashboard snapshots for instant page loads.

| Field | Type | Purpose |
|-------|------|---------|
| cache_type | String (unique) | Dashboard type identifier |
| computed_at | Date | Last computation time |
| data | Object | Complete dashboard data |
| computing | Boolean | Lock flag to prevent concurrent computation |

### Remark
Internal team notes on tickets.

| Field | Type | Purpose |
|-------|------|---------|
| ticketId | String | Associated ticket ID |
| user | String | Author name |
| text | String | Comment text |
| timestamp | Date | Created at |

### View
User-saved filter configurations.

| Field | Type | Purpose |
|-------|------|---------|
| userId | String | Owner email |
| name | String | View name |
| filters | Object | Filter state snapshot |
| createdAt | Date | Created at |

### SyncMetadata
Tracks sync state and configuration.

| Field | Type | Purpose |
|-------|------|---------|
| key | String (unique) | Metadata key |
| value | Mixed | Metadata value |
| updated_at | Date | Last updated |

---

## 10. Caching Strategy

### Three-Tier Cache

```
Request → Redis (fastest, TTL-based)
    │ miss
    ▼
MongoDB Cache (AnalyticsCache / PrecomputedDashboard)
    │ miss
    ▼
Fresh Computation (DevRev API / MongoDB aggregation)
    │
    ▼
Write back to Redis + MongoDB Cache
```

### Cache TTLs

| Cache Key | TTL | Purpose |
|-----------|-----|---------|
| `tickets:active` | 5 min | Active ticket list |
| `analytics:*` | 15 min | Dashboard analytics |
| `leaderboard:*` | 30 min | Gamification rankings |
| `drilldown:*` | 5 min | Ticket detail views |
| `timeline:*` | 30 min | Timeline reply data |
| `roster:*` | Until next sync | Shift schedule |

---

## 11. Background Job System (BullMQ)

| Queue | Job Types | Schedule | Concurrency | Retries |
|-------|-----------|----------|-------------|---------|
| `ticket-sync` | sync-active | Webhook / Manual | 1 | 3 |
| `historical-sync` | delta-sync | Daily 4:00 UTC | 1 | 4 |
| `analytics` | precompute | Daily 4:30 UTC | 1 | 4 |
| `timeline` | enrich-all, fetch-missing | After ticket sync | 1 | 2 |
| `roster` | sync-roster | On startup / Manual | 1 | 3 |

### Process Architecture

```
NODE_ROLE=hybrid (default):
    ┌─────────────────────────────────┐
    │      Single Node.js Process      │
    │                                   │
    │  API Server (Express + Socket.IO) │
    │  + BullMQ Workers (5 workers)     │
    │  + Redis Pub/Sub                  │
    └─────────────────────────────────┘

NODE_ROLE=api + NODE_ROLE=worker (scalable):
    ┌──────────────────┐   ┌──────────────────┐
    │   API Process     │   │  Worker Process   │
    │  Express          │   │  BullMQ Workers   │
    │  Socket.IO        │◄──│  Redis Pub/Sub    │
    │  Subscriber       │   │  Publisher         │
    └──────────────────┘   └──────────────────┘
```

---

## 12. Deployment Setup

### Current (Single-Process Hybrid)

```
Render Web Service (512MB RAM)
    │
    ├── Express API (port 5000)
    ├── Socket.IO (same port)
    ├── BullMQ Workers (5 workers)
    └── Bull Board UI (/api/admin/queues)
```

**Environment Variables:**

| Variable | Required | Purpose |
|----------|----------|---------|
| `MONGO_URI` | Yes | MongoDB Atlas connection string |
| `REDIS_URL` | Yes* | Redis connection URL (*graceful degradation without) |
| `JWT_SECRET` | Yes | JWT signing secret |
| `DEVREV_PAT` | Yes | DevRev API token |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_SHEETS_KEY_BASE64` | Yes | Base64-encoded Google service account key |
| `SPREADSHEET_ID` | Yes | Google Sheets roster ID |
| `SLACK_WEBHOOK_URL` | No | Slack notification webhook |
| `PORT` | No | Server port (default: 5000) |
| `NODE_ROLE` | No | Process role: hybrid/api/worker |

---

## 13. Scaling Strategy for 2x User Growth (500 users, 100 concurrent)

### What works as-is (no changes needed)
- MongoDB Atlas scales automatically
- Redis cache handles 100 concurrent users easily
- JWT auth is stateless — no session bottleneck
- Pre-computed analytics avoid N+1 query patterns
- BullMQ job queue prevents concurrent sync overload

### Recommended changes for 2x scale

| Change | Effort | Impact |
|--------|--------|--------|
| Split API + Worker into 2 Render services | Low | Prevents worker memory spikes from affecting API |
| Upgrade Render to 1GB RAM | Low | Eliminates OOM risk during peak sync |
| Add Redis connection pooling | Low | Better concurrent request handling |
| Enable Socket.IO sticky sessions (if multiple API instances) | Medium | Required for horizontal API scaling |
| Move cron jobs to external scheduler (e.g., Render Cron) | Low | More reliable than in-process cron |

### NOT needed for 2x scale
- Microservices architecture
- Message bus (Kafka/RabbitMQ)
- Database sharding
- CDN for API responses
- Kubernetes / container orchestration

---

## 14. Known Limitations

1. **Memory ceiling**: 512MB free tier limits concurrent background jobs
2. **Single admin**: Only one email in ADMIN_EMAILS — no admin panel to manage this
3. **Hardcoded team config**: Team groups, shifts, Slack IDs are in constants.js — requires redeployment to update
4. **No input validation**: Controllers trust request parameters without Joi/Zod validation
5. **Webhook has no signature verification**: DevRev webhook endpoint accepts any POST
6. **Quarter dates hardcoded**: Week/month breakdowns in constants.js must be manually updated each quarter
7. **Roster depends on Google Sheets format**: Fragile parsing — format changes break sync
8. **No automated tests**: Zero test coverage
9. **Frontend has backend dependencies in package.json**: mongoose, multer, dotenv, googleapis in frontend package.json (likely copy-paste — unused at runtime)

---

## 15. Suggested Future Improvements

### High Priority
- Add input validation (Joi/Zod) on all API endpoints
- Add webhook signature verification for DevRev
- Remove backend-only packages from frontend package.json
- Add basic integration tests for critical endpoints
- Move hardcoded team config to a database collection (admin-editable)

### Medium Priority
- Implement proper structured logging (pino/winston) instead of console.log
- Add API response envelope pattern (`{ success, data, error, meta }`)
- Split AnalyticsDashboard.jsx (~3770 lines) into smaller components
- Add MongoDB connection retry with exponential backoff
- Implement proper error boundary components in frontend

### Low Priority
- Add OpenTelemetry tracing for request debugging
- Implement feature flags for gradual rollouts
- Add CSV import for roster (reduce Google Sheets dependency)
- Build admin UI for team/member management
- Add Playwright E2E tests for critical workflows

---

## 16. Data Flow Diagrams

### Ticket Sync (DevRev → Dashboard)

```
DevRev API (source of truth)
    │
    ├── [Webhook trigger / Manual sync / Cron]
    │   BullMQ: ticket-sync queue
    │   │
    │   ▼
    │   syncService.fetchAndCacheTickets()
    │   ├── Paginated fetch from DevRev (cursor-based)
    │   ├── Filter by stage/owner
    │   ├── Write to Redis (tickets:active, TTL 5min)
    │   └── Publish SYNC_PROGRESS via Pub/Sub
    │       │
    │       ▼
    │       Socket.IO → Frontend progress bar
    │
    ├── [Daily 4:00 UTC]
    │   BullMQ: historical-sync queue
    │   │
    │   ▼
    │   syncService.syncHistoricalToDB()
    │   ├── Fetch solved tickets from DevRev
    │   ├── Upsert to MongoDB (AnalyticsTicket)
    │   ├── Detect NOC tickets → link Jira issues
    │   └── "Understanding Gap - CS" → Slack alert
```

### Analytics Pipeline

```
MongoDB (AnalyticsTicket collection)
    │
    ├── [Daily 4:30 UTC / Manual trigger]
    │   BullMQ: analytics queue
    │   │
    │   ▼
    │   analyticsService.precomputeAnalytics()
    │   ├── Query all tickets in quarter range
    │   ├── Compute: avg RWT, FRT, CSAT%, FRR%, iterations
    │   ├── Build: daily trends, leaderboard, individual trends
    │   └── Store in PrecomputedDashboard (MongoDB)
    │
    ├── [API Request: GET /api/tickets/analytics]
    │   analyticsController.getAnalytics()
    │   ├── Check Redis cache → return if fresh
    │   ├── Check MongoDB AnalyticsCache → return if fresh
    │   └── Trigger fresh precompute if stale
    │
    ▼
    Frontend: AnalyticsDashboard.jsx
    ├── Renders cards, charts, leaderboard from pre-aggregated data
    └── Client-side filtering (no re-aggregation)
```

---

*Last updated: February 2026*
*Generated as part of comprehensive technical review*

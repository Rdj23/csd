User Opens Tab
  ↓
React calls fetchTickets()
  ↓
GET /api/tickets → Redis Cache (5ms response)
  ↓
If cache miss → DevRev API (5-10 seconds)
  ↓
Filter: Active + Solved (Oct 2025+) - Exclude Anmol Sawhney
  ↓
Store in Redis (5min TTL)
  ↓
Emit WebSocket: DATA_UPDATED (200 bytes signal)
  ↓
All clients fetch fresh data from Redis
  ↓
Display grouped by state (Open, Pending, On-Hold, Solved)


Analytics Section (AnalyticsDashboard.jsx)
How it works:

User Opens Analytics Tab
  ↓
React calls fetchAnalyticsData(filters)
  ↓
GET /api/tickets/analytics?quarter=Q1_26
  ↓
Check 3-tier cache:
  1. Redis (10ms) ✅
  2. MongoDB AnalyticsCache collection (50ms)
  3. Compute from AnalyticsTicket collection (200ms)
  ↓
If computing: Query MongoDB with indexes
  ↓
Aggregate metrics:
  - Total tickets, Avg RWT, FRT, CSAT, FRR
  - Group by date (daily/weekly/monthly)
  - Compute leaderboard (top performers)
  - Find bad tickets (low CSAT, high iterations)
  ↓
Cache in Redis (30min) & MongoDB (permanent)
  ↓
Display: Performance cards, trend charts, leaderboard


Gamification System (GamificationView.jsx)
How it works:

User Opens Gamification Tab
  ↓
React calls fetchData()
  ↓
GET /api/gamification?quarter=Q1_26
  ↓
Check Redis cache (1 hour TTL)
  ↓
If miss: Compute from MongoDB
  ↓
For each engineer:
  1. Count tickets solved
  2. Calculate Avg RWT, FRT, Iterations
  3. Calculate CSAT score (Good - Bad)
  4. Calculate FRR percentage
  5. Compute points (weighted score)
  ↓
Sort by points → Assign ranks (1, 2, 3, ...)
  ↓
Separate into tiers (L1, L2, L3)
  ↓
Display: Leaderboard with trophy badges
  ↓
If user is GST (not admin): Show only their card (privacy)



Views System (Store + MongoDB)
How it works:

User Applies Filters
  ↓
User clicks "Save View"
  ↓
POST /api/views
Body: { userId, name, filters }
  ↓
MongoDB: Create View document
  ↓
Store locally in Zustand: myViews = [newView, ...]
  ↓
Later: User clicks saved view
  ↓
Apply filters from view.filters
  ↓
Ongoing Tickets updates with filtered results

Why it's useful: Users can save complex filter combinations and reload them instantly




🔴 Why Redis?
Problem Without Redis:
Every request queries MongoDB (50-100ms)
100 users = 100 MongoDB queries/second = Database overload
High latency, server crashes
Solution With Redis:
First request: MongoDB (50ms) → Cache in Redis
Next 100 requests: Redis only (5ms each) → 10x faster
MongoDB load reduced by 99%
Supports 1000+ concurrent users
TTL Strategy:
Active tickets: 5 minutes (updates frequently)
Analytics: 30 minutes (historical data)
Gamification: 1 hour (daily/weekly aggregates)


🌐 Why WebSocket?
Problem Without WebSocket (Polling):
Client polls every 10 seconds: GET /api/tickets
100 users × 6 requests/min = 600 requests/min
95% are redundant (no data changed)
High server load, wasted bandwidth
Solution With WebSocket:
Server syncs tickets every 5 minutes
Server emits 1 signal (200 bytes) to all clients
Clients fetch only when signaled (from Redis cache)
99.9% less bandwidth, instant updates
Signal Format:

io.emit("DATA_UPDATED", {
  type: 'tickets',
  count: 150,
  timestamp: "2026-01-24T10:30:00Z"
});



🚀 Quick Reference Cheat Sheet
Key Endpoints:

# Ongoing Tickets
GET /api/tickets → Active tickets (Redis cache, 5ms)

# Analytics
GET /api/tickets/analytics?quarter=Q1_26 → Aggregated stats (10-50ms)
GET /api/tickets/by-date?date=2026-01-15 → Tickets for specific date
GET /api/tickets/by-range?start=...&end=... → Date range query

# Gamification
GET /api/gamification?quarter=Q1_26 → Leaderboard data

# Views
GET /api/views/:userId → User's saved views
POST /api/views → Create new view
DELETE /api/views/:userId/:viewId → Delete view

# Admin
POST /api/tickets/sync → Force sync from DevRev
POST /api/cache/clear → Clear all caches
GET /api/cache/status → Check Redis/memory status

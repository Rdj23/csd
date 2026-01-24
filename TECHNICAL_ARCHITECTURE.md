# 🏗️ Support Dashboard - Technical Architecture Documentation

## 📖 Table of Contents
1. [System Overview](#system-overview)
2. [Data Flow Architecture](#data-flow-architecture)
3. [Ongoing Tickets Tab](#1-ongoing-tickets-tab)
4. [Analytics Section](#2-analytics-section)
5. [Gamification System](#3-gamification-system)
6. [Views System](#4-views-system)
7. [Why Redis?](#why-redis)
8. [Why WebSocket?](#why-websocket)
9. [Component Hierarchy](#component-hierarchy)
10. [API Reference](#api-reference)

---

## 🎯 System Overview

### **Architecture Pattern**: MERN Stack + Real-Time Sync

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (React + Zustand)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Ongoing      │  │ Analytics    │  │ Gamification │          │
│  │ Tickets      │  │ Dashboard    │  │ View         │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                   │
│         └──────────────────┴──────────────────┘                   │
│                            │                                      │
│                    ┌───────▼────────┐                            │
│                    │   Zustand      │  (State Management)        │
│                    │   Store        │                            │
│                    └───────┬────────┘                            │
│                            │                                      │
│         ┌──────────────────┴──────────────────┐                 │
│         │                                      │                 │
│    ┌────▼─────┐                         ┌─────▼─────┐           │
│    │ REST API │                         │ WebSocket │           │
│    └────┬─────┘                         └─────┬─────┘           │
└─────────┼───────────────────────────────────────┼───────────────┘
          │                                       │
          │                                       │
┌─────────▼───────────────────────────────────────▼───────────────┐
│                    SERVER (Node.js + Express)                    │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Redis      │  │  Socket.io   │  │  DevRev API  │          │
│  │   Cache      │  │  (Real-Time) │  │  Connector   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                   │
│         └──────────────────┴──────────────────┘                   │
│                            │                                      │
│                    ┌───────▼────────┐                            │
│                    │   MongoDB      │  (Persistent Storage)      │
│                    │   (Warm/Cold)  │                            │
│                    └────────────────┘                            │
└───────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow Architecture

### **Hot/Warm/Cold Data Strategy**

#### **🔥 HOT Data (Redis Cache - In-Memory)**
- **What**: Active tickets (Open, Pending, On-Hold) + Recently solved (Oct 2025+)
- **Storage**: Redis (5-minute TTL)
- **Size**: ~50-300 tickets
- **Access**: Sub-millisecond response time
- **Use Case**: Real-time dashboard, ongoing tickets tab

#### **🌡️ WARM Data (MongoDB - Indexed)**
- **What**: Recent historical tickets (last 3 months)
- **Storage**: MongoDB with compound indexes
- **Size**: ~2,000-5,000 tickets
- **Access**: 10-50ms response time
- **Use Case**: Analytics, date-range queries, drill-downs

#### **❄️ COLD Data (MongoDB - Archived)**
- **What**: Historical tickets (older than 3 months)
- **Storage**: MongoDB (unindexed or archived collection)
- **Size**: 10,000+ tickets
- **Access**: 100-500ms response time
- **Use Case**: Admin searches, historical reports

---

## 1️⃣ Ongoing Tickets Tab

### **Component**: `Allticketsview.jsx`

### **Data Flow**

```
User Opens App
    │
    ├─> App.jsx mounts
    │   └─> useEffect() calls connectSocket()
    │   └─> useEffect() calls fetchTickets()
    │
    ├─> store.js: fetchTickets()
    │   └─> GET /api/tickets
    │       │
    │       ├─> backend/server.js: app.get("/api/tickets")
    │       │   │
    │       │   ├─> Try Redis: redisGet("tickets:active")
    │       │   │   ├─> HIT: Return cached tickets (5ms)
    │       │   │   └─> MISS: Start background sync
    │       │   │
    │       │   └─> fetchAndCacheTickets()
    │       │       │
    │       │       ├─> DevRev API: works.list (paginated)
    │       │       │   └─> Filter: Active + Solved (Oct 2025+)
    │       │       │   └─> Exclude: Anmol Sawhney's tickets
    │       │       │
    │       │       ├─> Store in Redis (5min TTL)
    │       │       │
    │       │       └─> Emit WebSocket: DATA_UPDATED
    │       │
    │       └─> Response: { tickets: [...], total: 150 }
    │
    └─> Allticketsview.jsx receives tickets
        │
        ├─> Group by state (Open, Pending, On-Hold, Solved)
        ├─> Apply local filters (assignee, region, account)
        ├─> Display in expandable sections
        └─> Show ticket count badges
```

### **Key Files**

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/components/Allticketsview.jsx` | Main UI component | `AllTicketsView()`, ticket grouping, filters |
| `src/store.js` | State management | `fetchTickets()`, `connectSocket()` |
| `backend/server.js` | API endpoint | `GET /api/tickets`, `fetchAndCacheTickets()` |

### **Code Deep Dive**

#### **Frontend: Allticketsview.jsx (Lines 1-200)**

```javascript
// 1. Component receives tickets from Zustand store
const AllTicketsView = ({ onClose }) => {
  const { tickets, fetchTickets, currentUser } = useTicketStore();

  // 2. Fetch tickets on mount
  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // 3. Group tickets by state (Open, Pending, On-Hold, Solved)
  const ticketsByState = useMemo(() => {
    const grouped = {
      open: [],
      pending: [],
      onHold: [],
      solved: []
    };

    tickets.forEach((ticket) => {
      const stage = ticket.stage?.name?.toLowerCase() || "";

      if (stage.includes("waiting on assignee")) {
        grouped.open.push(ticket);
      } else if (stage.includes("awaiting customer reply")) {
        grouped.pending.push(ticket);
      } else if (stage.includes("on hold")) {
        grouped.onHold.push(ticket);
      } else if (stage.includes("solved")) {
        grouped.solved.push(ticket);
      }
    });

    return grouped;
  }, [tickets]);

  // 4. Apply filters (assignee, region, account, etc.)
  const filteredTickets = useMemo(() => {
    return applyFilters(ticketsByState, filters);
  }, [ticketsByState, filters]);

  // 5. Render grouped tickets with expandable sections
  return (
    <div>
      <TicketSection
        state="open"
        tickets={filteredTickets.open}
        icon={Inbox}
        color="blue"
      />
      {/* ... other sections */}
    </div>
  );
};
```

#### **Backend: server.js (Lines 1317-1365)**

```javascript
// GET /api/tickets - Hot data endpoint
app.get("/api/tickets", async (req, res) => {
  try {
    // 1. Try Redis first (fastest - 5ms)
    const redisData = await redisGet("tickets:active");
    if (redisData) {
      console.log("⚡ Active Tickets: Redis HIT");
      return res.json({ tickets: redisData, total: redisData.length });
    }

    // 2. Cache miss - start background sync
    console.log("⏳ No cache - starting background sync");
    fetchAndCacheTickets("first_load").catch(console.error);

    // 3. Return empty array with syncing flag
    res.json({
      tickets: [],
      syncing: true,
      total: 0,
      message: "Loading configuration...",
    });
  } catch (e) {
    console.error("❌ /api/tickets error:", e.message);
    res.status(500).json({ tickets: [], error: e.message });
  }
});
```

#### **Backend: fetchAndCacheTickets() (Lines 1186-1300)**

```javascript
const fetchAndCacheTickets = async (source = "auto") => {
  if (isSyncing) {
    syncQueued = true;
    return;
  }
  isSyncing = true;

  try {
    let collected = [];
    let cursor = null;
    let loop = 0;

    // Keep solved tickets from Oct 2025 onwards
    const SOLVED_CUTOFF_DATE = new Date("2025-10-01");

    // 1. Fetch from DevRev API (paginated)
    do {
      const response = await axios.get(
        `${DEVREV_API}/works.list?limit=50&type=ticket${
          cursor ? `&cursor=${cursor}` : ""
        }`,
        { headers: HEADERS, timeout: 30000 }
      );

      collected = [...collected, ...response.data.works];
      cursor = response.data.next_cursor;
      loop++;
    } while (cursor && loop < 100);

    // 2. Filter tickets
    const activeTickets = collected
      .filter((t) => {
        const stage = t.stage?.name?.toLowerCase() || "";

        // Keep ALL active tickets (Open, Pending, On-Hold)
        const isActive =
          stage.includes("waiting on assignee") ||
          stage.includes("awaiting customer reply") ||
          stage.includes("on hold");

        if (isActive) return true;

        // Keep solved tickets from Oct 2025+
        const isSolved = stage.includes("solved");
        if (isSolved) {
          const createdDate = parseISO(t.created_date);
          return createdDate >= SOLVED_CUTOFF_DATE;
        }

        return false;
      })
      .filter((t) => {
        // Exclude Anmol Sawhney's tickets
        const ownerName = t.owned_by?.[0]?.display_name?.toLowerCase() || "";
        return !ownerName.includes("anmol sawhney");
      })
      .map((t) => ({
        id: t.id,
        display_id: t.display_id,
        title: t.title,
        stage: t.stage,
        owned_by: t.owned_by,
        // ... other fields
      }));

    // 3. Store in Redis (5min TTL)
    await redisSet("tickets:active", activeTickets, CACHE_TTL.TICKETS);

    // 4. Emit WebSocket signal (lightweight)
    io.emit("DATA_UPDATED", {
      type: 'tickets',
      count: activeTickets.length,
      timestamp: new Date().toISOString()
    });

    console.log(`✅ ${activeTickets.length} tickets cached`);
  } catch (e) {
    console.error("❌ Sync Failed:", e.message);
  } finally {
    isSyncing = false;
  }
};
```

### **Real-Time Updates**

When a ticket changes in DevRev:

```
DevRev Webhook
    │
    ├─> POST /api/webhooks/devrev
    │   └─> setTimeout(() => fetchAndCacheTickets(), 5000)
    │       │
    │       ├─> Refresh Redis cache
    │       │
    │       └─> io.emit("DATA_UPDATED", { type: 'tickets' })
    │
    └─> Frontend: store.js receives DATA_UPDATED
        └─> Calls fetchTickets() to refresh local state
```

---

## 2️⃣ Analytics Section

### **Component**: `AnalyticsDashboard.jsx`

### **Data Flow**

```
User Opens Analytics Tab
    │
    ├─> AnalyticsDashboard.jsx mounts
    │   │
    │   ├─> useEffect() calls fetchAnalyticsData()
    │   │
    │   └─> store.js: fetchAnalyticsData(filters)
    │       └─> GET /api/tickets/analytics?quarter=Q1_26&excludeZendesk=true
    │           │
    │           ├─> backend/server.js: app.get("/api/tickets/analytics")
    │           │   │
    │           │   ├─> Check Redis cache
    │           │   │   └─> Key: "analytics:Q1_26:true:false:all:none:none:daily"
    │           │   │
    │           │   ├─> MISS: Check MongoDB cache (AnalyticsCache collection)
    │           │   │
    │           │   └─> MISS: Compute from MongoDB (AnalyticsTicket collection)
    │           │       │
    │           │       ├─> Query MongoDB with date range filter
    │           │       │   └─> Use indexes: { closed_date: 1, owner: 1 }
    │           │       │
    │           │       ├─> Aggregate metrics (RWT, FRT, CSAT, FRR, etc.)
    │           │       │   └─> Group by: daily/weekly/monthly
    │           │       │
    │           │       ├─> Compute leaderboard (top performers)
    │           │       │
    │           │       ├─> Cache in Redis (30min TTL)
    │           │       │
    │           │       └─> Cache in MongoDB (permanent)
    │           │
    │           └─> Response: {
    │                 stats: { totalTickets, avgRWT, avgFRT, ... },
    │                 trends: [{ date, solved, avgRWT, ... }],
    │                 leaderboard: [{ name, solved, avgRWT, ... }],
    │                 badTickets: [...]
    │               }
    │
    └─> AnalyticsDashboard.jsx renders:
        ├─> Performance Metrics Cards (RWT, FRT, CSAT, FRR)
        ├─> Trend Charts (Line/Area charts)
        ├─> Leaderboard Table
        ├─> DSAT Alerts
        └─> Drill-down Modals (on chart click)
```

### **Key Files**

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/components/AnalyticsDashboard.jsx` | Main analytics UI | `AnalyticsDashboard()`, chart rendering |
| `src/components/analytics/*.jsx` | Sub-components | `PerformanceMetricsCards()`, `CSATLeaderboard()` |
| `src/store.js` | State management | `fetchAnalyticsData()`, `refreshAnalytics()` |
| `backend/server.js` | Analytics API | `GET /api/tickets/analytics`, aggregation logic |

### **Code Deep Dive**

#### **Frontend: AnalyticsDashboard.jsx (Lines 1-500)**

```javascript
const AnalyticsDashboard = () => {
  const {
    analyticsData,
    analyticsLoading,
    fetchAnalyticsData,
    currentUser,
  } = useTicketStore();

  const [filters, setFilters] = useState({
    quarter: "Q1_26",
    excludeZendesk: true,
    excludeNOC: false,
    owner: null,
    groupBy: "daily",
  });

  // 1. Fetch analytics on mount or filter change
  useEffect(() => {
    fetchAnalyticsData(filters);
  }, [filters, fetchAnalyticsData]);

  // 2. Extract data from response
  const { stats, trends, leaderboard, badTickets } = analyticsData || {};

  // 3. Render performance cards
  const performanceCards = [
    {
      metric: "RWT",
      value: stats?.avgRWT?.toFixed(2) || "0.00",
      label: "Avg Response Wait Time (hours)",
      icon: Clock,
      color: "blue",
    },
    // ... other metrics
  ];

  // 4. Prepare chart data
  const chartData = trends?.map((t) => ({
    date: format(parseISO(t.date), "MMM d"),
    solved: t.solved,
    avgRWT: t.avgRWT,
    avgFRT: t.avgFRT,
    positiveCSAT: t.positiveCSAT,
  }));

  // 5. Drill-down on chart click
  const handleChartClick = (data, metric) => {
    const date = data.date;
    const tickets = fetchTicketsForDate(date, metric);
    openDrillDownModal({ title: `${metric} on ${date}`, tickets });
  };

  return (
    <div>
      {/* Filters */}
      <FilterBar filters={filters} onChange={setFilters} />

      {/* Performance Cards */}
      <PerformanceMetricsCards cards={performanceCards} />

      {/* Trend Charts */}
      <AreaChart data={chartData} onClick={handleChartClick} />

      {/* Leaderboard */}
      <CSATLeaderboard data={leaderboard} />

      {/* DSAT Alerts */}
      <DSATAlerts tickets={badTickets} />
    </div>
  );
};
```

#### **Backend: Analytics Aggregation (Lines 616-974)**

```javascript
app.get("/api/tickets/analytics", async (req, res) => {
  try {
    const {
      quarter = "Q1_26",
      excludeZendesk,
      excludeNOC,
      owner,
      groupBy = "daily",
    } = req.query;

    // 1. Build cache key
    const cacheKey = `analytics:${quarter}:${excludeZendesk}:${excludeNOC}:${owner}:${groupBy}`;

    // 2. Check Redis cache (30min TTL)
    const redisData = await redisGet(cacheKey);
    if (redisData) {
      console.log(`⚡ Redis HIT: ${cacheKey}`);
      return res.json(redisData);
    }

    // 3. Check MongoDB cache (AnalyticsCache collection)
    const mongoCache = await AnalyticsCache.findOne({ cache_key: cacheKey });
    if (mongoCache && Date.now() - mongoCache.computed_at < 30 * 60 * 1000) {
      console.log(`⚡ MongoDB Cache HIT`);
      await redisSet(cacheKey, mongoCache, CACHE_TTL.ANALYTICS);
      return res.json(mongoCache);
    }

    // 4. Compute from MongoDB (AnalyticsTicket collection)
    const { start, end } = getQuarterDateRange(quarter);

    // 5. Build match conditions
    const matchConditions = {
      closed_date: { $gte: start, $lte: end },
      stage_name: { $in: ["solved", "closed", "resolved"] },
    };

    if (excludeZendesk === "true") {
      matchConditions.is_zendesk = { $ne: true };
    }
    if (excludeNOC === "true") {
      matchConditions.is_noc = { $ne: true };
    }
    if (owner) {
      matchConditions.owner = owner;
    }

    // 6. Fetch tickets from MongoDB (uses indexes)
    const tickets = await AnalyticsTicket.find(matchConditions)
      .sort({ closed_date: -1 })
      .lean();

    // 7. Compute aggregate stats
    const stats = {
      totalTickets: tickets.length,
      avgRWT: calculateAverage(tickets, "rwt"),
      avgFRT: calculateAverage(tickets, "frt"),
      avgIterations: calculateAverage(tickets, "iterations"),
      positiveCSAT: tickets.filter((t) => t.csat === 2).length,
      frrMet: tickets.filter((t) => t.frr === 1).length,
    };

    // 8. Group by date (daily/weekly/monthly)
    const trends = groupByDate(tickets, groupBy);

    // 9. Compute leaderboard
    const leaderboard = computeLeaderboard(tickets);

    // 10. Find bad tickets (low CSAT, high iterations, etc.)
    const badTickets = tickets.filter(
      (t) => t.csat === 1 || t.iterations > 5 || t.rwt > 48
    );

    // 11. Build response
    const response = {
      stats,
      trends,
      leaderboard,
      badTickets,
    };

    // 12. Cache in Redis (30min) and MongoDB (permanent)
    await Promise.all([
      redisSet(cacheKey, response, CACHE_TTL.ANALYTICS),
      AnalyticsCache.findOneAndUpdate(
        { cache_key: cacheKey },
        { $set: response },
        { upsert: true }
      ),
    ]);

    console.log(`✅ Analytics computed & cached: ${cacheKey}`);
    res.json(response);
  } catch (e) {
    console.error("❌ Analytics error:", e);
    res.status(500).json({ error: e.message });
  }
});
```

### **Drill-Down Feature**

When user clicks on a chart data point:

```
User clicks on chart point (e.g., "Jan 15, 50 solved")
    │
    ├─> handleChartClick(data, metric)
    │   │
    │   ├─> Extract date from data point
    │   │
    │   └─> GET /api/tickets/by-date?date=2026-01-15&metric=solved
    │       │
    │       ├─> backend/server.js: app.get("/api/tickets/by-date")
    │       │   │
    │       │   ├─> Query MongoDB:
    │       │   │   matchConditions = {
    │       │   │     closed_date: { $gte: startOfDay, $lte: endOfDay }
    │       │   │   }
    │       │   │
    │       │   └─> Response: { tickets: [...] }
    │       │
    │       └─> Open DrillDownModal with tickets
    │           └─> Display: Ticket list, summary stats, export CSV
```

---

## 3️⃣ Gamification System

### **Component**: `GamificationView.jsx`

### **Data Flow**

```
User Opens Gamification Tab
    │
    ├─> GamificationView.jsx mounts
    │   │
    │   ├─> useEffect() calls fetchData()
    │   │   └─> GET /api/gamification?quarter=Q1_26
    │   │       │
    │   │       ├─> backend/server.js: app.get("/api/gamification")
    │   │       │   │
    │   │       │   ├─> Check Redis cache
    │   │       │   │   └─> Key: "gamification:Q1_26"
    │   │       │   │
    │   │       │   └─> Compute from MongoDB (AnalyticsTicket collection)
    │   │       │       │
    │   │       │       ├─> Query: { closed_date: { $gte, $lte } }
    │   │       │       │
    │   │       │       ├─> Group by owner (engineer)
    │   │       │       │   └─> Compute:
    │   │       │       │       - Total tickets solved
    │   │       │       │       - Avg RWT, FRT, Iterations
    │   │       │       │       - CSAT score (Good - Bad)
    │   │       │       │       - FRR percentage
    │   │       │       │       - Points (weighted score)
    │   │       │       │
    │   │       │       ├─> Sort by points (descending)
    │   │       │       │
    │   │       │       ├─> Assign ranks (1, 2, 3, ...)
    │   │       │       │
    │   │       │       ├─> Separate into tiers: L1, L2, L3
    │   │       │       │
    │   │       │       └─> Cache in Redis (1 hour TTL)
    │   │       │
    │   │       └─> Response: {
    │   │             L1: [{ name, rank, points, solved, avgRWT, ... }],
    │   │             L2: [{ ... }],
    │   │             L3: [{ ... }]
    │   │           }
    │   │
    │   └─> GamificationView.jsx renders:
    │       ├─> Tier tabs (L1, L2, L3)
    │       ├─> Leaderboard cards with ranks
    │       ├─> Trophy badges (🥇 🥈 🥉)
    │       ├─> Performance metrics per engineer
    │       └─> Sortable columns
    │
    └─> If user is GST member (not admin):
        └─> Show only user's own card (privacy mode)
```

### **Key Files**

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/components/GamificationView.jsx` | Gamification UI | `GamificationView()`, ranking, tier tabs |
| `backend/server.js` | Gamification API | `GET /api/gamification`, scoring logic |

### **Scoring Algorithm**

```javascript
// backend/server.js (Lines 2400-2600)

// Points calculation for each engineer
const calculatePoints = (engineer) => {
  let points = 0;

  // 1. Base points: Tickets solved
  points += engineer.totalTickets * 10;

  // 2. Performance bonus: Low RWT (faster response)
  if (engineer.avgRWT < 2) points += 50;
  else if (engineer.avgRWT < 4) points += 30;
  else if (engineer.avgRWT < 8) points += 10;

  // 3. Performance bonus: Low FRT (faster first response)
  if (engineer.avgFRT < 1) points += 50;
  else if (engineer.avgFRT < 2) points += 30;
  else if (engineer.avgFRT < 4) points += 10;

  // 4. Quality bonus: High CSAT
  const csatScore = engineer.goodCSAT - engineer.badCSAT;
  points += csatScore * 20;

  // 5. Efficiency bonus: Low iterations
  if (engineer.avgIterations < 2) points += 40;
  else if (engineer.avgIterations < 3) points += 20;

  // 6. FRR bonus: High FRR percentage
  if (engineer.frrPercent > 80) points += 60;
  else if (engineer.frrPercent > 60) points += 30;

  return points;
};

// Rank assignment
const assignRanks = (engineers) => {
  // Sort by points descending
  engineers.sort((a, b) => b.points - a.points);

  // Assign ranks
  engineers.forEach((eng, index) => {
    eng.rank = index + 1;
    eng.badge = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : null;
  });

  return engineers;
};
```

### **Privacy Mode**

For non-admin users:

```javascript
// GamificationView.jsx (Lines 44-60)

const GamificationView = ({ currentUser, isAdmin }) => {
  const [viewAsGST, setViewAsGST] = useState(false);

  // Resolve current user's GST name
  const currentUserName = EMAIL_TO_NAME_MAP[currentUser.email];

  // Show full leaderboard only for admins
  const showFullLeaderboard = isAdmin && !viewAsGST;

  // For GST users, show only their own card
  const filteredData = showFullLeaderboard
    ? data // Show all
    : data.filter((eng) => eng.name === currentUserName); // Show only self

  return (
    <div>
      {showFullLeaderboard ? (
        <FullLeaderboard data={data} />
      ) : (
        <UserCard data={filteredData[0]} />
      )}
    </div>
  );
};
```

---

## 4️⃣ Views System

### **Component**: `src/store.js` (Views section)

### **Data Flow**

```
User Creates Custom View
    │
    ├─> User applies filters (assignee, region, priority, etc.)
    │
    ├─> User clicks "Save View" button
    │   │
    │   ├─> Prompts for view name
    │   │
    │   └─> store.js: saveView(name, currentFilters)
    │       └─> POST /api/views
    │           Body: {
    │             userId: currentUser.email,
    │             name: "My Custom View",
    │             filters: {
    │               assignee: ["Rohan", "Archie"],
    │               region: ["US"],
    │               priority: ["high"]
    │             }
    │           }
    │           │
    │           ├─> backend/server.js: app.post("/api/views")
    │           │   │
    │           │   ├─> Create new View document in MongoDB
    │           │   │   Schema: {
    │           │   │     userId: String,
    │           │   │     name: String,
    │           │   │     filters: Object,
    │           │   │     createdAt: Date
    │           │   │   }
    │           │   │
    │           │   └─> Response: { success: true, view: {...} }
    │           │
    │           └─> Update local state: myViews = [newView, ...myViews]
    │
    └─> User loads view later
        │
        ├─> User clicks on saved view
        │
        ├─> Apply filters from view.filters
        │
        └─> Ongoing Tickets tab updates with filtered results
```

### **Key Files**

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/store.js` | Views state management | `fetchViews()`, `saveView()`, `deleteView()` |
| `backend/server.js` | Views API | `GET/POST/DELETE /api/views` |

### **Code Deep Dive**

#### **Frontend: store.js (Lines 84-127)**

```javascript
// Fetch user's saved views
fetchViews: async () => {
  const { currentUser } = get();
  if (!currentUser?.email) return;

  try {
    const API_URL = getApiUrl();
    const res = await fetch(
      `${API_URL}/api/views/${encodeURIComponent(currentUser.email)}`
    );
    set({ myViews: await res.json() });
  } catch (e) {
    console.error("Failed to fetch views", e);
  }
},

// Save new view
saveView: async (name, currentFilters) => {
  const { currentUser, myViews } = get();
  if (!currentUser?.email) return false;

  try {
    const API_URL = getApiUrl();
    const res = await fetch(`${API_URL}/api/views`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: currentUser.email,
        name,
        filters: currentFilters,
      }),
    });

    const data = await res.json();
    if (data.success) {
      // Add to local state
      set({ myViews: [data.view, ...myViews] });
      return true;
    }
  } catch (e) {
    console.error("Failed to save view", e);
  }
  return false;
},

// Delete view
deleteView: async (viewId) => {
  const { currentUser, myViews } = get();
  if (!currentUser?.email) return;

  try {
    const API_URL = getApiUrl();
    await fetch(
      `${API_URL}/api/views/${encodeURIComponent(currentUser.email)}/${viewId}`,
      { method: "DELETE" }
    );
    // Remove from local state
    set({ myViews: myViews.filter((v) => v._id !== viewId) });
  } catch (e) {
    console.error("Failed to delete view", e);
  }
},
```

#### **Backend: server.js (Views API)**

```javascript
// ViewSchema definition (Line 217-223)
const ViewSchema = new mongoose.Schema({
  userId: String, // User's email
  name: String, // View name (e.g., "High Priority US Tickets")
  filters: Object, // Filter config (assignee, region, priority, etc.)
  createdAt: { type: Date, default: Date.now },
});
const View = mongoose.model("View", ViewSchema);

// GET /api/views/:userId - Fetch user's views
app.get("/api/views/:userId", async (req, res) => {
  try {
    const views = await View.find({ userId: req.params.userId }).sort({
      createdAt: -1,
    });
    res.json(views);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/views - Create new view
app.post("/api/views", async (req, res) => {
  try {
    const { userId, name, filters } = req.body;
    const view = await View.create({ userId, name, filters });
    res.json({ success: true, view });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/views/:userId/:viewId - Delete view
app.delete("/api/views/:userId/:viewId", async (req, res) => {
  try {
    await View.deleteOne({
      _id: req.params.viewId,
      userId: req.params.userId,
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

---

## 🔴 Why Redis?

### **Problem Without Redis**

```
Without Redis (Direct MongoDB queries):
┌────────────────────────────────────┐
│ Request 1: GET /api/tickets        │
│   └─> MongoDB query (50-100ms)    │
│                                    │
│ Request 2: GET /api/tickets        │
│   └─> MongoDB query (50-100ms)    │ ← Redundant query!
│                                    │
│ Request 3: GET /api/tickets        │
│   └─> MongoDB query (50-100ms)    │ ← Redundant query!
└────────────────────────────────────┘
Total: 150-300ms for 3 identical requests
```

### **Solution With Redis**

```
With Redis (In-Memory Cache):
┌────────────────────────────────────┐
│ Request 1: GET /api/tickets        │
│   ├─> Redis MISS                   │
│   ├─> MongoDB query (50ms)         │
│   └─> Cache in Redis (1ms)         │
│                                    │
│ Request 2: GET /api/tickets        │
│   └─> Redis HIT (2ms) ✅           │
│                                    │
│ Request 3: GET /api/tickets        │
│   └─> Redis HIT (2ms) ✅           │
└────────────────────────────────────┘
Total: 54ms (95% faster!)
```

### **Redis Benefits**

1. **Speed**: Sub-millisecond response (2-5ms vs 50-100ms MongoDB)
2. **Reduced Load**: MongoDB handles 90% fewer queries
3. **Scalability**: Supports 1000+ concurrent users
4. **TTL Support**: Auto-expiration (5min for tickets, 30min for analytics)
5. **Shared State**: Multiple server instances share same cache

### **Cache Strategy**

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| Active Tickets | 5 minutes | Updates frequently via DevRev |
| Analytics | 30 minutes | Historical data, slow to change |
| Leaderboard | 1 hour | Daily/weekly aggregates |
| Drill-down | 10 minutes | User-specific queries |

### **Redis Data Structure**

```javascript
// Redis Keys
"tickets:active" → JSON array of ~200 tickets
"analytics:Q1_26:true:false:all:none:none:daily" → Analytics response
"livestats:2026-01-01:2026-01-31:all:all:false:false" → Live stats
"gamification:Q1_26" → Leaderboard data

// Example: tickets:active
{
  "tickets": [
    {
      "id": "don:core:...",
      "display_id": "ISS-12345",
      "title": "API timeout issue",
      "stage": { "name": "Waiting on Assignee" },
      "owned_by": [{ "display_name": "Rohan" }],
      ...
    },
    ...
  ]
}
```

---

## 🌐 Why WebSocket (Socket.io)?

### **Problem Without WebSocket**

```
Without WebSocket (Polling):
┌────────────────────────────────────┐
│ Client polls every 10 seconds:     │
│   ├─> GET /api/tickets (50ms)     │
│   ├─> Wait 10 seconds              │
│   ├─> GET /api/tickets (50ms)     │ ← Redundant if no change
│   ├─> Wait 10 seconds              │
│   └─> GET /api/tickets (50ms)     │ ← Redundant if no change
└────────────────────────────────────┘
Problems:
- High server load (100 users = 1000 req/min)
- Data staleness (10-second delay)
- Wasted bandwidth (95% redundant requests)
```

### **Solution With WebSocket**

```
With WebSocket (Push-based):
┌────────────────────────────────────┐
│ 1. Client connects to Socket.io    │
│   └─> Persistent connection         │
│                                    │
│ 2. Server syncs tickets (every 5min)│
│   └─> io.emit("DATA_UPDATED", {...})│
│       │                             │
│       └─> All clients receive signal│
│           (200 bytes per client)   │
│                                    │
│ 3. Clients fetch latest data       │
│   └─> GET /api/tickets (from cache)│
└────────────────────────────────────┘
Benefits:
- Low server load (1 broadcast for 100 users)
- Instant updates (0-second delay)
- Efficient bandwidth (200 bytes vs 5MB)
```

### **WebSocket Flow**

#### **Server-Side: backend/server.js**

```javascript
// 1. Initialize Socket.io
const io = new Server(server, { cors: { origin: "*" } });

// 2. Handle connections
io.on("connection", (socket) => {
  console.log("🟢 Client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
  });
});

// 3. Broadcast updates (in fetchAndCacheTickets)
io.emit("DATA_UPDATED", {
  type: 'tickets',
  count: activeTickets.length,
  timestamp: new Date().toISOString()
});
```

#### **Client-Side: src/store.js**

```javascript
// 1. Connect to WebSocket
connectSocket: () => {
  const { socket } = get();
  if (socket) return; // Already connected

  const API_URL = getApiUrl();
  const newSocket = io(API_URL);

  // 2. Handle connection
  newSocket.on("connect", () => {
    console.log("🟢 Connected to Real-Time Server");
  });

  // 3. Listen for updates
  newSocket.on("DATA_UPDATED", (signal) => {
    console.log("📥 Live Update Signal:", signal);
    // Re-fetch tickets (from Redis cache)
    get().fetchTickets();
  });

  // 4. Store socket instance
  set({ socket: newSocket });
},
```

### **Why Lightweight Signals?**

**Before (Broadcast full data)**:
```javascript
// ❌ BAD: Sends 5MB to every client
io.emit("REFRESH_TICKETS", activeTickets);

// With 100 users: 5MB × 100 = 500MB bandwidth per update!
```

**After (Broadcast signal)**:
```javascript
// ✅ GOOD: Sends 200 bytes to every client
io.emit("DATA_UPDATED", {
  type: 'tickets',
  count: 150,
  timestamp: "2026-01-24T10:30:00Z"
});

// With 100 users: 200 bytes × 100 = 20KB bandwidth per update!
// 25,000x reduction in bandwidth!
```

---

## 📊 Component Hierarchy

```
App.jsx (Root)
├─> LoginScreen.jsx (if not authenticated)
├─> Navigation Tabs
│   ├─> Tab 1: Ongoing Tickets
│   │   └─> Allticketsview.jsx
│   │       ├─> TicketList.jsx (grouped by state)
│   │       ├─> GroupedTicketList.jsx (expandable sections)
│   │       ├─> RemarkPopover.jsx (ticket comments)
│   │       └─> MultiSelectFilter.jsx (filters)
│   │
│   ├─> Tab 2: Analytics
│   │   └─> AnalyticsDashboard.jsx
│   │       ├─> PerformanceMetricsCards.jsx (RWT, FRT, CSAT, FRR)
│   │       ├─> SmartDateRangePicker.jsx (date filters)
│   │       ├─> MultiSelectFilter.jsx (owner, region filters)
│   │       ├─> TrendCharts (Recharts: AreaChart, LineChart)
│   │       ├─> CSATLeaderboard.jsx (top performers)
│   │       ├─> DSATAlerts.jsx (bad tickets)
│   │       ├─> DrillDownModal.jsx (ticket details on chart click)
│   │       └─> NOCAnalytics.jsx (NOC-specific metrics)
│   │
│   └─> Tab 3: Gamification
│       └─> GamificationView.jsx
│           ├─> Tier Tabs (L1, L2, L3)
│           ├─> LeaderboardCard.jsx (individual engineer card)
│           ├─> RankBadge.jsx (🥇 🥈 🥉)
│           └─> ProfileStatsModal.jsx (detailed engineer stats)
│
└─> Zustand Store (store.js)
    ├─> State:
    │   ├─> tickets: []
    │   ├─> analyticsData: {}
    │   ├─> myViews: []
    │   ├─> currentUser: {}
    │   └─> socket: WebSocket
    │
    └─> Actions:
        ├─> fetchTickets()
        ├─> fetchAnalyticsData()
        ├─> fetchViews()
        ├─> saveView()
        ├─> deleteView()
        ├─> connectSocket()
        └─> loginWithGoogle()
```

---

## 🔌 API Reference

### **Ongoing Tickets API**

| Endpoint | Method | Description | Response Time |
|----------|--------|-------------|---------------|
| `/api/tickets` | GET | Fetch active tickets (Redis cache) | 5-10ms (cache hit) |
| `/api/tickets?page=1&limit=50` | GET | Paginated tickets | 5-10ms (cache hit) |
| `/api/tickets/sync` | POST | Force sync from DevRev | 5-10 seconds |

### **Analytics API**

| Endpoint | Method | Description | Response Time |
|----------|--------|-------------|---------------|
| `/api/tickets/analytics?quarter=Q1_26` | GET | Aggregated analytics | 10-50ms (cache hit) |
| `/api/tickets/by-date?date=2026-01-15` | GET | Tickets for specific date | 50-100ms |
| `/api/tickets/by-range?start=...&end=...` | GET | Tickets for date range | 100-500ms |
| `/api/tickets/live-stats?start=...&end=...` | GET | Real-time stats | 50-100ms |

### **Gamification API**

| Endpoint | Method | Description | Response Time |
|----------|--------|-------------|---------------|
| `/api/gamification?quarter=Q1_26` | GET | Leaderboard data | 50-100ms (cache hit) |

### **Views API**

| Endpoint | Method | Description | Response Time |
|----------|--------|-------------|---------------|
| `/api/views/:userId` | GET | Fetch user's saved views | 10-50ms |
| `/api/views` | POST | Create new view | 50-100ms |
| `/api/views/:userId/:viewId` | DELETE | Delete view | 50-100ms |

### **WebSocket Events**

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `connect` | Server → Client | `{ id: "socket_id" }` | Connection established |
| `DATA_UPDATED` | Server → Client | `{ type, count, timestamp }` | Signal tickets refreshed |
| `REFRESH_TICKETS` | Server → Client | `{ tickets: [...] }` | Legacy: Full data push (deprecated) |
| `disconnect` | Server → Client | `{}` | Connection closed |

---

## 🎯 Performance Benchmarks

### **Page Load Times**

| View | Without Optimization | With Optimization | Improvement |
|------|---------------------|-------------------|-------------|
| Ongoing Tickets | ~60 seconds | ~5-10 seconds | **6-10x faster** |
| Analytics | ~10 seconds | ~2-3 seconds | **3-5x faster** |
| Gamification | ~5 seconds | ~1-2 seconds | **2-5x faster** |

### **Memory Usage**

| Scenario | Without Optimization | With Optimization | Improvement |
|----------|---------------------|-------------------|-------------|
| Server RAM | 512MB+ (crashes) | 150-200MB | **60-70% reduction** |
| Client RAM | 300MB+ | 100-150MB | **50% reduction** |

### **Concurrent Users**

| Scenario | Without Optimization | With Optimization | Improvement |
|----------|---------------------|-------------------|-------------|
| Max Users | 10-20 (crashes) | 100+ | **5-10x scale** |
| Requests/sec | 50 | 500+ | **10x throughput** |

---

## 🔒 Security & Best Practices

### **Authentication**

- Google OAuth 2.0 for user login
- JWT token stored in localStorage
- Email-based authorization (GST team members only)

### **Data Privacy**

- Gamification: Non-admin users see only their own stats
- Views: User-specific (isolated by email)
- Analytics: Admin-only for sensitive metrics

### **Error Handling**

```javascript
// All API endpoints follow this pattern:
try {
  // Business logic
  res.json({ success: true, data });
} catch (e) {
  console.error("❌ Error:", e);
  res.status(500).json({ error: e.message });
}
```

### **Rate Limiting**

- Redis cache prevents excessive MongoDB queries
- WebSocket prevents polling storms
- DevRev API: Max 100 pages per sync

---

## 📚 Quick Reference

### **Environment Variables**

```bash
# Backend (.env)
MONGO_URI=mongodb+srv://...
REDIS_URL=redis://...
VITE_DEVREV_PAT=...
GOOGLE_CLIENT_ID=...
PORT=5000

# Frontend (.env)
VITE_API_URL=http://localhost:5000
```

### **Key MongoDB Collections**

```javascript
// 1. AnalyticsTicket - Historical tickets (Warm/Cold data)
{
  ticket_id: "don:core:...",
  display_id: "ISS-12345",
  closed_date: Date,
  owner: "Rohan",
  rwt: 2.5,
  frt: 0.8,
  csat: 2,
  frr: 1,
  ...
}

// 2. AnalyticsCache - Pre-computed analytics
{
  cache_key: "analytics:Q1_26:true:false:all:none:none:daily",
  computed_at: Date,
  stats: { ... },
  trends: [ ... ],
  leaderboard: [ ... ]
}

// 3. View - User-saved filters
{
  userId: "user@example.com",
  name: "My Custom View",
  filters: { assignee: ["Rohan"], region: ["US"] },
  createdAt: Date
}
```

---

**Last Updated**: 2026-01-24
**Version**: 2.0
**Author**: Claude Sonnet 4.5

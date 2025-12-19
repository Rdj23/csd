# Analytics Dashboard

## What It Does (User Perspective)

The **Analytics** tab is the management intelligence layer. It provides KPIs, trends, leaderboards, DSAT alerts, and drill-down capabilities. Managers use it to track team performance, identify bottlenecks, and spot CSAT issues.

---

## Sub-Sections

### A. Performance Overview (KPI Cards)

Seven top-level metric cards:

| KPI              | Meaning                                    | Sparkline |
| ---------------- | ------------------------------------------ | --------- |
| **Volume**       | Tickets created in selected range          | 14-day    |
| **Solved**       | Tickets closed in selected range           | 14-day    |
| **Avg RWT**      | Average Resolution Wait Time (hours)       | 14-day    |
| **Avg FRT**      | Average First Response Time (hours)        | 14-day    |
| **FRR %**        | First Response Resolution percentage       | 14-day    |
| **Avg Iterations** | Average back-and-forth count             | 14-day    |
| **CSAT %**       | Customer Satisfaction (positive ratings)   | 14-day    |

Each card includes:
- Sparkline mini-chart showing 14-day trend
- Hover tooltip with week-over-week % change
- Click to expand to full-screen modal

### B. CSAT Leaderboard

| Column     | Color Coding                              |
| ---------- | ----------------------------------------- |
| Engineer   | Name                                      |
| CSAT %     | Green (80%+), Blue (60%+), Amber (40%+), Red (<40%) |
| Solved     | Count                                     |
| Avg RWT    | Hours                                     |
| Health     | Computed indicator                        |

Sortable by any column. Click an engineer to drill into their individual tickets.

### C. DSAT Alerts

Shows tickets with **negative sentiment** (Unhappy/Frustrated) — a quick-action list for managers to review problem tickets.

### D. NOC Analytics

Dedicated section for Network Operations Center incidents:
- NOC-blocked ticket list and status
- Separate tracking for blocked tickets
- Toggles: Exclude Zendesk / Exclude NOC

### E. Smart Insights (AI-Generated)

AI-generated natural-language insights about:
- High-performing days/periods
- Anomalies or concerns
- Trend summaries

### F. Charts

- **Volume Trend**: Daily/weekly area chart
- **Solved Trend**: Daily/weekly area chart
- **RWT/FRT Trends**: Line chart
- **Distribution**: Pie/bar charts
- All charts support drill-down (click a point → see tickets)

### G. Filters

| Filter           | Options                                      |
| ---------------- | -------------------------------------------- |
| Quarter          | Q1_26, Q2_26, etc.                           |
| Date Range       | Custom range within selected quarter         |
| Group By         | Daily / Weekly / Monthly                     |
| Team / Member    | Multi-select                                 |
| Region / Cohort  | Multi-select                                 |
| Exclude Zendesk  | Toggle                                       |
| Exclude NOC      | Toggle                                       |

---

## How It Maps to the Backend

### Primary API Endpoint

```
GET /api/tickets/analytics?quarter=Q1_26&excludeZendesk=true&excludeNOC=true&groupBy=daily
```

**Handler**: `analyticsController.getAnalytics()`

### 3-Tier Cache Strategy

This is the most heavily cached endpoint due to expensive aggregations:

```
Request arrives
    ↓
1. PrecomputedDashboard (MongoDB, 25h TTL)
   → Fastest path. Precomputed by nightly cron.
   → Only used for default (unfiltered) queries.
    ↓
2. Redis String Cache (15min TTL)
   → Used for any filtered query.
   → Key: analytics:{quarter}:{excludeZendesk}:{excludeNOC}:{owner}:{region}:{cohort}:{groupBy}
    ↓
3. MongoDB AnalyticsCache (24h TTL)
   → Fallback if Redis evicted the entry.
   → One document per quarter.
    ↓
4. CACHE MISS → Acquire distributed lock
   → Prevents cache stampede (thundering herd)
   → Lock key: lock:analytics:{cacheKey}, TTL: 60s
   → If lock fails: wait 2s, retry cache read
    ↓
5. Compute fresh — 4 aggregation pipelines in parallel:
   a) Overall stats (totalSolved, avgRWT/FRT, CSAT%, FRR%, backlog cleared)
   b) Trends (daily/weekly/monthly by groupBy format)
   c) Leaderboard (by owner with win-rate calculation)
   d) Bad CSAT tickets (csat: 1, limit 50)
   e) Individual trends (per owner + date)
    ↓
6. Send response IMMEDIATELY (don't wait for cache write)
    ↓
7. Background: Write to Redis + MongoDB AnalyticsCache
   → Release distributed lock
```

### CSAT Override (NOC Handling)

When `excludeNOC=true`, there's a subtle requirement: CSAT should still include NOC tickets in its calculation (NOC tickets affect satisfaction even when excluded from workload metrics). The controller:

1. Computes all metrics excluding NOC
2. Re-computes CSAT/DSAT **including** NOC tickets
3. Overrides the CSAT values in the response

### Aggregation Pipeline (Simplified)

```javascript
AnalyticsTicket.aggregate([
  { $match: { closed_date: { $gte: start, $lte: end }, ...filters } },
  { $group: {
    _id: null,
    totalTickets: { $sum: 1 },
    avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
    avgFRT: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
    avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
    positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
    negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
    frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } }
  }}
]).allowDiskUse(true)
```

`.allowDiskUse(true)` is critical — it allows MongoDB to spill intermediate aggregation results to disk when they exceed the 100MB memory limit.

### Drill-Down Endpoint

```
GET /api/tickets/analytics/drill-down?quarter=Q1_26&scope=individual&email=rohan@clevertap.com
```

**Handler**: `analyticsController.getTicketDrillDown()`

Supports three scopes:
- `all` — all tickets in range
- `individual` — single engineer (resolved from email via `EMAIL_TO_NAME_MAP`)
- `team` — all members of a team (resolved from `TEAM_MAPPING`)

Returns:
```json
{
  "quarter": "Q1_26",
  "scope": "individual",
  "totalSolved": 45,
  "totalNOC": 3,
  "ownerSummary": { "Rohan": { "solved": 45, "avgRWT": 8.2, "csatPercent": 92 } },
  "tickets": [...],
  "nocTickets": [...]
}
```

### Precomputation (Cron Job)

```
Cron: 30 4 * * * (04:30 UTC / 10:00 AM IST)
Queue: analytics
Job: precompute with { quarter: getCurrentQuarterKey() }
```

The analytics worker calls `precomputeAnalytics(quarter)` which runs the same aggregation pipelines and stores the result in `PrecomputedDashboard` collection with a `computing` lock flag to prevent concurrent precomputation.

---

## Reference Files

| File | Purpose |
| ---- | ------- |
| `src/features/analytics/components/AnalyticsDashboard.jsx` | Main analytics page |
| `src/features/analytics/components/PerformanceOverview.jsx` | KPI cards with sparklines |
| `src/features/analytics/components/CSATSection.jsx` | CSAT leaderboard |
| `src/features/analytics/components/DSATSection.jsx` | DSAT alerts |
| `src/features/analytics/components/NOCAnalytics.jsx` | NOC-specific analytics |
| `src/features/analytics/components/SmartInsights.jsx` | AI insights |
| `src/features/analytics/components/ThisWeekStats.jsx` | Current week summary |
| `src/api/analyticsApi.js` | API client |
| `backend/controllers/analyticsController.js` | `getAnalytics()`, `getTicketDrillDown()` |
| `backend/services/analyticsService.js` | `precomputeAnalytics()` |
| `backend/utils/aggregationStages.js` | Reusable pipeline stages |
| `backend/utils/formatters.js` | Response formatting |
| `backend/models/index.js` (AnalyticsCache, PrecomputedDashboard) | Cache schemas |

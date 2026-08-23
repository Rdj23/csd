# All Tickets View

## What It Does (User Perspective)

The **All Tickets** tab provides a historical, filterable view of all tickets (not just active ones). It shows ticket distribution across states via **pie charts** and allows deep drill-down into any slice. This is the "big picture" view for managers and leads.

### State Buckets

| State         | Maps To                       | Color   |
| ------------- | ----------------------------- | ------- |
| **Open**      | Waiting on Assignee           | Blue    |
| **Pending**   | Awaiting Customer Reply       | Yellow  |
| **On Hold**   | Waiting on CleverTap          | Orange  |
| **Solved**    | Solved / Closed / Resolved    | Green   |

### Pie Charts

- Visual distribution of tickets across the four states
- **Clickable slices** — clicking a slice opens a drill-down modal with the matching tickets
- Rendered using Nivo pie chart library

### Filters

All filters are multi-select dropdowns with search:

| Filter            | Options                                    |
| ----------------- | ------------------------------------------ |
| Date Range        | SmartDatePicker (presets: Last 7d, Month, All Time, Custom) |
| Team              | Team names from `TEAM_GROUPS`              |
| Member            | Individual engineer names                  |
| Region            | APAC, EMEA, Americas                       |
| Account           | Customer company names                     |
| CSM               | Customer Success Manager emails            |
| TAM               | Technical Account Manager names            |
| Stage             | Waiting on Assignee, Awaiting Customer, etc. |
| Dependency        | With Dependency / No Dependency            |

### Drill-Down Modal

When a pie chart slice is clicked:

- Opens a modal with filtered tickets matching that state
- Sortable columns: Display ID, Title, Age, Owner, Region, Stage, Status
- In-modal search functionality
- Pagination: 25 tickets per page

---

## How It Maps to the Backend

### API Endpoints

#### Primary: Tickets by Date Range

```
GET /api/tickets/by-range?start=2026-01-01&end=2026-04-12&owners=Rohan,Anurag&pageSize=200&cursor=...
```

**Handler**: `ticketController.getTicketsByRange()`

#### Alternate: Tickets by Specific Date

```
GET /api/tickets/by-date?date=2026-04-12&owners=All&excludeZendesk=true
```

**Handler**: `ticketController.getTicketsByDate()`

### Query Building

Filters are translated to MongoDB `$match` conditions via `backend/utils/queryBuilders.js`:

```javascript
// Example: Owner + Region + Cohort filter
match = {
  closed_date: { $gte: start, $lte: end },
  owner: { $in: ["Rohan", "Anurag"] },       // applyOwnerFilter()
  region: { $in: ["APAC"] },                  // applyRegionFilter()
  is_zendesk: { $ne: true },                  // applyExclusionFilters()
  is_noc: { $ne: true }                       // applyExclusionFilters()
}
```

### Pagination Strategy

**Cursor-based** (preferred) for performance:

```
Cursor Format: "<ISO_DATE>_<MONGODB_OBJECTID>"
Example: "2026-04-12T14:23:45.123Z_507f1f77bcf86cd799439011"

Query:
  $or: [
    { closed_date: { $lt: cursorDate } },
    { closed_date: cursorDate, _id: { $lt: cursorId } }
  ]
  .sort({ closed_date: -1, _id: -1 })
  .limit(pageSize)
```

**Why cursor over offset?** With offset-based `.skip(N)`, MongoDB scans and discards N documents. At page 50 with 200/page, that's scanning 10,000 docs before returning 200. Cursor-based pagination uses the compound index `{ closed_date: -1, _id: -1 }` to jump directly to the right spot — O(1) seek vs O(N) skip.

### Stats Aggregation (Parallel)

While tickets are fetched, stats are computed in parallel:

```javascript
const [tickets, stats] = await Promise.all([
  AnalyticsTicket.find(match).sort(...).limit(pageSize).lean(),
  AnalyticsTicket.aggregate([
    { $match: match },
    { $group: {
      _id: null,
      totalSolved: { $sum: 1 },
      avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
      avgFRT: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
      ...csatFields(),
      ...frrFields()
    }}
  ])
]);
```

### Caching

- `bydate:{date}:{owners}:{excludeZendesk}:{excludeNOC}` — Only **page 1** is cached (TTL: 300s)
- Subsequent pages hit MongoDB directly (cursor-based, fast due to index)
- Cache cleared on every historical sync completion

### Response Shape

```json
{
  "tickets": [...],
  "stats": { "totalSolved": 450, "avgRWT": 12.3, "csatPercent": 85, ... },
  "count": 450,
  "page": 1,
  "pageSize": 200,
  "totalPages": 3,
  "nextCursor": "2026-03-15T10:00:00.000Z_507f1f77bcf86cd799439011"
}
```

---

## Reference Files

| File | Purpose |
| ---- | ------- |
| `src/features/tickets/components/Allticketsview.jsx` | Frontend All Tickets component with pie charts |
| `src/components/common/MultiSelectFilter.jsx` | Reusable filter dropdown component |
| `src/components/common/SmartDateRangePicker.jsx` | Date range picker with presets |
| `backend/controllers/ticketController.js` | `getTicketsByRange()`, `getTicketsByDate()` |
| `backend/utils/queryBuilders.js` | Filter → MongoDB `$match` translation |
| `backend/utils/aggregationStages.js` | Reusable `$group` definitions (csatFields, frrFields, avgMetricFields) |
| `backend/models/index.js` (lines 62-178) | `AnalyticsTicket` schema + compound indexes |

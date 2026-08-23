# Filters System

## What It Does (User Perspective)

Filters are available across most tabs (Ongoing Tickets, All Tickets, CSD Highlighted, Analytics). They allow users to narrow down the ticket view by multiple dimensions simultaneously. All filters are **multi-select** — you can pick multiple teams, regions, owners, etc.

### Available Filters

| Filter             | Options                                      | Applied To                              |
| ------------------ | -------------------------------------------- | --------------------------------------- |
| **Search**         | Free text (ticket ID or title)               | Client-side fuzzy match                 |
| **Date Range**     | SmartDatePicker presets + custom              | Server-side `$match` on dates           |
| **Teams**          | Team names from `TEAM_GROUPS`                | Client-side: filter by owner's team     |
| **Members**        | Individual engineer names                    | Server-side: `owner: { $in: [...] }`    |
| **Regions**        | APAC, EMEA, Americas                         | Server-side: `region: { $in: [...] }`   |
| **Cohorts**        | Enterprise, Key Commercial, Commercial, C4S  | Server-side with special C4S handling   |
| **Accounts**       | Customer company names                       | Client-side: filter by account name     |
| **CSMs**           | Customer Success Manager emails              | Client-side: filter by csm field        |
| **TAMs**           | Technical Account Manager names              | Client-side: filter by tam field        |
| **Stages**         | Waiting on Assignee, Awaiting Customer, etc. | Client-side: filter by stage.name       |
| **Health**         | Status indicator                             | Custom field lookup                     |
| **Sentiments**     | delighted/happy/neutral/frustrated/unhappy   | Client-side: filter by sentimentLabel   |
| **Dependency**     | With Dependency / No Dependency              | Client-side: computed from dependencies |
| **Dependency Teams** | NOC, Whatsapp, Billing, Email, Internal, Other | Client-side: filter by dep team     |
| **Exclude Zendesk** | Toggle                                      | Server-side: `is_zendesk: { $ne: true }` |
| **Exclude NOC**    | Toggle                                       | Server-side: `is_noc: { $ne: true }`   |

### Filter UI Component

Each filter is a `MultiSelectFilter` dropdown:
- Search-within-filter to find options quickly
- "Select All" / "Clear" buttons
- Checkboxes for multi-select
- Highlighted (indigo background) when active

---

## How Filters Map to Backend

### Client-Side Filters (Ongoing Tickets, CSD)

For the active tickets view, all filtering happens in the browser — the API returns the full list, and React filters locally. This works because the active ticket count is manageable (~200-500 tickets).

### Server-Side Filters (All Tickets, Analytics)

For historical data (thousands of tickets), filters are passed as query parameters:

```
GET /api/tickets/by-range?start=2026-01-01&end=2026-04-12&owners=Rohan,Anurag&region=APAC&excludeZendesk=true&excludeNOC=true
```

### Query Builders (`backend/utils/queryBuilders.js`)

Each filter has a dedicated builder function that modifies the MongoDB `$match` object:

```javascript
// Owner filter
applyOwnerFilter(match, "Rohan,Anurag")
→ match.owner = { $in: ["Rohan", "Anurag"] }

// Region filter
applyRegionFilter(match, "APAC,EMEA")
→ match.region = { $in: ["APAC", "EMEA"] }

// Exclusion filters
applyExclusionFilters(match, { excludeZendesk: "true", excludeNOC: "true" })
→ match.is_zendesk = { $ne: true }
→ match.is_noc = { $ne: true }

// Cohort filter (with C4S special case)
applyCohortFilter(match, "Key Commercial,C4S")
→ match.$or = [
    { account_cohort: { $regex: /Key Commercial/i } },
    { account_cohort: null },      // C4S = no cohort
    { account_cohort: "" },
    { account_cohort: { $exists: false } }
  ]
```

The **C4S handling** is notable — C4S (Category 4 Support) represents tickets where the account has no assigned cohort. So the filter includes `null`, empty string, and non-existent field conditions.

### Backlog Filter

A special filter for the "backlog" metric:

```javascript
applyBacklogFilter(match, "backlog")
→ match.$expr = {
    $gt: [
      { $subtract: ["$closed_date", "$created_date"] },
      15 * 86400000  // 15 days in milliseconds
    ]
  }
```

This finds tickets that took more than 15 days to resolve.

---

## Reference Files

| File | Purpose |
| ---- | ------- |
| `src/components/common/MultiSelectFilter.jsx` | Reusable dropdown component |
| `src/components/common/SmartDateRangePicker.jsx` | Date range picker |
| `src/App.jsx` (lines 440-750) | Client-side filter application logic |
| `backend/utils/queryBuilders.js` | Server-side filter → MongoDB `$match` |
| `backend/controllers/ticketController.js` | Uses query builders in `getTicketsByRange()`, `getTicketsByDate()` |
| `backend/controllers/analyticsController.js` | Uses query builders in `getAnalytics()` |

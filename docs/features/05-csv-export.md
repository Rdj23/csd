# CSV Export / Download

## What It Does (User Perspective)

A **"Report Downloaded"** button in the header allows exporting the current filtered view as a CSV file. The export respects all active filters — if you've filtered to APAC region, only APAC tickets appear in the CSV.

### What Gets Exported

| Section        | Contents                                           |
| -------------- | -------------------------------------------------- |
| **Header**     | Which filters were applied (as a comment row)      |
| **Summary**    | Open / Pending / On Hold / Solved counts           |
| **Data Rows**  | Every ticket in the filtered view                  |

### Columns in CSV

Ticket ID, Title, Account, Owner, Region, Stage, Status, Age, RWT, ITR, and other relevant fields depending on the active tab.

### Tab-Specific Export

The export logic adapts based on which tab is active:
- **Ongoing Tickets / CSD**: Exports from the filtered `displayTickets` array
- **All Tickets**: Exports from `allTicketsFiltered` array

### Analytics Tracking

Each download triggers:
```javascript
trackEvent("Report Downloaded", { "Ticket Count": count, "Workspace": account })
```

---

## How It Maps to the Backend

**There is no backend endpoint for CSV export.** The entire CSV is generated client-side:

```
User clicks "Export" → the tab's own export builder assembles rows,
then hands them to downloadCsv() in src/lib/csv.js
    ↓
1. Read filtered ticket array from React state
2. Build CSV header (filter summary)
3. Build summary row (Open/Pending/On Hold/Solved counts)
4. Map each ticket to CSV row
5. Create Blob → trigger browser download
```

### Why Client-Side?

Since the frontend already has the filtered data in memory (from the Zustand store), generating CSV locally avoids:
- An extra API round-trip
- Server-side memory allocation for CSV generation
- Potential timeout on large exports

---

## Reference Files

| File | Purpose |
| ---- | ------- |
| `src/lib/csv.js` | `downloadCsv()` / `csvTimestamp()` / `csvSafeName()` — the shared download mechanics, used by all five exporters |
| `src/App.jsx` | Builds the ongoing-board rows, then calls `downloadCsv()` |
| `src/features/tickets/components/Allticketsview.jsx` | Builds the All-Tickets rows |
| `src/features/tickets/components/TicketDrillDownModal.jsx` | Builds the drill-down rows |
| `src/features/analytics/components/DrillDownModal.jsx` | Builds the analytics drill-down rows |
| `src/features/analytics/components/NOCAnalytics.jsx` | Builds the NOC rows |

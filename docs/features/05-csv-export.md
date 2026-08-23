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
User clicks "Export" → handleExportCSV() in App.jsx (lines 440-592)
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
| `src/App.jsx` (lines 440-592) | `handleExportCSV()` — full CSV generation logic |

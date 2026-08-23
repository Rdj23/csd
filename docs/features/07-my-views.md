# My Views (Saved Filter Presets)

## What It Does (User Perspective)

The **My Views** tab lets users save their current filter configuration as a named preset. Instead of re-applying 5 filters every morning, you save them once as "My APAC P1 Queue" and load it with one click.

### Features

- **Save Current View**: Button saves all active filters with a custom name
- **View Sidebar**: Left panel lists all saved views
- **Load View**: Click a saved view to instantly apply its filters
- **Delete View**: Hover → trash icon to remove
- **View Modal**: Input dialog for naming a new view

### What Gets Saved

```javascript
{
  userId: "rohan@clevertap.com",
  name: "My APAC High-Priority",
  filters: {
    teams: ["Team Rohan"],
    owners: ["Rohan", "Anurag"],
    regions: ["APAC"],
    stages: ["Waiting on Assignee"],
    health: [],
    accounts: [],
    csms: [],
    tams: [],
    cohorts: ["Enterprise", "Key Commercial"],
    sentiments: [],
    dateRange: { start: "2026-01-01", end: "2026-04-12" },
    dependency: [],
    dependencyTeams: []
  }
}
```

---

## How It Maps to the Backend

### API Endpoints

| Method   | Endpoint                       | Handler                    | Purpose                  |
| -------- | ------------------------------ | -------------------------- | ------------------------ |
| `GET`    | `/api/views/:userId`           | `viewController.getViews()`  | Fetch all saved views (max 100, sorted -createdAt) |
| `POST`   | `/api/views`                   | `viewController.createView()` | Save new view           |
| `DELETE` | `/api/views/:userId/:viewId`   | `viewController.deleteView()` | Delete view             |

### MongoDB Collection: `View`

```javascript
{
  userId: String,     // Indexed — user's email
  name: String,       // Display name
  filters: Object,    // Flexible shape (evolves without migration)
  createdAt: Date     // Auto-timestamp
}
```

### Design Decision: Flexible `filters` Field

The `filters` field is typed as `Object` (not a strict schema) deliberately. As the frontend adds new filter types (e.g., Dependency Teams was added later), old saved views still work — they simply don't have the new filter keys, which default to empty arrays in the frontend.

### Zustand Store Integration

```javascript
// store.js
myViews: []                           // Cached in Zustand
fetchViews()  → GET /api/views/{email}    // Load on login
saveView(name, filters) → POST /api/views // Save + re-fetch
deleteView(viewId) → DELETE ...           // Delete + re-fetch
```

Views are also persisted in `localStorage` via Zustand's persistence middleware for offline access.

---

## Reference Files

| File | Purpose |
| ---- | ------- |
| `src/features/tickets/components/GroupedTicketList.jsx` | My Views UI with sidebar |
| `src/api/viewApi.js` | API client (GET, POST, DELETE) |
| `src/store.js` | Zustand actions: `fetchViews()`, `saveView()`, `deleteView()` |
| `backend/controllers/viewController.js` | Simple CRUD (36 lines) |
| `backend/routes/views.js` | Route definitions |
| `backend/models/index.js` (lines 48-58) | `View` schema |

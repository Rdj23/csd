# Remark Feature (Internal Comments)

## What It Does (User Perspective)

The **Remark** feature allows engineers to add internal notes to high-priority tickets. A MessageSquare icon appears on **red (priority-1) tickets only**. Clicking it opens a popover where you can:

1. **View remark history** — all previous internal notes on this ticket
2. **Write a new remark** — with `@mention` support for tagging team members
3. **Auto-sync to DevRev** — the remark is posted both locally (MongoDB) and as an internal DevRev timeline comment

### @Mention System

- Type `@` followed by a name → auto-complete dropdown appears
- Navigate with arrow keys, select with Enter
- The mention is converted to DevRev's identity format for sync:
  ```
  @Rohan Jadhav → <don:identity:dvrv-us-1:devo/xxx:devu/yyy>
  ```
- In the UI, DevRev identity strings are converted back to readable `@Name` format

### Auto-Signature

Every remark automatically appends: `— By <currentUserDevRevId>`

### Auto-Expiry

Remarks are **automatically deleted after 30 days** via a MongoDB TTL index. They're meant as transient operational notes, not permanent records.

---

## How It Maps to the Backend

### API Endpoints

| Method | Endpoint | Handler | Purpose |
| ------ | -------- | ------- | ------- |
| `GET`  | `/api/users` | `remarkController.getUsers()` | List all DevRev dev-users for @mention dropdown |
| `GET`  | `/api/remarks/:ticketId` | `remarkController.getRemarks()` | Fetch remark history (max 500, sorted by timestamp) |
| `POST` | `/api/remarks` | `remarkController.createRemark()` | Save remark locally in MongoDB |
| `POST` | `/api/comments` | `remarkController.createComment()` | Sync to DevRev as internal timeline comment |

### Data Flow

```
User writes remark with @Rohan → Submit
    ↓
Frontend: Convert "@Rohan Jadhav" → "<don:identity:...>"
Frontend: Append "— By <currentUserDevRevId>"
    ↓
Two parallel API calls:
  1. POST /api/remarks → MongoDB (local copy)
  2. POST /api/comments → DevRev API (timeline_entries.create, visibility: internal)
    ↓
UI: Optimistic update (add to history immediately)
```

### MongoDB Collection: `Remark`

```javascript
{
  ticketId: String,    // Indexed — which ticket
  user: String,        // Who wrote it
  text: String,        // Content (with DevRev identity strings)
  timestamp: Date      // TTL index: auto-delete after 30 days (2,592,000 seconds)
}
```

### Users Endpoint Caching

The `GET /api/users` endpoint fetches the full list of DevRev dev-users and caches it **in-memory for 30 minutes**. This avoids hitting the DevRev API on every popover open.

---

## Reference Files

| File | Purpose |
| ---- | ------- |
| `src/features/remarks/components/RemarkPopover.jsx` | Popover UI with mention support |
| `src/features/remarks/components/ProfileStatsModal.jsx` | Profile stats (triggered by owner click) |
| `src/hooks/useRemarks.js` | Custom hook: fetches remarks + users |
| `src/api/remarkApi.js` | API client (`GET /api/remarks/:id`, `POST /api/remarks`, etc.) |
| `backend/controllers/remarkController.js` | All 4 endpoints |
| `backend/routes/remarks.js` | Route definitions |
| `backend/models/index.js` (lines 29-45) | `Remark` schema with TTL index |

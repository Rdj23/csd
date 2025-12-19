# CSD Highlighted View

## What It Does (User Perspective)

The **CSD Highlighted** tab shows tickets tagged with `csd-highlighted` — these are escalated or high-visibility tickets that need special attention from leadership. CSD stands for CleverTap Support Dashboard.

It uses the **same table layout** as Ongoing Tickets but with **stricter aging thresholds**:

| Card       | Ongoing Tickets | CSD Highlighted |
| ---------- | --------------- | --------------- |
| **Red**    | > 15 days       | > 7 days        |
| **Yellow** | Medium range    | 3-7 days        |
| **Green**  | < threshold     | < 3 days        |

The tighter thresholds reflect the urgency — highlighted tickets should be resolved faster than normal.

### How Tickets Get Highlighted

A ticket appears here when it has the tag `csd-highlighted` in DevRev. This tagging is done manually by managers or automatically by DevRev workflows.

### Filtering (Client-Side)

The frontend applies the filter at render time:

```javascript
// In App.jsx (lines 714-750)
const csdTickets = tickets.filter(ticket =>
  ticket.tags?.some(tag => tag.name === "csd-highlighted")
);
```

No separate backend endpoint exists — the same `GET /api/tickets` response is used, and the frontend filters locally.

---

## How It Maps to the Backend

### Same API as Ongoing Tickets

```
GET /api/tickets
```

The backend returns ALL active tickets. The CSD view is a **frontend filter** on the same data:

```
GET /api/tickets → All active tickets (from Redis)
    ↓
Frontend: filter by tag.name === "csd-highlighted"
    ↓
Render TicketList with isCSDView=true (changes thresholds)
```

### Component Reuse

The `TicketList.jsx` component accepts a `isCSDView` boolean prop:

```jsx
// When isCSDView=true:
// - KPI card thresholds change (7/3 days instead of 15)
// - Same table columns, sorting, pagination
// - Same remark functionality
```

---

## Reference Files

| File | Purpose |
| ---- | ------- |
| `src/features/tickets/components/TicketList.jsx` | Shared component (accepts `isCSDView` prop) |
| `src/App.jsx` (lines 714-750) | Tag-based filtering logic |
| `backend/controllers/ticketController.js` | Same `getActiveTickets()` endpoint |

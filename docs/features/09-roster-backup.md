# Roster & Backup System

## What It Does (User Perspective)

### Backup Info (Header Sidebar)

On login, a small sidebar shows **who is your backup** if you're unavailable. This is refreshed every 5 minutes. Engineers use this to know who to hand off to during breaks or shift changes.

### Full Roster View

| Feature          | Description                                |
| ---------------- | ------------------------------------------ |
| **Header Stats** | Total engineers, On Shift count, Off/Leave count |
| **Filter by Status** | All / On Shift / Off                  |
| **Filter by Team** | Dropdown team selector                   |
| **Columns**      | Name, Team, Status (checkmark/X), Shift Time |

### Key Use Cases

- **Escalation routing**: Who's available right now?
- **Workload balancing**: How many people are on shift?
- **Backup awareness**: Who covers if someone is offline?

---

## How It Maps to the Backend

### API Endpoints

| Method | Endpoint                    | Handler                    | Purpose                                |
| ------ | --------------------------- | -------------------------- | -------------------------------------- |
| `GET`  | `/api/roster/backup`        | `getBackup()`              | Find backup for user (optionally team-only) |
| `GET`  | `/api/roster/workload`      | `getRosterWorkload()`      | Current workload per engineer          |
| `GET`  | `/api/roster/full`          | `getFullRosterData()`      | Complete roster with shifts, working days |
| `GET`  | `/api/roster/month`         | `getRosterMonth()`         | Monthly roster view                    |
| `GET`  | `/api/roster/today-status`  | `getTodayStatusHandler()`  | Current shift status for all           |
| `POST` | `/api/profile/status`       | `postProfileStatus()`      | Get on-shift status + shift details    |
| `POST` | `/api/roster/sync`          | `postRosterSync()`         | Manually trigger sync from Google Sheets |
| `POST` | `/api/roster/working-days`  | `postWorkingDays()`        | Count working days between dates       |
| `GET`  | `/api/roster/next-working-days` | `getNextWorkingDaysHandler()` | Get next N working days for engineer |

### Data Source: Google Sheets

The roster data lives in a Google Sheet maintained by team leads. The backend reads it via Google Sheets API using a service account:

```
Google Sheet → Google Sheets API (service account: GOOGLE_SHEETS_KEY_BASE64)
    ↓
rosterService.syncRoster()
    ↓
Parse headers: Find date columns (D-MMM format) + Designation column
Build DATE_COL_MAP: { "2026-04-12": columnIndex }
Build engineer data: flatten TEAM_GROUPS, extract shift info
    ↓
Cache to Redis: "roster:rows" (full data), "roster:map" (date→column mapping)
Also store in module-level state for fast access
```

### Shift Status Logic

```javascript
getShiftStatus(row, columnIndex):
  cellValue = row[columnIndex]
  
  IF cellValue in ["SHIFT 1", "SHIFT 2", "SHIFT 3", "SHIFT 4", "ON CALL"]:
    return { isOnShift: true, shift: cellValue }
  
  IF cellValue in OFF_STATUSES ["WO", "EL", "NH", "PL", "PH", "COMP OFF", "OH", ...]:
    return { isOnShift: false, reason: cellValue }
```

### Shift Hours (IST)

```
SHIFT 1:  7:30 AM - 4:30 PM
SHIFT 2: 10:30 AM - 7:30 PM
SHIFT 3:  1:30 PM - 10:30 PM
SHIFT 4: 10:30 PM - 7:30 AM (overnight)
ON CALL:  24 hours
```

### Backup Resolution

```javascript
findBackupForUser(userName, teamOnly):
  1. Look up TEAM_MAPPING[userName].members
  2. For each team member (excluding userName):
     Check if on shift today (via roster data)
  3. Return first available member
  4. If teamOnly=false, search all teams
```

### Working Days Calculation

```javascript
getDaysWorked(name, startDate):
  For each day from startDate to today:
    Check roster cell value for that date
    If shift value (not OFF_STATUS): count++
  Return count
```

This is used by gamification to compute **productivity** = solved tickets / working days.

### Cron Job

```
Startup: Immediate roster sync
Cron: Registered as BullMQ repeatable job (roster queue)
```

When sync completes, the worker publishes `ROSTER_UPDATED` via Redis Pub/Sub, which the API server picks up and broadcasts to all connected browsers.

---

## Reference Files

| File | Purpose |
| ---- | ------- |
| `src/features/roster/components/RosterView.jsx` | Full roster UI |
| `src/api/rosterApi.js` | API client |
| `backend/controllers/rosterController.js` | All roster endpoints (133 lines) |
| `backend/services/rosterService.js` | Google Sheets sync, shift logic, backup resolution |
| `backend/routes/roster.js` | Route definitions |
| `backend/config/constants.js` | `SHIFT_HOURS`, `OFF_STATUSES`, `TEAM_MAPPING` |
| `backend/lib/workers.js` (lines 139-154) | Roster worker |
| `backend/lib/pubsub.js` | `ROSTER_UPDATED` event channel |

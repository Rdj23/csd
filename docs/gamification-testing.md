# Gamification & Analytics Data Verification - Postman Testing Guide

## Prerequisites

All `/api/*` endpoints require a JWT Bearer token (Google OAuth via `@clevertap.com` email).

### Step 1: Get Your JWT Token

You can grab the token from the browser:
1. Open the Support Dashboard in your browser
2. Open DevTools > Application > Local Storage
3. Copy the `token` value

Or from the Network tab — any API call will have the `Authorization: Bearer <token>` header.

Set this as a Postman variable:
- Variable name: `TOKEN`
- Value: `<your-jwt-token>`

### Step 2: Set Base URL

```
Variable: BASE_URL
Value: http://localhost:5000
```

---

## Date Range (applies to ALL endpoints below)

Every endpoint supports two ways to specify the date range:

**Option A: Quarter preset** (default)
```
?quarter=Q1_26
```

Available values: `Q1_26`, `Q1_26_W1`..`Q1_26_W13`, `Q1_26_M1`..`Q1_26_M3`

**Option B: Custom date range** (overrides quarter if both provided)
```
?startDate=2026-02-01&endDate=2026-02-28
```

Format: `YYYY-MM-DD`. `startDate` must be before `endDate`.

---

## API 1: Full Leaderboard (All Users)

**`GET /api/gamification`**

| Query Param | Required | Description |
|---|---|---|
| `quarter` | No (default: `Q1_26`) | Quarter preset |
| `startDate` | No | Custom start date `YYYY-MM-DD` |
| `endDate` | No | Custom end date `YYYY-MM-DD` |

```bash
# Quarter preset
curl --location 'http://localhost:5000/api/gamification?quarter=Q1_26' \
--header 'Authorization: Bearer {{TOKEN}}'

# Custom date range
curl --location 'http://localhost:5000/api/gamification?startDate=2026-02-01&endDate=2026-02-28' \
--header 'Authorization: Bearer {{TOKEN}}'
```

**What to verify:**
- `data.L1[]` and `data.L2[]` arrays contain all team members
- Each member has: `solved`, `productivity`, `csatPercent`, `positiveCSAT`, `avgRWT`, `avgIterations`, `frrPercent`
- `finalScore` and `rank` are calculated correctly
- L1 and L2 members are separated per `DESIGNATION_MAP`

---

## API 2: Individual User Stats (My Stats)

**`GET /api/gamification/my-stats`**

| Query Param | Required | Description |
|---|---|---|
| `email` | **Yes** | GST member email (e.g. `rohan.jadhav@clevertap.com`) |
| `quarter` | No (default: `Q1_26`) | Quarter preset |
| `startDate` | No | Custom start date `YYYY-MM-DD` |
| `endDate` | No | Custom end date `YYYY-MM-DD` |

```bash
# Quarter preset
curl --location 'http://localhost:5000/api/gamification/my-stats?quarter=Q1_26&email=rohan.jadhav@clevertap.com' \
--header 'Authorization: Bearer {{TOKEN}}'

# Custom date range
curl --location 'http://localhost:5000/api/gamification/my-stats?startDate=2026-03-01&endDate=2026-03-07&email=rohan.jadhav@clevertap.com' \
--header 'Authorization: Bearer {{TOKEN}}'
```

**What to verify:**
- `userData.solved` matches the ticket count you expect
- `userData.productivity` = `solved / daysWorked`
- `userData.csatPercent` = `positiveCSAT / (positiveCSAT + negativeCSAT) * 100`
- `userData.frrPercent` = FRR met tickets / total solved * 100
- Percentiles make sense relative to the leaderboard data

---

## API 3: Get Solved Tickets Per User (for data verification)

**`GET /api/gamification/my-stats/tickets`**

Returns every solved ticket with ticket ID and closed date behind a user's gamification score.

| Query Param | Required | Description |
|---|---|---|
| `email` | **Yes** | GST member email |
| `quarter` | No (default: `Q1_26`) | Quarter preset |
| `startDate` | No | Custom start date `YYYY-MM-DD` |
| `endDate` | No | Custom end date `YYYY-MM-DD` |

```bash
# Full quarter
curl --location 'http://localhost:5000/api/gamification/my-stats/tickets?quarter=Q1_26&email=rohan.jadhav@clevertap.com' \
--header 'Authorization: Bearer {{TOKEN}}'

# Specific week
curl --location 'http://localhost:5000/api/gamification/my-stats/tickets?startDate=2026-03-01&endDate=2026-03-07&email=rohan.jadhav@clevertap.com' \
--header 'Authorization: Bearer {{TOKEN}}'
```

**Response:**

```json
{
  "success": true,
  "quarter": "Q1_26",
  "dateRange": { "start": "2026-01-01T00:00:00.000Z", "end": "2026-03-31T23:59:59.000Z" },
  "owner": "Rohan",
  "totalSolved": 158,
  "totalNOC": 5,
  "tickets": [
    {
      "display_id": "SUP-12345",
      "title": "Issue with billing integration",
      "closed_date": "2026-03-05T14:30:00.000Z",
      "stage_name": "Solved",
      "account_name": "Acme Corp",
      "account_cohort": "Key",
      "csat": 2,
      "rwt": 4.2,
      "iterations": 2,
      "frr": 1
    }
  ],
  "nocTickets": [
    {
      "display_id": "SUP-99999",
      "title": "NOC: Outage alert",
      "closed_date": "2026-02-10T08:00:00.000Z",
      "stage_name": "Resolved",
      "account_name": "BigCo",
      "csat": 2
    }
  ]
}
```

**What to verify:**
- `totalSolved` matches `userData.solved` from the my-stats API
- Each ticket has `display_id` and `closed_date` so you can trace it in DevRev
- `nocTickets` are listed separately — they only affect CSAT, not solved count
- CSAT values: `0` = no response, `1` = negative, `2` = positive
- `frr`: `0` = not met, `1` = met

---

## API 4: Analytics Ticket Drill-Down (Centralized)

**`GET /api/tickets/analytics/drill-down`**

A single endpoint to get ticket-level RWT, FRR, CSAT, iterations data filtered by individual, team, or all of GST.

| Query Param | Required | Description |
|---|---|---|
| `scope` | No (default: `all`) | `individual`, `team`, or `all` |
| `email` | When scope=individual | GST member email |
| `owner` | When scope=individual | GST member name (alternative to email) |
| `team` | When scope=team | Team lead name: `Rohan`, `Shweta`, `Harsh`, `Aditya`, `Debashish`, `Tuaha Khan`, `Adish` |
| `quarter` | No (default: `Q1_26`) | Quarter preset |
| `startDate` | No | Custom start date `YYYY-MM-DD` |
| `endDate` | No | Custom end date `YYYY-MM-DD` |

### 4a. Individual user (by email)

```bash
curl --location 'http://localhost:5000/api/tickets/analytics/drill-down?scope=individual&email=rohan.jadhav@clevertap.com&quarter=Q1_26' \
--header 'Authorization: Bearer {{TOKEN}}'
```

### 4b. Individual user (by owner name)

```bash
curl --location 'http://localhost:5000/api/tickets/analytics/drill-down?scope=individual&owner=Archie&quarter=Q1_26' \
--header 'Authorization: Bearer {{TOKEN}}'
```

### 4c. Team (all members under a team lead)

```bash
curl --location 'http://localhost:5000/api/tickets/analytics/drill-down?scope=team&team=Rohan&quarter=Q1_26' \
--header 'Authorization: Bearer {{TOKEN}}'
```

### 4d. All GST members

```bash
curl --location 'http://localhost:5000/api/tickets/analytics/drill-down?scope=all&quarter=Q1_26' \
--header 'Authorization: Bearer {{TOKEN}}'
```

### 4e. Custom date range (works with any scope)

```bash
curl --location 'http://localhost:5000/api/tickets/analytics/drill-down?scope=team&team=Shweta&startDate=2026-02-01&endDate=2026-02-28' \
--header 'Authorization: Bearer {{TOKEN}}'
```

### Response structure

```json
{
  "success": true,
  "quarter": "Q1_26",
  "scope": "Team Rohan",
  "dateRange": { "start": "...", "end": "..." },
  "totalSolved": 420,
  "totalNOC": 12,
  "ownerSummary": [
    {
      "owner": "Rohan",
      "team": "Rohan",
      "solved": 158,
      "avgRWT": 4.2,
      "avgFRT": 1.8,
      "avgIterations": 1.65,
      "frrPercent": 94,
      "csatPercent": 87,
      "positiveCSAT": 15,
      "negativeCSAT": 2
    }
  ],
  "tickets": [
    {
      "display_id": "SUP-12345",
      "title": "Billing integration issue",
      "closed_date": "2026-03-05T14:30:00.000Z",
      "created_date": "2026-03-01T09:00:00.000Z",
      "stage_name": "Solved",
      "owner": "Rohan",
      "account_name": "Acme Corp",
      "account_cohort": "Key",
      "csat": 2,
      "rwt": 4.2,
      "frt": 1.1,
      "iterations": 2,
      "frr": 1
    }
  ],
  "nocTickets": [
    {
      "display_id": "SUP-99999",
      "title": "NOC: Outage alert",
      "closed_date": "2026-02-10T08:00:00.000Z",
      "owner": "Rohan",
      "account_name": "BigCo",
      "csat": 2,
      "stage_name": "Resolved"
    }
  ]
}
```

**What to verify:**
- `ownerSummary` gives you per-person aggregated stats — cross-check with gamification leaderboard
- `tickets` array has every raw ticket with `rwt`, `frt`, `frr`, `csat`, `iterations`
- `nocTickets` listed separately (only affect CSAT)
- Switch between scopes to compare individual vs team vs org-wide numbers

---

## Error Responses

All endpoints return consistent error responses. Here's what to expect:

### Missing/invalid JWT token
```json
{ "error": "Unauthorized: No token provided" }          // 401
{ "error": "Unauthorized: Invalid or expired token" }    // 401
```

### Validation errors (Zod)
```json
{
  "success": false,
  "error": {
    "message": "Validation failed",
    "details": [
      { "path": "query.email", "message": "Valid email is required" },
      { "path": "query.startDate", "message": "Use YYYY-MM-DD format" }
    ]
  }
}
```

### Invalid email (not a GST member)
```json
{ "success": false, "error": { "message": "Unauthorized: Not a GST user" } }   // 403
```

### Bad date range
```json
{ "success": false, "error": { "message": "startDate must be before endDate." } }  // 400
{ "success": false, "error": { "message": "Invalid startDate or endDate. Use YYYY-MM-DD format." } }  // 400
```

### Missing required params
```json
// scope=individual without email or owner
{ "success": false, "error": { "message": "email or owner is required for individual scope" } }  // 400

// scope=team without team param
{ "success": false, "error": { "message": "team param is required for team scope (e.g. Rohan, Shweta, Harsh)" } }  // 400

// Unknown team name
{ "success": false, "error": { "message": "Unknown team: XYZ. Valid: Rohan, Shweta, Harsh, Aditya, Debashish, Tuaha, Adish" } }  // 400
```

### Rate limiting
```json
{ "error": "Too many requests, please try again later" }  // 429
```

---

## Bonus: MongoDB Shell Queries (for direct DB verification)

```javascript
// Count solved tickets for a user (should match totalSolved above)
db.analyticstickets.countDocuments({
  owner: "Rohan",
  closed_date: {
    $gte: ISODate("2026-01-01T00:00:00Z"),
    $lte: ISODate("2026-03-31T23:59:59Z")
  },
  is_noc: { $ne: true }
})
```

```javascript
// CSAT breakdown (includes NOC tickets)
db.analyticstickets.aggregate([
  {
    $match: {
      owner: "Rohan",
      closed_date: {
        $gte: ISODate("2026-01-01T00:00:00Z"),
        $lte: ISODate("2026-03-31T23:59:59Z")
      }
    }
  },
  {
    $group: {
      _id: null,
      total: { $sum: 1 },
      positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
      negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
      noCSAT: { $sum: { $cond: [{ $eq: ["$csat", 0] }, 1, 0] } }
    }
  }
])
```

---

## Verification Checklist

For each user, cross-check these:

| Metric | How to Verify |
|---|---|
| `solved` | Count of non-NOC tickets with `closed_date` in quarter range |
| `productivity` | `solved / daysWorked` (daysWorked comes from roster) |
| `csatPercent` | `positiveCSAT / (positiveCSAT + negativeCSAT) * 100` — **includes NOC tickets** |
| `positiveCSAT` | Count where `csat == 2` — **includes NOC tickets** |
| `avgRWT` | Average of `rwt` where `rwt > 0` — excludes NOC |
| `avgIterations` | Average of `iterations` where `iterations > 0` — excludes NOC |
| `frrPercent` | Count where `frr == 1` / total solved * 100 — excludes NOC |

**Important data nuances:**
- General metrics (solved, productivity, RWT, iterations, FRR) **exclude** NOC tickets (`is_noc: true`)
- CSAT metrics (csatPercent, positiveCSAT) **include** NOC tickets
- `closed_date` is the primary filter — uses `actual_close_date` from DevRev (fallback: `modified_date`)
- Tickets with `owner` as `null` or `""` are excluded

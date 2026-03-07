# Support Dashboard - External API Documentation

Access GST Support analytics data from external projects using API keys.

---

## Authentication

All requests require an API key in the `X-API-Key` header.

```
X-API-Key: csd_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

To get an API key, contact the Support Dashboard admin (Rohan). Keys are scoped — for these endpoints you need the `read:external` scope.

---

## Base URL

```
https://csd-backend-ljzq.onrender.com/api
```

---

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/external/csat` | Per-user CSAT breakdown (who got how many) |
| GET | `/external/analytics` | Overall analytics summary (all metrics) |

---

## Common Query Parameters

Both endpoints accept the same date filtering:

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `quarter` | No | `Q1_26` | Quarter preset (see values below) |
| `startDate` | No | — | Custom start date (`YYYY-MM-DD`). Overrides `quarter` |
| `endDate` | No | — | Custom end date (`YYYY-MM-DD`). Must be used with `startDate` |

> When `startDate` + `endDate` are provided, they take priority over `quarter`. Max range: 365 days.

### Quarter Values

| Value | Period |
|-------|--------|
| `Q1_26` | Jan 1 – Mar 31, 2026 (full quarter) |
| `Q1_26_M1` | January 2026 |
| `Q1_26_M2` | February 2026 |
| `Q1_26_M3` | March 2026 |
| `Q1_26_W1` | Jan 1–4 |
| `Q1_26_W2` | Jan 5–11 |
| `Q1_26_W3` | Jan 12–18 |
| `Q1_26_W4` | Jan 19–25 |
| `Q1_26_W5` | Jan 26 – Feb 1 |
| `Q1_26_W6` | Feb 2–8 |
| `Q1_26_W7` | Feb 9–15 |
| `Q1_26_W8` | Feb 16–22 |
| `Q1_26_W9` | Feb 23 – Mar 1 |
| `Q1_26_W10` | Mar 2–8 |
| `Q1_26_W11` | Mar 9–15 |
| `Q1_26_W12` | Mar 16–22 |
| `Q1_26_W13` | Mar 23–31 |

---

## 1. CSAT Breakdown

**`GET /external/csat`**

Returns per-user CSAT data — who got how many positive and negative ratings.

### Extra Parameters

| Param | Required | Description |
|-------|----------|-------------|
| `email` | No | Filter to a single GST user (e.g. `rohan.jadhav@clevertap.com`) |

### Examples

```bash
# Full quarter — all users
curl 'https://csd-backend-ljzq.onrender.com/api/external/csat?quarter=Q1_26' \
  -H 'X-API-Key: csd_live_your_key_here'

# February only
curl 'https://csd-backend-ljzq.onrender.com/api/external/csat?quarter=Q1_26_M2' \
  -H 'X-API-Key: csd_live_your_key_here'

# Custom date range
curl 'https://csd-backend-ljzq.onrender.com/api/external/csat?startDate=2026-02-01&endDate=2026-03-07' \
  -H 'X-API-Key: csd_live_your_key_here'

# Single user
curl 'https://csd-backend-ljzq.onrender.com/api/external/csat?quarter=Q1_26&email=rohan.jadhav@clevertap.com' \
  -H 'X-API-Key: csd_live_your_key_here'
```

### Response

```json
{
  "success": true,
  "quarter": "Q1_26",
  "date_range": {
    "start": "2026-01-01T00:00:00.000Z",
    "end": "2026-03-31T23:59:59.000Z"
  },
  "overall": {
    "total_rated": 210,
    "positive": 185,
    "negative": 25,
    "csat_percent": 88
  },
  "users": [
    {
      "owner": "Rohan",
      "team": "Rohan",
      "positive_csat": 15,
      "negative_csat": 2,
      "total_rated": 17,
      "csat_percent": 88
    },
    {
      "owner": "Archie",
      "team": "Shweta",
      "positive_csat": 12,
      "negative_csat": 1,
      "total_rated": 13,
      "csat_percent": 92
    }
  ]
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `overall.total_rated` | number | Total tickets that received a CSAT rating |
| `overall.positive` | number | Total positive CSAT count |
| `overall.negative` | number | Total negative CSAT count |
| `overall.csat_percent` | number | Overall CSAT % (0–100) |
| `users[].owner` | string | Team member name |
| `users[].team` | string | Team lead name |
| `users[].positive_csat` | number | Positive ratings received |
| `users[].negative_csat` | number | Negative ratings received |
| `users[].total_rated` | number | Total rated tickets |
| `users[].csat_percent` | number | Individual CSAT % (0–100) |

> CSAT includes both regular and NOC tickets. `csat = 2` means positive, `csat = 1` means negative. Tickets with no response (`csat = 0`) are excluded.

---

## 2. Analytics Summary

**`GET /external/analytics`**

Returns overall analytics numbers + per-owner breakdown with all key metrics.

### Examples

```bash
# Full quarter
curl 'https://csd-backend-ljzq.onrender.com/api/external/analytics?quarter=Q1_26' \
  -H 'X-API-Key: csd_live_your_key_here'

# Weekly — Week 10
curl 'https://csd-backend-ljzq.onrender.com/api/external/analytics?quarter=Q1_26_W10' \
  -H 'X-API-Key: csd_live_your_key_here'

# Custom date range
curl 'https://csd-backend-ljzq.onrender.com/api/external/analytics?startDate=2026-02-15&endDate=2026-03-07' \
  -H 'X-API-Key: csd_live_your_key_here'
```

### Response

```json
{
  "success": true,
  "quarter": "Q1_26",
  "date_range": {
    "start": "2026-01-01T00:00:00.000Z",
    "end": "2026-03-31T23:59:59.000Z"
  },
  "summary": {
    "total_solved": 1842,
    "avg_rwt": 4.15,
    "avg_frt": 1.62,
    "avg_iterations": 1.58,
    "frr_percent": 92,
    "csat_positive": 185,
    "csat_negative": 25,
    "csat_percent": 88
  },
  "per_owner": [
    {
      "owner": "Rohan",
      "team": "Rohan",
      "solved": 158,
      "avg_rwt": 4.2,
      "avg_frt": 1.8,
      "avg_iterations": 1.65,
      "frr_percent": 94,
      "positive_csat": 15,
      "negative_csat": 2,
      "csat_percent": 88
    },
    {
      "owner": "Archie",
      "team": "Shweta",
      "solved": 142,
      "avg_rwt": 3.8,
      "avg_frt": 1.2,
      "avg_iterations": 1.45,
      "frr_percent": 91,
      "positive_csat": 12,
      "negative_csat": 1,
      "csat_percent": 92
    }
  ]
}
```

### Response Fields

**`summary` — Team-wide aggregated numbers**

| Field | Type | Description |
|-------|------|-------------|
| `total_solved` | number | Total tickets solved (excludes NOC) |
| `avg_rwt` | number | Average Response Wait Time in hours |
| `avg_frt` | number | Average First Response Time in hours |
| `avg_iterations` | number | Average back-and-forth iterations per ticket |
| `frr_percent` | number | First Response Rate % (0–100) |
| `csat_positive` | number | Total positive CSAT (includes NOC) |
| `csat_negative` | number | Total negative CSAT (includes NOC) |
| `csat_percent` | number | Overall CSAT % (0–100) |

**`per_owner[]` — Same metrics broken down per person**

| Field | Type | Description |
|-------|------|-------------|
| `owner` | string | Team member name |
| `team` | string | Team lead name |
| `solved` | number | Tickets solved (excludes NOC) |
| `avg_rwt` | number | Average RWT in hours |
| `avg_frt` | number | Average FRT in hours |
| `avg_iterations` | number | Average iterations |
| `frr_percent` | number | FRR % (0–100) |
| `positive_csat` | number | Positive CSAT count |
| `negative_csat` | number | Negative CSAT count |
| `csat_percent` | number | Individual CSAT % (0–100) |

---

## Metrics Glossary

| Metric | What it means |
|--------|---------------|
| **RWT** (Response Wait Time) | How long (hours) the customer waited for a response |
| **FRT** (First Response Time) | How long (hours) until the first reply was sent |
| **FRR** (First Response Rate) | Whether the first response was sent within SLA. 1 = met, 0 = missed |
| **Iterations** | Number of back-and-forth messages before resolution |
| **CSAT** | Customer satisfaction: 2 = positive, 1 = negative, 0 = no response |
| **NOC** | Network Operations Center tickets — only count towards CSAT, excluded from RWT/FRT/FRR/iterations/solved |

---

## Error Responses

### 401 — Invalid or expired API key
```json
{ "error": "Unauthorized: Invalid or revoked API key" }
```

### 403 — Missing scope
```json
{ "error": "Forbidden: API key requires 'read:external' scope" }
```

### 400 — Bad request
```json
{
  "success": false,
  "error": { "message": "startDate must be before endDate." }
}
```

### 429 — Rate limited
```json
{ "error": "Too many API key attempts, please try again later" }
```

---

## Rate Limits

| Limit | Window |
|-------|--------|
| 20 requests | Per 15 minutes (API key) |
| 1500 requests | Per 15 minutes (general) |

The API key-specific limit (20/15min) applies first. If you need higher limits, contact admin.

---

## Important Notes

- Data refreshes daily. `closed_date` reflects when the ticket was actually resolved.
- NOC tickets only affect CSAT. They are excluded from solved count, RWT, FRT, iterations, and FRR.
- The API key is **read-only**. It cannot modify any data.
- Keep your API key secure — store it in environment variables, never commit it to code.
- If your key is compromised, contact admin to revoke it immediately.

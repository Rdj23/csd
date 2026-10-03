# Support Dashboard MCP Server

A local [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the
support-dashboard REST API to Claude (Claude Desktop / claude.ai), so you can query dashboard
data in plain English — *"how many open tickets does Rohan have?"*, *"my points this week"*,
*"who's leading the leaderboard?"* — instead of clicking through the UI.

It is a **thin translation layer**: each tool maps to an `/api/*` endpoint that the React
dashboard already calls. The MCP adds nothing to the database — it only authenticates, filters,
and trims responses into a Claude-friendly shape.

---

## Architecture at a glance

```
Claude Desktop ──stdio──▶ mcp/server.js ──HTTPS (X-API-Key)──▶ dashboard backend (/api/*)
                                                                      │
                                                              same backend the
                                                              React dashboard uses
```

- **Transport:** stdio. Claude Desktop spawns `server.js` as a child process and talks to it
  over stdin/stdout. There is no network port and no separate process to keep running.
- **Auth:** every backend call sends an `X-API-Key` header. The key is an admin-issued API key
  with `read:all` scope (see *Backend prerequisites* below).
- **Language:** Node.js (ESM), `@modelcontextprotocol/sdk`. Only two runtime deps.

---

## Files

| File              | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `server.js`       | The MCP server — tool definitions + request handlers.            |
| `package.json`    | Deps (`@modelcontextprotocol/sdk`, `dotenv`) and `start` script. |
| `.env`            | Local config (base URL, API key, default email). **Gitignored.** |
| `.env.example`    | Template to copy into `.env`.                                    |
| `.gitignore`      | Excludes `node_modules` and `.env`.                              |

---

## Setup

### 1. Install dependencies

```bash
cd mcp
npm install
```

### 2. Create your `.env`

```bash
cp .env.example .env
```

Then fill in the three values (`.env` is gitignored — never commit it):

| Variable               | Meaning                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `DASHBOARD_BASE_URL`   | Where the backend lives. Local: `http://localhost:5000`. Hosted: your Render URL. |
| `DASHBOARD_API_KEY`    | Raw API key with `read:all` scope (see below). Treat like a password.   |
| `DASHBOARD_USER_EMAIL` | Default email used by `get_my_*` tools when none is passed in.          |

> The server **refuses to start** if `DASHBOARD_API_KEY` is missing — by design, so it never
> silently runs unauthenticated.

> `.env` is loaded relative to `server.js`'s own directory (via `import.meta.url`), **not**
> `process.cwd()`. This matters because Claude Desktop spawns the script with an arbitrary
> working directory, so a cwd-relative lookup would miss the file.

### 3. Backend prerequisites

The MCP needs an API key minted by the backend admin endpoint with read scope:

```
POST /api/admin/api-keys     body: { scopes: ["read:all"] }
```

Copy the **raw key** it returns into `DASHBOARD_API_KEY`.

> **Rate limit gotcha:** the backend caps API-key requests at **20 requests / 15 min**
> (`backend/middleware/auth.js`, the `max: 20` limiter). Heavy interactive use can trip a `429`.
> If that happens for a trusted MCP key, bump `max` for that limiter.

### 4. Register the server with Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` and add an entry under
`mcpServers` (use the **absolute path** to `server.js`):

```json
{
  "mcpServers": {
    "support-dashboard": {
      "command": "node",
      "args": ["/absolute/path/to/support-dashboard/mcp/server.js"]
    }
  }
}
```

Then **fully quit Claude Desktop** (Cmd+Q — closing the window is not enough) and relaunch.
MCP servers are only initialized on a cold start.

---

## Tools

All tools return JSON as text. Date arguments are `YYYY-MM-DD`. The `get_my_*` tools default to
`DASHBOARD_USER_EMAIL` when no `email` is passed.

| Tool                          | Backend endpoint                       | What it answers                                              |
| ----------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `get_live_stats`              | `/api/tickets/live-stats`              | Live ticket counts by status over a date range.             |
| `get_active_tickets`          | `/api/tickets` (filtered locally)      | Currently unsolved tickets, by stage / owner.               |
| `get_tickets_by_range`        | `/api/tickets/by-range`                | created / solved / reopened counts over a range.            |
| `get_tickets_by_date`         | `/api/tickets/by-date`                 | Ticket details for one specific date.                       |
| `get_ticket_drilldown`        | `/api/tickets/drilldown`               | Open-queue breakdown (owners, accounts, ages) for a date.   |
| `get_my_gamification_stats`   | `/api/gamification/my-stats`           | Caller's points, rank, co-op count, comments, streak.       |
| `get_my_tickets`              | `/api/gamification/my-stats/tickets`   | Tickets that earned the caller points.                      |
| `get_gamification_leaderboard`| `/api/gamification`                    | Team leaderboard by co-op points (key/non-key cohorts).     |
| `get_activity_summary`        | `/api/activity/summary`                | Internal vs external comment activity across users.         |
| `get_activity_leaderboard`    | `/api/activity/leaderboard`            | Activity leaderboard, ranked by external co-op comments.    |
| `get_activity_daily`          | `/api/activity/daily`                  | Daily internal/external/co-op comment rollup.               |

### Ticket vocabulary (important)

The dashboard uses **team-specific terms** that map to DevRev stage names. The
`get_active_tickets` tool description teaches Claude this mapping so it can translate a user's
phrasing into the right `stages` filter:

| Team term  | DevRev stage             | Meaning                                          |
| ---------- | ------------------------ | ------------------------------------------------ |
| `open`     | `Waiting on Assignee`    | Queued — ball in the CleverTap engineer's court. |
| `pending`  | `Awaiting Customer Reply`| Parked — ball in the customer's court.           |
| `on hold`  | `Waiting on CleverTap`   | Blocked by something internal at CleverTap.      |

So *"how many open tickets does Rohan have"* becomes
`owner_email='rohan.jadhav@clevertap.com', stages=['Waiting on Assignee']`.

### Why `get_active_tickets` is special

It's the only tool with non-trivial logic. The raw `/api/tickets` endpoint returns 4000+ records.
If handed the full payload, Claude saturates its context and hallucinates. So this tool:

1. Drops solved/resolved tickets.
2. Filters by `stages` and `owner_email` if given.
3. Slices to `limit` (default 50) and **slims each row to ~10 fields** Claude actually needs.
4. Returns counts (`total_active_in_dashboard`, `matched`, `returned`) plus the slim list.

**Design rule for any new tool: filter and trim aggressively in the MCP layer before returning
to Claude.** Never pass raw bulk payloads through.

---

## Extending it

To add a tool:

1. Append a `{ name, description, inputSchema }` object to the `TOOLS` array.
   - The **description is a prompt** — Claude routes calls based purely on it. Be explicit about
     *when* to use the tool and embed any vocabulary it needs (see the ticket-stage mapping above).
2. Add a matching `case` in the `CallToolRequestSchema` handler that calls `api(path, params)`.
3. Trim the response down to what's useful.
4. Cmd+Q and relaunch Claude Desktop to pick up the change.

---

## Troubleshooting

| Symptom                              | Check                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| Server won't start                   | `DASHBOARD_API_KEY` missing from `.env` — the server exits on purpose.            |
| Tool calls return `429`              | Backend rate limit (20 req / 15 min for API keys). Slow down or bump the limiter. |
| Changes not reflected                | You didn't fully quit Claude Desktop. Cmd+Q, then relaunch.                        |
| Empty / odd results                  | Confirm `DASHBOARD_BASE_URL` points at a reachable backend.                       |
| Anything else                        | Tail the log: `~/Library/Logs/Claude/mcp-server-support-dashboard.log`.           |

---

## Run it standalone (sanity check)

```bash
DASHBOARD_API_KEY=... DASHBOARD_BASE_URL=http://localhost:5000 npm start
```

It will print `[dashboard-mcp] connected over stdio` and wait for MCP protocol messages on stdin.
This only confirms it boots; real exercise happens through Claude Desktop.

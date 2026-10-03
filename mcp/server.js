#!/usr/bin/env node
// dashboard-mcp: stdio MCP server that exposes the support-dashboard API to Claude.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

// Load .env from the directory of THIS file, not from process.cwd().
// Claude Desktop spawns this script with its own cwd, so a relative lookup would miss .env.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const BASE_URL = process.env.DASHBOARD_BASE_URL || "http://localhost:5000";
const API_KEY  = process.env.DASHBOARD_API_KEY;
const MY_EMAIL = process.env.DASHBOARD_USER_EMAIL || "rohan.jadhav@clevertap.com";

if (!API_KEY) {
  console.error("[dashboard-mcp] Missing DASHBOARD_API_KEY env var. Refusing to start.");
  process.exit(1);
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

async function api(path, params = {}) {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { "X-API-Key": API_KEY, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} on ${path}: ${text.slice(0, 400)}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

// Tool descriptions are prompts — Claude routes by them. Be explicit about WHEN to use each.
const TOOLS = [
  {
    name: "get_live_stats",
    description:
      "Get live ticket counts grouped by status (open, work_in_progress, awaiting_customer, etc.) for a date range. " +
      "Use for: 'how many open tickets', 'live ticket stats', 'current ticket counts', 'ticket health snapshot'.",
    inputSchema: {
      type: "object",
      properties: {
        start:  { type: "string", description: "YYYY-MM-DD start date. Defaults to 7 days ago." },
        end:    { type: "string", description: "YYYY-MM-DD end date. Defaults to today." },
        owners: { type: "string", description: "Comma-separated owner emails to filter by (optional)." },
        region: { type: "string", description: "Region filter (optional)." },
      },
    },
  },
  {
    name: "get_active_tickets",
    description:
      "Get currently unsolved tickets from the support dashboard. " +
      "CRITICAL VOCABULARY — this dashboard uses team-specific terms that map to DevRev stage names: " +
      "  • 'open'    → stage 'Waiting on Assignee'      (queued, ball in CleverTap engineer's court, not yet picked up) " +
      "  • 'pending' → stage 'Awaiting Customer Reply'  (parked, ball in customer's court) " +
      "  • 'on hold' → stage 'Waiting on CleverTap'     (blocked by something internal at CleverTap) " +
      "ALWAYS pass `stages` mapped from the user's term, and `owner_email` when asked about a specific person. " +
      "Examples: " +
      "  - 'how many open tickets does Rohan have' → owner_email='rohan.jadhav@clevertap.com', stages=['Waiting on Assignee'] " +
      "  - 'my pending tickets'                    → owner_email=<user>, stages=['Awaiting Customer Reply'] " +
      "  - 'tickets on hold'                       → stages=['Waiting on CleverTap'] " +
      "  - 'all unsolved'                          → omit stages.",
    inputSchema: {
      type: "object",
      properties: {
        owner_email: {
          type: "string",
          description: "Filter to tickets owned by this email (e.g. rohan.jadhav@clevertap.com).",
        },
        stages: {
          type: "array",
          items: { type: "string" },
          description:
            "Stage names to include. Valid values: 'Waiting on Assignee' (= open), " +
            "'Awaiting Customer Reply' (= pending), 'Waiting on CleverTap' (= on hold). " +
            "If omitted, returns all unsolved (excludes Solved/Resolved).",
        },
        limit: {
          type: "number",
          description: "Max tickets to return (default 50). Use this to keep responses small.",
        },
      },
    },
  },
  {
    name: "get_tickets_by_range",
    description:
      "Get ticket counts/details by metric (created, solved, reopened) over a date range. " +
      "Use for: 'how many tickets solved last 7 days', 'tickets created this week', 'reopen counts last month'.",
    inputSchema: {
      type: "object",
      properties: {
        start:  { type: "string", description: "YYYY-MM-DD" },
        end:    { type: "string", description: "YYYY-MM-DD" },
        metric: { type: "string", description: "created | solved | reopened. Defaults to 'solved'." },
        owners: { type: "string", description: "Comma-separated owner emails (optional)." },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "get_tickets_by_date",
    description:
      "Get ticket-level details for one specific date. Use for: 'tickets solved on 2026-05-08', 'today's solved tickets', 'yesterday's reopens'.",
    inputSchema: {
      type: "object",
      properties: {
        date:   { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        metric: { type: "string", description: "created | solved | reopened. Defaults to 'solved'." },
        owners: { type: "string" },
      },
    },
  },
  {
    name: "get_ticket_drilldown",
    description:
      "Get the open-ticket drilldown for a specific date — owners, accounts, ages, statuses. " +
      "Use for: 'who owns the oldest open ticket', 'breakdown of open queue by account'.",
    inputSchema: {
      type: "object",
      properties: {
        date:   { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        metric: { type: "string", description: "Optional drilldown metric." },
        type:   { type: "string", description: "Optional drilldown type." },
      },
    },
  },
  {
    name: "get_my_gamification_stats",
    description:
      "Get the caller's personal gamification stats — points earned, rank, co-op count, internal/external comments, streak — for a date range. " +
      "Use for: 'my stats today', 'my points this week', 'how am I doing', 'my gamification this quarter'.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        endDate:   { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        email:     { type: "string", description: "Override user email (defaults to configured user)." },
        quarter:   { type: "string", description: "Quarter key like Q2-2026 (optional, takes precedence over dates)." },
      },
    },
  },
  {
    name: "get_my_tickets",
    description:
      "Get the caller's tickets that contributed to their gamification points in a date range. " +
      "Use for: 'tickets that earned me points this week', 'my co-op contributions today'.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string" },
        endDate:   { type: "string" },
        email:     { type: "string" },
        quarter:   { type: "string" },
      },
    },
  },
  {
    name: "get_gamification_leaderboard",
    description:
      "Get the team-wide gamification leaderboard ranked by co-op points, with breakdown by key/non-key account cohorts. " +
      "Use for: 'who is leading the leaderboard', 'top performers this quarter', 'team standings'.",
    inputSchema: {
      type: "object",
      properties: {
        quarter:   { type: "string", description: "e.g. Q2-2026. Defaults to current quarter." },
        startDate: { type: "string", description: "YYYY-MM-DD (alternative to quarter)." },
        endDate:   { type: "string", description: "YYYY-MM-DD (alternative to quarter)." },
      },
    },
  },
  {
    name: "get_activity_summary",
    description:
      "Get aggregated comment activity (internal vs external counts, co-op activity) across users. " +
      "Use for: 'team activity overview', 'who is most active right now', 'comment volume snapshot'.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_activity_leaderboard",
    description:
      "Get the activity-based leaderboard (ranked by external co-op comments). " +
      "Use for: 'co-op leaderboard', 'most helpful members this period', 'who's helping the most'.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_activity_daily",
    description:
      "Get daily comment activity rollup — internal/external/co-op counts per day. " +
      "Use for: 'my daily activity trend', 'comment volume over time', 'activity history for a user'.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Filter by user email (optional)." },
      },
    },
  },
];

const server = new Server(
  { name: "support-dashboard", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let data;
    switch (name) {
      case "get_live_stats":
        data = await api("/api/tickets/live-stats", {
          start:  args.start  || daysAgo(7),
          end:    args.end    || today(),
          owners: args.owners,
          region: args.region,
        });
        break;
      case "get_active_tickets": {
        const raw = await api("/api/tickets");
        const all = raw?.tickets || [];
        const SOLVED = new Set(["Solved", "Resolved", "resolved"]);
        const wantStages = Array.isArray(args.stages) && args.stages.length ? new Set(args.stages) : null;
        const wantEmail = args.owner_email?.toLowerCase();
        const limit = Number(args.limit) || 50;

        const filtered = all.filter((t) => {
          const stage = t?.stage?.name;
          if (!stage || SOLVED.has(stage)) return false;
          if (wantStages && !wantStages.has(stage)) return false;
          if (wantEmail) {
            const owners = Array.isArray(t.owned_by) ? t.owned_by : [];
            if (!owners.some((o) => (o.email || "").toLowerCase() === wantEmail)) return false;
          }
          return true;
        });

        const slim = filtered.slice(0, limit).map((t) => ({
          id: t.display_id,
          title: t.title,
          stage: t?.stage?.name,
          severity: t.severity,
          account: typeof t.account === "object" ? t.account?.display_name || t.account?.name : t.account,
          owners: (t.owned_by || []).map((o) => o.email || o.display_name).filter(Boolean),
          created: t.created_date,
          modified: t.modified_date,
          isZendesk: !!t.isZendesk,
        }));

        data = {
          total_active_in_dashboard: all.filter((t) => !SOLVED.has(t?.stage?.name)).length,
          matched: filtered.length,
          returned: slim.length,
          filters_applied: {
            stages: args.stages || "all unsolved",
            owner_email: args.owner_email || null,
          },
          tickets: slim,
        };
        break;
      }
      case "get_tickets_by_range":
        data = await api("/api/tickets/by-range", {
          start: args.start,
          end:   args.end,
          metric: args.metric || "solved",
          owners: args.owners,
        });
        break;
      case "get_tickets_by_date":
        data = await api("/api/tickets/by-date", {
          date:   args.date || today(),
          metric: args.metric || "solved",
          owners: args.owners,
        });
        break;
      case "get_ticket_drilldown":
        data = await api("/api/tickets/drilldown", {
          date:   args.date || today(),
          metric: args.metric,
          type:   args.type,
        });
        break;
      case "get_my_gamification_stats":
        data = await api("/api/gamification/my-stats", {
          email:     args.email     || MY_EMAIL,
          startDate: args.startDate || (args.quarter ? undefined : today()),
          endDate:   args.endDate   || (args.quarter ? undefined : today()),
          quarter:   args.quarter,
        });
        break;
      case "get_my_tickets":
        data = await api("/api/gamification/my-stats/tickets", {
          email:     args.email     || MY_EMAIL,
          startDate: args.startDate || (args.quarter ? undefined : today()),
          endDate:   args.endDate   || (args.quarter ? undefined : today()),
          quarter:   args.quarter,
        });
        break;
      case "get_gamification_leaderboard":
        data = await api("/api/gamification", {
          quarter:   args.quarter,
          startDate: args.startDate,
          endDate:   args.endDate,
        });
        break;
      case "get_activity_summary":
        data = await api("/api/activity/summary");
        break;
      case "get_activity_leaderboard":
        data = await api("/api/activity/leaderboard");
        break;
      case "get_activity_daily":
        data = await api("/api/activity/daily", { email: args.email });
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Dashboard MCP error: ${err.message}` }],
      isError: true,
    };
  }
});

await server.connect(new StdioServerTransport());
console.error("[dashboard-mcp] connected over stdio");

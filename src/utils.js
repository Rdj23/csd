import { AlertOctagon, AlertTriangle, CheckCircle, Smile, Frown } from "lucide-react";
import { differenceInHours, differenceInMinutes, parseISO,differenceInDays } from "date-fns";
// --- TEAM CONFIGURATION ---
export const TEAM_GROUPS = {
  "Rohan": { "DEVU-1111": "Rohan", "DEVU-550": "Anurag", "DEVU-1115": "Shreya", "DEVU-1087": "Shubhankar" },
  "Shweta": { "DEVU-1113": "Shweta", "DEVU-1114": "Archie", "DEVU-736": "Musaveer" },
  "Harsh": { "DEVU-1098": "Harsh", "DEVU-1072": "Neha", "DEVU-1122": "Vaibhav" },
  "Aditya": { "DEVU-5": "Aditya", "DEVU-2611": "Rishabh", "DEVU-4": "Nikita", "DEVU-1110": "Shreyas" },
  "Debashish": { "DEVU-1102": "Debashish", "DEVU-1076": "Adarsh", "DEVU-689": "Tamanna" },
  "Adish": { "DEVU-1121": "Adish" }
};

export const TEAM_REGION_MAP = {
  "Adish": ["South America", "North America"]
};

export const FLAT_TEAM_MAP = Object.values(TEAM_GROUPS).reduce((acc, group) => ({ ...acc, ...group }), {});

// Map email addresses to GST names
export const EMAIL_TO_NAME_MAP = {
  "rohan.jadhav@clevertap.com": "Rohan",
  "archie@clevertap.com": "Archie",
  "neha.yadav@clevertap.com": "Neha",
  "shreya.khale@clevertap.com": "Shreya",
  "vaibhav.agarwal@clevertap.com": "Vaibhav",
  "adarsh.dubey@clevertap.com": "Adarsh",
  "shubhankar@clevertap.com": "Shubhankar",
  "musaveer@clevertap.com": "Musaveer",
  "anurag.ghatge@clevertap.com": "Anurag",
  "debashish@clevertap.com": "Debashish",
  "aditya.mishra@clevertap.com": "Aditya",
  "shweta.more@clevertap.com": "Shweta",
  "nikita.narwani@clevertap.com": "Nikita",
  "harsh.singh@clevertap.com": "Harsh",
  "rishabh.j@clevertap.com": "Rishabh",
  "tamanna@clevertap.com": "Tamanna",
  "shreyas.naikwadi@clevertap.com": "Shreyas",
  "adish@clevertap.com": "Adish",
};

export const calculateResolutionTime = (createdISO, closedISO) => {
  if (!createdISO || !closedISO) return "N/A";
  
  const start = parseISO(createdISO);
  const end = parseISO(closedISO); // 2025-12-16T10:39:13.007Z
  
  const totalMinutes = differenceInMinutes(end, start);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}h ${minutes}m`;
};

export const STAGE_MAP = {
  "Waiting on Assignee": { label: "Open", color: "bg-blue-50 text-blue-700 border-blue-100" },
  "Awaiting Customer Reply": { label: "Pending", color: "bg-amber-50 text-amber-700 border-amber-100" },
  "Waiting on CleverTap": { label: "On Hold", color: "bg-purple-50 text-purple-700 border-purple-100" },
};

// --- DUAL SLA LOGIC ---
export const getTicketStatus = (createdDate, stageName, isCSD) => {
  if (!stageName) return { status: "Unknown", color: "bg-gray-100", icon: CheckCircle, priority: 4 };
  const lower = stageName.toLowerCase();
  
  // Solved/Closed -> Ignore
  if (lower.includes('solved') || lower.includes('closed')) {
    return { status: "Solved", color: "bg-slate-100 text-slate-500 border-slate-200", icon: CheckCircle, priority: 4, days: 0 };
  }

  const days = differenceInDays(new Date(), parseISO(createdDate));

  if (isCSD) {
    // Strict SLA for CSD
    if (days > 7) return { status: "Action Immediately", color: "text-rose-700 bg-rose-50 border-rose-200", icon: AlertOctagon, priority: 1, days };
    if (days >= 3) return { status: "Needs Attention", color: "text-amber-700 bg-amber-50 border-amber-200", icon: AlertTriangle, priority: 2, days };
    return { status: "Healthy", color: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: CheckCircle, priority: 3, days };
  } else {
    // Standard SLA
    if (days > 15) return { status: "Action Immediately", color: "text-rose-700 bg-rose-50 border-rose-200", icon: AlertOctagon, priority: 1, days };
    if (days >= 10) return { status: "Needs Attention", color: "text-amber-700 bg-amber-50 border-amber-200", icon: AlertTriangle, priority: 2, days };
    return { status: "Healthy", color: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: CheckCircle, priority: 3, days };
  }
};

export const getCSATStatus = (t) => {
  const oldRating = Number(t.custom_fields?.tnt__csatrating);
  if (oldRating === 2) return "Good";
  if (oldRating === 1) return "Bad";
  return null;
};

export const formatRWT = (epoch) => {
  if (!epoch) return 0;
  return Math.max(0, Date.now() - (epoch * 1000));
};

// ── CSV export: dependency columns ──────────────────────────────────────────
// The dependency map (App-level) is keyed by display_id WITHOUT the "TKT-"
// prefix; each entry is { hasDependency, issues: [{ team, owner, ... }] } as
// returned by /api/tickets/dependencies.
//
// Returns three CSV-ready cells: [hadDependency, dependencyTeams, dependencyAssignees].
//  - "Not checked" (not "No") when the ticket's links were never fetched — the
//    live map only covers active-cache tickets, so historical/analytics tickets
//    are unknown rather than dependency-free. This avoids a false "No".
//  - Team/assignee cells are pre-quoted so "; "-joined multi-values stay in one
//    column even if a name ever contains a comma.
export const DEPENDENCY_EXPORT_HEADERS = [
  "Had Dependency",
  "Dependency Team(s)",
  "Dependency Assignee(s)",
];

// Canonical list of dependency teams shown in filters. "All selected" checks
// must compare against DEPENDENCY_TEAMS.length, never a hardcoded count —
// UCMR (synced ex-PROD tickets) and TAM (task/custom-object links) were added
// after the original six.
export const DEPENDENCY_TEAMS = [
  "NOC",
  "Whatsapp",
  "Billing",
  "Email",
  "Internal",
  "UCMR",
  "TAM",
  "Other",
];

// Badge colors for dependency-team chips. Full class strings (not computed)
// so Tailwind's scanner picks them up.
const DEP_TEAM_BADGE_CLASSES = {
  NOC: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  Whatsapp:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Billing:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Email: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  UCMR: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  TAM: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
};

export const depTeamBadgeClass = (team) =>
  DEP_TEAM_BADGE_CLASSES[team] ||
  "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400";

const csvQuote = (v) => `"${String(v).replace(/"/g, '""')}"`;

export const getDependencyExportCells = (deps, displayId) => {
  const id = (displayId || "").replace("TKT-", "");
  const dep = deps?.[id];
  if (!dep) return ["Not checked", "-", "-"];
  if (!dep.hasDependency) return ["No", "-", "-"];
  const issues = dep.issues || [];
  const teams = [...new Set(issues.map((i) => i.team).filter(Boolean))];
  const assignees = [...new Set(issues.map((i) => i.owner).filter(Boolean))];
  return [
    "Yes",
    teams.length ? csvQuote(teams.join("; ")) : "-",
    assignees.length ? csvQuote(assignees.join("; ")) : "-",
  ];
};


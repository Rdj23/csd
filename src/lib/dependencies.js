/**
 * Ticket dependencies — linked issues owned by other teams.
 *
 * The dependency map is keyed by display_id WITHOUT the "TKT-" prefix and is
 * fetched separately from tickets (/api/tickets/dependencies), because it only
 * covers the active cache. That is why "Not checked" is a distinct state from
 * "No" — see getDependencyExportCells below.
 */

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

/**
 * Resolve a ticket's dependency info from BOTH sources:
 * 1. Sync-time snapshot persisted in Mongo (has_dependency / dependency_teams /
 *    dependency_assignees) — present on by-date drill-down and all-solved rows,
 *    survives the ticket aging out of the Redis active cache.
 * 2. The live `dependencies` map (App.jsx, async-batched links.list) — covers
 *    active-cache tickets that haven't been re-synced with the new fields.
 * Returns { known, hasDependency, teams, assignees }; known=false means the
 * ticket was never checked by either source ("Not checked", not "No").
 */
export const getTicketDepInfo = (deps, ticket) => {
  if (ticket && ticket.has_dependency !== undefined && ticket.has_dependency !== null) {
    return {
      known: true,
      hasDependency: ticket.has_dependency === true,
      teams: ticket.dependency_teams || [],
      assignees: ticket.dependency_assignees || [],
    };
  }
  const id = (ticket?.display_id || ticket?.ticket_id || "").replace("TKT-", "");
  const dep = deps?.[id];
  if (!dep) return { known: false, hasDependency: false, teams: [], assignees: [] };
  const issues = dep.issues || [];
  return {
    known: true,
    hasDependency: dep.hasDependency === true,
    teams: [...new Set(issues.map((i) => i.team).filter(Boolean))],
    assignees: [...new Set(issues.map((i) => i.owner).filter(Boolean))],
  };
};

export const getDependencyExportCells = (deps, displayId, ticket = null) => {
  const info = getTicketDepInfo(deps, ticket || { display_id: displayId });
  if (!info.known) return ["Not checked", "-", "-"];
  if (!info.hasDependency) return ["No", "-", "-"];
  return [
    "Yes",
    info.teams.length ? csvQuote(info.teams.join("; ")) : "-",
    info.assignees.length ? csvQuote(info.assignees.join("; ")) : "-",
  ];
};

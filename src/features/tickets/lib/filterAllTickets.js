/**
 * The ALL TICKETS tab's filter pipeline — ongoing PLUS solved/closed.
 *
 * Extracted verbatim from a 271-line useMemo inside App.jsx. Pure: same
 * arguments, same array out.
 *
 * WHY THIS IS SEPARATE FROM filterOngoingTickets: this tab merges two sources
 * (the live active cache and the solved tickets fetched from Mongo) and reads
 * its own filter bucket, tabFilters.alltickets. The two pipelines look similar
 * but have diverged deliberately; sharing them would couple the live board to
 * the historical view.
 */
import { parseISO, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { getTicketStatus } from "../../../lib/ticketStatus";
import { DEPENDENCY_TEAMS, getTicketDepInfo } from "../../../lib/dependencies";
import { FLAT_TEAM_MAP, TEAM_GROUPS } from "../../../lib/teams";

export const filterAllTickets = ({
  tickets,
  activeTab,
  tabFilters,
  dependencies,
  allSolvedTickets,
  EMPTY_FILTERS,
}) => {
  if (activeTab !== "alltickets") return [];

  const allTicketsFilters = tabFilters.alltickets || EMPTY_FILTERS;

  // Solved tickets ALWAYS come from Mongo now — the live cache is
  // active-only, so the two sources can no longer overlap. The filter below
  // is kept as a cheap guard: a stale cache written before the 2026-08-09
  // backend change (5-min TTL, but a client can hold an older payload) could
  // still carry solved rows, and double-counting them against the Mongo set
  // would inflate every count on this tab.
  const isSolvedStage = (name) => {
    const s = (name || "").toLowerCase();
    return (
      s.includes("solved") || s.includes("closed") || s.includes("resolved")
    );
  };
  const sourceTickets = [
    ...tickets.filter((t) => !isSolvedStage(t.stage?.name)),
    ...allSolvedTickets,
  ];

  return sourceTickets
    .map((t) => {
      const { status, color, icon, priority, days } = getTicketStatus(
        t.created_date,
        t.stage?.name,
        false,
      );
      return {
        ...t,
        uiStatus: status,
        uiColor: color,
        uiIcon: icon,
        priority,
        days,

        region: (() => {
          const r = t.custom_fields?.tnt__region_salesforce || "Unknown";
          if (r === "IN1" || r === "In1" || r === "in1") return "India";
          return r;
        })(),
        accountName:
          t.custom_fields?.tnt__instance_account_name ||
          t.rev_org?.display_name ||
          t.account?.display_name ||
          "Unknown",
        csm:
          t.custom_fields?.tnt__csm_email_id ||
          t.custom_fields?.tnt__csm ||
          "Unknown",
        tam: t.custom_fields?.tnt__tam || "Unknown",

        // Metrics
        rwt: t.custom_fields?.tnt__rwt_business_hours || null,
        frt: t.custom_fields?.tnt__frt_hours || null,
        iterations: t.custom_fields?.tnt__iteration_count || null,
        csat: t.custom_fields?.tnt__csatrating || null,
        frr:
          t.custom_fields?.tnt__frr === true
            ? "Yes"
            : t.custom_fields?.tnt__iteration_count === 1
              ? "Yes"
              : null,
      };
    })
    .filter((t) => {
      // Get owner name
      const ownerName =
        FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
        t.owned_by?.[0]?.display_name ||
        "";

      // Date Range filter — applies to SOLVED tickets only (by close date).
      // Open/Pending/On-Hold buckets always show the complete backlog: an
      // active ticket is still someone's workload no matter when it was
      // created, so filtering actives by created_date silently hid old
      // tickets (e.g. a Feb-created ticket still pending in July vanished
      // whenever a recent range was selected).
      if (
        allTicketsFilters.dateRange?.start &&
        allTicketsFilters.dateRange?.end
      ) {
        try {
          const stageLower = (t.stage?.name || "").toLowerCase();
          const isSolved =
            stageLower.includes("solved") ||
            stageLower.includes("closed") ||
            stageLower.includes("resolved");

          if (isSolved) {
            const ticketDate = parseISO(
              t.actual_close_date || t.created_date,
            );
            const start = startOfDay(
              parseISO(allTicketsFilters.dateRange.start),
            );
            const end = endOfDay(parseISO(allTicketsFilters.dateRange.end));
            if (!isWithinInterval(ticketDate, { start, end })) return false;
          }
        } catch (e) {
          // Skip invalid dates
        }
      }

      // Region filter
      if (allTicketsFilters.regions?.length > 0) {
        if (!allTicketsFilters.regions.includes(t.region)) return false;
      }

      // Team filter - special handling for Adish (region-based)
      if (allTicketsFilters.teams?.length > 0) {
        // If only Adish is selected, filter by regions instead of owner
        if (
          allTicketsFilters.teams.length === 1 &&
          allTicketsFilters.teams.includes("Adish")
        ) {
          // Adish = South America + North America regions
          const adishRegions = ["South America", "North America"];
          if (!adishRegions.includes(t.region)) return false;
        } else if (
          allTicketsFilters.teams.includes("Adish") &&
          allTicketsFilters.teams.length > 1
        ) {
          // Adish + other teams: include SA/NA regions OR matching team members
          const adishRegions = ["South America", "North America"];
          const otherTeams = allTicketsFilters.teams.filter(
            (team) => team !== "Adish",
          );

          const ownerTeams = Object.entries(TEAM_GROUPS)
            .filter(([team, members]) =>
              Object.values(members).includes(ownerName),
            )
            .map(([team]) => team);

          const matchesOtherTeam = ownerTeams.some((team) =>
            otherTeams.includes(team),
          );
          const matchesAdishRegion = adishRegions.includes(t.region);

          if (!matchesOtherTeam && !matchesAdishRegion) return false;
        } else {
          // Normal team filter - filter by team members
          const ownerTeams = Object.entries(TEAM_GROUPS)
            .filter(([team, members]) =>
              Object.values(members).includes(ownerName),
            )
            .map(([team]) => team);

          if (
            !ownerTeams.some((team) => allTicketsFilters.teams.includes(team))
          ) {
            return false;
          }
        }
      }

      // Owner/Member filter
      if (allTicketsFilters.owners?.length > 0) {
        if (!allTicketsFilters.owners.includes(ownerName)) return false;
      }

      // Resolved By filter — same rule as the main view; both checked = no-op
      const allTicketsResolvedBy = allTicketsFilters.resolvedBy || [];
      if (allTicketsResolvedBy.length === 1) {
        const stageLower = (t.stage?.name || "").toLowerCase();
        const isSolved =
          stageLower.includes("solved") ||
          stageLower.includes("closed") ||
          stageLower.includes("resolved");
        const agentFlag =
          (t.custom_fields?.tnt__agent_resolved === true &&
            t.custom_fields?.tnt__support_engineer_handled !== true) ||
          (ownerName === "Unassigned" && isSolved);
        const ticketResolvedBy = agentFlag ? "agent" : "engineer";
        if (!allTicketsResolvedBy.includes(ticketResolvedBy)) return false;
      }

      // Account filter
      if (allTicketsFilters.accounts?.length > 0) {
        if (!allTicketsFilters.accounts.includes(t.accountName)) return false;
      }

      // CSM filter - scope to accounts
      if (allTicketsFilters.csms?.length > 0) {
        if (!allTicketsFilters.csms.includes(t.csm)) return false;
      }

      // TAM filter - scope to accounts
      if (allTicketsFilters.tams?.length > 0) {
        if (!allTicketsFilters.tams.includes(t.tam)) return false;
      }

      // Stage filter - map stage names to filter values
      if (allTicketsFilters.stages?.length > 0) {
        const stageName = (t.stage?.name || "").toLowerCase();

        // Map actual stage names to filter categories
        let stageCategory = "";
        if (
          stageName.includes("waiting on assignee") ||
          stageName === "open"
        ) {
          stageCategory = "Open";
        } else if (
          stageName.includes("awaiting customer") ||
          stageName.includes("pending")
        ) {
          stageCategory = "Pending";
        } else if (
          stageName.includes("waiting on clevertap") ||
          stageName.includes("on hold")
        ) {
          stageCategory = "On Hold";
        } else if (
          stageName.includes("solved") ||
          stageName.includes("closed") ||
          stageName.includes("resolved")
        ) {
          stageCategory = "Solved";
        }

        if (
          stageCategory &&
          !allTicketsFilters.stages.includes(stageCategory)
        ) {
          return false;
        }
      }

      // Dependency filter — getTicketDepInfo prefers the sync-time Mongo
      // snapshot carried by all-solved rows (which the live map never covers),
      // falling back to the live dependencies map for active-cache tickets.
      if (
        allTicketsFilters.dependency?.length > 0 &&
        allTicketsFilters.dependency?.length < 2
      ) {
        const hasDependency = getTicketDepInfo(dependencies, t).hasDependency;

        if (
          allTicketsFilters.dependency.includes("with_dependency") &&
          !hasDependency
        ) {
          return false;
        }
        if (
          allTicketsFilters.dependency.includes("no_dependency") &&
          hasDependency
        ) {
          return false;
        }
      }

      // Dependency team filter — zero teams selected yields zero dependency
      // tickets (an empty selection is a narrowing, not a no-op).
      if (
        allTicketsFilters.dependency?.includes("with_dependency") &&
        Array.isArray(allTicketsFilters.dependencyTeams) &&
        allTicketsFilters.dependencyTeams.length < DEPENDENCY_TEAMS.length
      ) {
        const depInfo = getTicketDepInfo(dependencies, t);
        if (depInfo.hasDependency) {
          const hasMatchingTeam = allTicketsFilters.dependencyTeams.some(
            (team) => depInfo.teams.includes(team),
          );
          if (!hasMatchingTeam) return false;
        }
      }

      // Dependency assignee filter — same rule as the ongoing board: empty
      // selection is a no-op, a non-empty one keeps only tickets whose linked
      // issue sits with one of the selected people.
      if (allTicketsFilters.dependencyAssignees?.length > 0) {
        const { assignees } = getTicketDepInfo(dependencies, t);
        if (
          !assignees.some((a) =>
            allTicketsFilters.dependencyAssignees.includes(a),
          )
        )
          return false;
      }

      return true;
    });
};

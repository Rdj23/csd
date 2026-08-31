/**
 * The ONGOING board's filter pipeline: raw tickets -> what the user sees.
 *
 * Extracted verbatim from a 235-line useMemo inside App.jsx. It is pure — the
 * same arguments always produce the same array — which is why it can live
 * here, be read on its own, and be tested without mounting the app.
 *
 * ORDER MATTERS. The pipeline is: decorate each ticket with its SLA status and
 * dependency info, then narrow by tab, saved view, search, date range and each
 * active filter. Reordering these changes results, not just performance.
 *
 * NOTE ON `myViews`: App.jsx's useMemo reads myViews but does NOT list it in
 * its dependency array. That is preserved exactly — this refactor did not
 * change when the memo recomputes. If that staleness is ever fixed, fix it in
 * the dependency array at the call site, not here.
 */
import { parseISO, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import { STAGE_MAP, formatRWT, getTicketStatus } from "../../../lib/ticketStatus";
import { DEPENDENCY_TEAMS, getTicketDepInfo } from "../../../lib/dependencies";
import { FLAT_TEAM_MAP, TEAM_GROUPS } from "../../../lib/teams";

export const filterOngoingTickets = ({
  tickets,
  activeTab,
  searchQueries,
  dateRange,
  currentFilters,
  selectedViewId,
  dependencies,
  myViews,
}) => {
  if (activeTab === "vistas" && !selectedViewId && myViews.length > 0)
    return [];

  return tickets
    .map((t) => {
      const isCSD = t.tags?.some(
        (tagObj) => tagObj.tag?.name === "csd-highlighted",
      );
      const { status, color, icon, days, priority } = getTicketStatus(
        t.created_date,
        t.stage?.name,
        isCSD,
      );
      const region = t.custom_fields?.tnt__region_salesforce || "Unknown";
      const cohort = t.custom_fields?.tnt__account_cohort_fy_25 || "C4S";
      const accountName =
        t.custom_fields?.tnt__instance_account_name || "Unknown";
      const csm = t.custom_fields?.tnt__csm_email_id || "Unknown";
      const tam = t.custom_fields?.tnt__tam || "Unknown";
      const rwtMs = formatRWT(t.custom_fields?.tnt__customer_wait_time);
      const stageName = t.stage?.name || "";
      const isActive =
        Object.keys(STAGE_MAP).includes(stageName) ||
        (activeTab === "csd" &&
          !stageName.toLowerCase().includes("solved") &&
          !stageName.toLowerCase().includes("closed"));

      const sentimentLabel = typeof t.sentiment === "string"
        ? t.sentiment
        : t.sentiment?.label || null;

      return {
        ...t,
        uiStatus: status,
        uiColor: color,
        uiIcon: icon,
        days,
        priority,
        region,
        cohort,
        rwtMs,
        isCSD,
        isActive,
        accountName,
        csm,
        tam,
        sentimentLabel,
        // Metrics for CSV export
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
      if (activeTab === "csd") {
        if (!t.isCSD) return false;
        // For CSD, show all non-closed tickets
        const stage = t.stage?.name?.toLowerCase() || "";
        if (stage.includes("solved") || stage.includes("closed"))
          return false;
      } else if (activeTab !== "analytics" && !t.isActive) {
        return false;
      }

      const currentSearch = (searchQueries[activeTab] || "").toLowerCase();
      const matchesSearch =
        (t.title || "").toLowerCase().includes(currentSearch) ||
        (t.display_id || "").toLowerCase().includes(currentSearch);
      if (!matchesSearch) return false;

      // ✅ FIX: Use 'currentFilters.dateRange' so each tab is independent
      // ✅ Skip date filtering for pending/on-hold tickets - they should always show
      const stageLower = t.stage?.name?.toLowerCase() || "";
      const isPendingOrOnHold =
        stageLower.includes("awaiting customer") ||
        stageLower.includes("pending") ||
        stageLower.includes("waiting on clevertap") ||
        stageLower.includes("on hold");

      if (
        currentFilters.dateRange?.start &&
        currentFilters.dateRange?.end &&
        !isPendingOrOnHold
      ) {
        if (
          !isWithinInterval(parseISO(t.created_date), {
            start: startOfDay(parseISO(currentFilters.dateRange.start)),
            end: endOfDay(parseISO(currentFilters.dateRange.end)),
          })
        )
          return false;
      }

      const ownerName =
        FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || "Unassigned";

      if (currentFilters.teams?.length > 0) {
        // Special case: Adish = region-based filter only, not owner-based
        if (
          currentFilters.teams.length === 1 &&
          currentFilters.teams.includes("Adish")
        ) {
          // Skip team/owner filter - let region filter handle it
          // (regions are already auto-selected via useEffect)
        } else {
          // Normal team filter - filter by team members
          const ticketOwnerTeams = Object.entries(TEAM_GROUPS)
            .filter(([team, members]) =>
              Object.values(members).includes(ownerName),
            )
            .map(([team]) => team);
          if (
            !ticketOwnerTeams.some((team) =>
              currentFilters.teams.includes(team),
            )
          )
            return false;
        }
      }
      if (
        currentFilters.owners?.length > 0 &&
        !currentFilters.owners.includes(ownerName)
      )
        return false;

      // ── "Resolved By" filter (dashboard-wide) ──
      // Both checked OR none checked = no filter (show everything).
      // Only narrows when exactly one of {engineer, agent} is selected.
      // Agent classification mirrors the backend rule:
      //   agent = (tnt__agent_resolved === true AND tnt__support_engineer_handled !== true)
      //           OR (Unassigned AND solved)
      const resolvedBySel = currentFilters.resolvedBy || [];
      if (resolvedBySel.length === 1) {
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
        if (!resolvedBySel.includes(ticketResolvedBy)) return false;
      }
      if (
        currentFilters.regions?.length > 0 &&
        !currentFilters.regions.includes(t.region)
      )
        return false;
      if (
        currentFilters.cohorts?.length > 0 &&
        !currentFilters.cohorts.includes(t.cohort)
      )
        return false;
      if (
        currentFilters.accounts?.length > 0 &&
        !currentFilters.accounts.includes(t.accountName)
      )
        return false;
      if (
        currentFilters.csms?.length > 0 &&
        !currentFilters.csms.includes(t.csm)
      )
        return false;
      if (
        currentFilters.tams?.length > 0 &&
        !currentFilters.tams.includes(t.tam)
      )
        return false;
      if (
        currentFilters.sentiments?.length > 0 &&
        !currentFilters.sentiments.includes(t.sentimentLabel)
      )
        return false;

      if (activeTab !== "analytics") {
        const stageLabel = STAGE_MAP[t.stage?.name]?.label || "Unknown";
        if (
          currentFilters.stages?.length > 0 &&
          !currentFilters.stages.includes(stageLabel)
        )
          return false;
      }

      // Dependency filter
      if (
        currentFilters.dependency?.length > 0 &&
        currentFilters.dependency.length < 2
      ) {
        // Only filter if NOT both options are selected (if both selected, show all)
        const hasDep = getTicketDepInfo(dependencies, t).hasDependency;

        if (
          currentFilters.dependency.includes("with_dependency") &&
          !currentFilters.dependency.includes("no_dependency")
        ) {
          // Only "Has Dependency" selected - hide tickets without dependency
          if (!hasDep) return false;
        }
        if (
          currentFilters.dependency.includes("no_dependency") &&
          !currentFilters.dependency.includes("with_dependency")
        ) {
          // Only "No Dependency" selected - hide tickets with dependency
          if (hasDep) return false;
        }
      }

      // Dependency team filter (only applies when filtering for dependency
      // tickets). Any non-full selection narrows — zero teams selected must
      // yield zero dependency tickets, not "show all".
      if (
        currentFilters.dependency?.includes("with_dependency") &&
        Array.isArray(currentFilters.dependencyTeams) &&
        currentFilters.dependencyTeams.length < DEPENDENCY_TEAMS.length
      ) {
        const depInfo = getTicketDepInfo(dependencies, t);
        if (depInfo.hasDependency) {
          const hasMatchingTeam = currentFilters.dependencyTeams.some(
            (team) => depInfo.teams.includes(team),
          );
          if (!hasMatchingTeam) return false;
        }
      }

      return true;
    });
};

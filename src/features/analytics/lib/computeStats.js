/**
 * The headline KPI numbers on the analytics dashboard.
 *
 * Extracted verbatim from a 295-line useMemo inside AnalyticsDashboard.jsx,
 * which was a single 3580-line component. Pure: same arguments in, same
 * value out. The call site keeps its original dependency array, so nothing
 * about when this recomputes has changed.
 */

import { parseISO } from "date-fns";
import { TEAM_GROUPS } from "../../../lib/teams";

export const computeFilteredStats = ({
  analyticsData,
  solvedTickets,
  solvedTicketsForCSAT,
  effectiveDateRange,
  hasDependencyFilter,
  filters,
}) => {
  // NOC exclusion is already handled by baseFilteredTickets -> solvedTickets
  // CSAT/DSAT uses solvedTicketsForCSAT which always includes NOC tickets
  // When hasDependencyFilter is active we fall into Scenario 0 (client-side calc)
  // because solvedTickets already had the dependency filter applied upstream.

  // =================================================================================
  // SCENARIO 0: REGION OR DEPENDENCY FILTER APPLIED - Must use DevRev data
  // (MongoDB rollups don't carry region / dependency per trend)
  // =================================================================================
  if (filters?.regions?.length > 0 || hasDependencyFilter) {
    // When region filter is active, calculate from solvedTickets (already filtered by region in baseFilteredTickets)
    let filteredSolved = solvedTickets;

    // Also apply owner/team filter if present
    if (filters?.owners?.length > 0) {
      filteredSolved = filteredSolved.filter((t) => {
        const ownerName = t.owned_by?.[0]?.display_name;
        return filters.owners.some(
          (o) =>
            o.toLowerCase() === ownerName?.toLowerCase() ||
            ownerName?.toLowerCase().includes(o.toLowerCase()),
        );
      });
    }
    if (filters?.teams?.length > 0) {
      filteredSolved = filteredSolved.filter((t) => {
        const ownerName = t.owned_by?.[0]?.display_name;
        const ownerTeams = Object.keys(TEAM_GROUPS).filter((teamKey) =>
          Object.values(TEAM_GROUPS[teamKey]).some(
            (m) =>
              m.toLowerCase() === ownerName?.toLowerCase() ||
              ownerName?.toLowerCase().includes(m.toLowerCase()),
          ),
        );
        return filters.teams.some((team) => ownerTeams.includes(team));
      });
    }

    const totalSolved = filteredSolved.length;
    const rwtValues = filteredSolved
      .map((t) => t.custom_fields?.tnt__rwt_business_hours)
      .filter((v) => v > 0);
    const frtValues = filteredSolved
      .map((t) => t.custom_fields?.tnt__frt_hours)
      .filter((v) => v > 0);
    const iterValues = filteredSolved
      .map((t) => t.custom_fields?.tnt__iteration_count)
      .filter((v) => v > 0);
    // CSAT/DSAT: Use NOC-inclusive tickets (CSAT never excludes NOC)
    const csatSource = solvedTicketsForCSAT.filter((t) => {
      if (filters?.regions?.length > 0) {
        const region = t.custom_fields?.tnt__region_salesforce || "Unknown";
        if (!filters.regions.includes(region)) return false;
      }
      if (filters?.owners?.length > 0) {
        const ownerName = t.owned_by?.[0]?.display_name;
        if (!filters.owners.some(
          (o) =>
            o.toLowerCase() === ownerName?.toLowerCase() ||
            ownerName?.toLowerCase().includes(o.toLowerCase()),
        )) return false;
      }
      if (filters?.teams?.length > 0) {
        const ownerName = t.owned_by?.[0]?.display_name;
        const ownerTeams = Object.keys(TEAM_GROUPS).filter((teamKey) =>
          Object.values(TEAM_GROUPS[teamKey]).some(
            (m) =>
              m.toLowerCase() === ownerName?.toLowerCase() ||
              ownerName?.toLowerCase().includes(m.toLowerCase()),
          ),
        );
        if (!filters.teams.some((team) => ownerTeams.includes(team))) return false;
      }
      return true;
    });
    const positiveCSAT = csatSource.filter(
      (t) => Number(t.custom_fields?.tnt__csatrating) === 2,
    ).length;
    const negativeCSAT = csatSource.filter(
      (t) => Number(t.custom_fields?.tnt__csatrating) === 1,
    ).length;
    const frrMet = filteredSolved.filter(
      (t) =>
        t.custom_fields?.tnt__frr === true ||
        t.custom_fields?.tnt__iteration_count === 1,
    ).length;

    return {
      totalTickets: totalSolved, // Use solved count for Performance Overview
      totalSolved,
      avgRWT:
        rwtValues.length > 0
          ? (rwtValues.reduce((a, b) => a + b, 0) / rwtValues.length).toFixed(
              2,
            )
          : "0.00",
      avgFRT:
        frtValues.length > 0
          ? (frtValues.reduce((a, b) => a + b, 0) / frtValues.length).toFixed(
              2,
            )
          : "0.00",
      avgIterations:
        iterValues.length > 0
          ? (
              iterValues.reduce((a, b) => a + b, 0) / iterValues.length
            ).toFixed(1)
          : "0.0",
      positiveCSAT,
      negativeCSAT,
      csatPercent:
        positiveCSAT + negativeCSAT > 0
          ? Math.round((positiveCSAT / (positiveCSAT + negativeCSAT)) * 100)
          : 0,
      frrPercent:
        totalSolved > 0 ? Math.round((frrMet / totalSolved) * 100) : 0,
      _source: "devrev_region_filtered",
    };
  }

  // =================================================================================
  // SCENARIO 1: SPECIFIC FILTERS APPLIED (Calculated from Individual Trends)
  // =================================================================================
  const hasOwnerFilters =
    filters?.owners?.length > 0 || filters?.teams?.length > 0;

  if (hasOwnerFilters) {
    const individualTrends = analyticsData?.individualTrends || {};
    let ownersToInclude = Object.keys(individualTrends);

    // Filter Owners
    if (filters?.owners?.length > 0) {
      ownersToInclude = ownersToInclude.filter((owner) =>
        filters.owners.includes(owner),
      );
    }
    // Filter Teams
    if (filters?.teams?.length > 0) {
      ownersToInclude = ownersToInclude.filter((owner) => {
        const ownerTeams = Object.keys(TEAM_GROUPS).filter((teamKey) =>
          Object.values(TEAM_GROUPS[teamKey]).includes(owner),
        );
        return filters.teams.some((team) => ownerTeams.includes(team));
      });
    }

    let totalSolved = 0;
    let weightedRWT = 0,
      validRWTCount = 0;
    let weightedFRT = 0,
      validFRTCount = 0;
    let weightedIter = 0,
      validIterCount = 0;
    let positiveCSAT = 0;
    let negativeCSAT = 0;
    let frrMet = 0;

    ownersToInclude.forEach((owner) => {
      const ownerTrends = individualTrends[owner] || [];
      ownerTrends.forEach((day) => {
        if (!day.date) return;
        const dayDate = parseISO(day.date);
        if (
          dayDate < effectiveDateRange.start ||
          dayDate > effectiveDateRange.end
        )
          return;

        totalSolved += day.solved || 0;
        positiveCSAT += day.positiveCSAT || 0;
        negativeCSAT += day.negativeCSAT || 0;
        frrMet += day.frrMet || 0;

        // Weighted Averages
        if (day.avgRWT > 0 && day.rwtValidCount > 0) {
          weightedRWT += day.avgRWT * day.rwtValidCount;
          validRWTCount += day.rwtValidCount;
        }
        if (day.avgFRT > 0 && day.frtValidCount > 0) {
          weightedFRT += day.avgFRT * day.frtValidCount;
          validFRTCount += day.frtValidCount;
        }
        if (day.avgIterations > 0 && day.iterValidCount > 0) {
          weightedIter += day.avgIterations * day.iterValidCount;
          validIterCount += day.iterValidCount;
        }
      });
    });

    return {
      totalTickets: totalSolved, // Use solved count for Performance Overview
      totalSolved,
      avgRWT:
        validRWTCount > 0 ? (weightedRWT / validRWTCount).toFixed(2) : "0.00",
      avgFRT:
        validFRTCount > 0 ? (weightedFRT / validFRTCount).toFixed(2) : "0.00",
      avgIterations:
        validIterCount > 0
          ? (weightedIter / validIterCount).toFixed(1)
          : "0.0",
      positiveCSAT,
      negativeCSAT,
      csatPercent: (() => {
        // Use accumulated values, fall back to backend stats if trends lack negativeCSAT
        const effectiveNeg = negativeCSAT > 0 ? negativeCSAT : (analyticsData?.stats?.negativeCSAT || 0);
        const effectivePos = positiveCSAT > 0 ? positiveCSAT : (analyticsData?.stats?.positiveCSAT || 0);
        if (effectivePos + effectiveNeg > 0) {
          return Math.round((effectivePos / (effectivePos + effectiveNeg)) * 100);
        }
        return analyticsData?.stats?.csatPercent || 0;
      })(),
      frrPercent:
        totalSolved > 0 ? Math.round((frrMet / totalSolved) * 100) : 0,
    };
  }

  // =================================================================================
  // SCENARIO 2: NO FILTERS (Global Trends)
  // =================================================================================
  const globalTrends = analyticsData?.trends || [];

  let totalSolved = 0;
  let positiveCSAT = 0;
  let negativeCSAT = 0;
  let frrMet = 0;

  // Variables for Global Calculation
  let weightedRWT = 0,
    rwtCount = 0;
  let weightedFRT = 0,
    frtCount = 0;
  let weightedIter = 0,
    iterCount = 0;

  globalTrends.forEach((day) => {
    if (!day.date) return;
    const dayDate = parseISO(day.date);
    // STRICTLY RESPECT DATE RANGE
    if (
      dayDate < effectiveDateRange.start ||
      dayDate > effectiveDateRange.end
    )
      return;

    totalSolved += day.solved || 0;
    positiveCSAT += day.positiveCSAT || 0;
    negativeCSAT += day.negativeCSAT || 0;
    frrMet += day.frrMet || 0;

    if (day.avgRWT > 0) {
      weightedRWT += day.avgRWT * day.solved;
      rwtCount += day.solved;
    }
    if (day.avgFRT > 0) {
      weightedFRT += day.avgFRT * day.solved;
      frtCount += day.solved;
    }
    if (day.avgIterations > 0) {
      weightedIter += day.avgIterations * day.solved;
      iterCount += day.solved;
    }
  });

  // ✅ FIX: Use 'rwtCount' here (NOT totalValidRWT which is undefined in this block)
  const avgRWT = rwtCount > 0 ? (weightedRWT / rwtCount).toFixed(2) : "0.00";
  const avgFRT = frtCount > 0 ? (weightedFRT / frtCount).toFixed(2) : "0.00";
  const avgIterations =
    iterCount > 0 ? (weightedIter / iterCount).toFixed(1) : "0.0";

  // ✅ FIX: FRR Percent calculation
  const frrPercent =
    totalSolved > 0 ? Math.round((frrMet / totalSolved) * 100) : 0;

  return {
    totalTickets: totalSolved, // Use solved count for Performance Overview
    totalSolved,
    avgRWT,
    avgFRT,
    avgIterations,
    positiveCSAT,
    negativeCSAT,
    csatPercent: (() => {
      // Use trend-accumulated negativeCSAT if available, otherwise fall back to backend stats
      const effectiveNeg = negativeCSAT > 0 ? negativeCSAT : (analyticsData?.stats?.negativeCSAT || 0);
      const effectivePos = positiveCSAT > 0 ? positiveCSAT : (analyticsData?.stats?.positiveCSAT || 0);
      // Also use backend-computed csatPercent as ultimate fallback
      if (effectivePos + effectiveNeg > 0) {
        return Math.round((effectivePos / (effectivePos + effectiveNeg)) * 100);
      }
      return analyticsData?.stats?.csatPercent || 0;
    })(),
    frrPercent,
    frrMet,
    _source: "mongodb_global_calc",
  };
};

/**
 * The four small overview charts: volume, solved, RWT and backlog.
 *
 * Extracted verbatim from a 152-line useMemo inside AnalyticsDashboard.jsx,
 * which was a single 3580-line component. Pure: same arguments in, same
 * value out. The call site keeps its original dependency array, so nothing
 * about when this recomputes has changed.
 */

import { format, eachDayOfInterval, parseISO } from "date-fns";
import { TEAM_GROUPS } from "../../../lib/teams";

export const buildSmallChartData = ({
  volumeTickets,
  solvedTickets,
  effectiveDateRange,
  analyticsData,
  hasDependencyFilter,
  filters,
}) => {
  const daysInterval = eachDayOfInterval({
    start: effectiveDateRange.start,
    end: effectiveDateRange.end,
  });

  // Volume: Use DevRev cache (has all created dates)
  const volumeData = daysInterval.map((day) => {
    const dateKey = format(day, "yyyy-MM-dd");
    const dayTickets = volumeTickets.filter((t) => {
      if (!t.created_date) return false;
      return format(parseISO(t.created_date), "yyyy-MM-dd") === dateKey;
    });
    return {
      name: format(day, "MMM dd"),
      date: dateKey,
      main: dayTickets.length,
      tickets: dayTickets,
    };
  });

  // For Solved/RWT/Backlog the default source is the MongoDB individualTrends
  // rollup (filtered by owner/team). But those rollups have no dependency
  // dimension, so when a dependency filter is active we rebuild the same
  // per-day aggregates directly from solvedTickets (already filtered upstream
  // for dependency + owner/team/region). Field/threshold definitions mirror the
  // backend aggregation: solved = count by close-date, avgRWT = mean of rwt>0,
  // backlogCleared = tickets whose (closed - created) age >= 15 days.
  const dailyAggregates = {};

  if (hasDependencyFilter) {
    solvedTickets.forEach((t) => {
      const closedDate = t.actual_close_date || t.closed_date;
      if (!closedDate) return;
      const dateKey = format(parseISO(closedDate), "yyyy-MM-dd");

      if (!dailyAggregates[dateKey]) {
        dailyAggregates[dateKey] = {
          solved: 0,
          totalRWT: 0,
          rwtCount: 0,
          backlogCleared: 0,
        };
      }

      dailyAggregates[dateKey].solved += 1;

      const rwt = t.custom_fields?.tnt__rwt_business_hours;
      if (rwt > 0) {
        dailyAggregates[dateKey].totalRWT += rwt;
        dailyAggregates[dateKey].rwtCount += 1;
      }

      if (t.created_date) {
        const ageDays =
          (parseISO(closedDate).getTime() -
            parseISO(t.created_date).getTime()) /
          (1000 * 60 * 60 * 24);
        if (ageDays >= 15) dailyAggregates[dateKey].backlogCleared += 1;
      }
    });
  } else {
    const individualTrends = analyticsData?.individualTrends || {};

    // Determine which owners to include based on filters
    let ownersToInclude = Object.keys(individualTrends);

    // Filter Owners (case-insensitive)
    if (filters?.owners?.length > 0) {
      const lowerFilters = filters.owners.map((o) => o.toLowerCase());
      ownersToInclude = ownersToInclude.filter((owner) =>
        lowerFilters.includes(owner.toLowerCase()),
      );
    }

    if (filters?.teams?.length > 0) {
      ownersToInclude = ownersToInclude.filter((owner) => {
        const ownerTeams = Object.keys(TEAM_GROUPS).filter((teamKey) =>
          Object.values(TEAM_GROUPS[teamKey]).includes(owner),
        );
        return filters.teams.some((team) => ownerTeams.includes(team));
      });
    }

    ownersToInclude.forEach((owner) => {
      const ownerTrends = individualTrends[owner] || [];

      ownerTrends.forEach((day) => {
        if (!day.date) return;

        if (!dailyAggregates[day.date]) {
          dailyAggregates[day.date] = {
            solved: 0,
            totalRWT: 0,
            rwtCount: 0,
            backlogCleared: 0,
          };
        }

        dailyAggregates[day.date].solved += day.solved || 0;
        if (day.avgRWT && day.solved) {
          dailyAggregates[day.date].totalRWT += day.avgRWT * day.solved;
          dailyAggregates[day.date].rwtCount += day.solved;
        }
        dailyAggregates[day.date].backlogCleared += day.backlogCleared || 0;
      });
    });
  }

  // Solved: From aggregated individualTrends
  const solvedData = daysInterval.map((day) => {
    const dateKey = format(day, "yyyy-MM-dd");
    const dayAgg = dailyAggregates[dateKey];
    return {
      name: format(day, "MMM dd"),
      date: dateKey,
      main: dayAgg?.solved || 0,
      tickets: [], // Will be fetched on drill-down from MongoDB
    };
  });

  // RWT: Average from aggregated individualTrends
  const rwtData = daysInterval.map((day) => {
    const dateKey = format(day, "yyyy-MM-dd");
    const dayAgg = dailyAggregates[dateKey];
    const avgRWT =
      dayAgg?.rwtCount > 0 ? dayAgg.totalRWT / dayAgg.rwtCount : 0;
    return {
      name: format(day, "MMM dd"),
      date: dateKey,
      main: Number(avgRWT.toFixed(1)),
      tickets: [],
    };
  });

  // Backlog: From aggregated individualTrends
  const backlogData = daysInterval.map((day) => {
    const dateKey = format(day, "yyyy-MM-dd");
    const dayAgg = dailyAggregates[dateKey];
    return {
      name: format(day, "MMM dd"),
      date: dateKey,
      main: dayAgg?.backlogCleared || 0,
      tickets: [],
    };
  });

  return {
    volume: volumeData,
    solved: solvedData,
    rwt: rwtData,
    backlog: backlogData,
  };
};

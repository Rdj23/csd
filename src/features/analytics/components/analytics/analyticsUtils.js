// ============================================================================
// ANALYTICS UTILITIES - Data processing and transformation functions
// ============================================================================
import {
  format,
  subDays,
  eachDayOfInterval,
  isSameDay,
  parseISO,
  differenceInHours,
  differenceInDays,
} from "date-fns";
import { FLAT_TEAM_MAP, TEAM_GROUPS } from "../../../../utils";

/**
 * Process chart data for a specific metric
 * @param {Array} tickets - Array of ticket objects
 * @param {string} metric - Metric to calculate (volume, solved, rwt, backlog)
 * @param {number} timeRange - Number of days to show
 * @param {string} subject - Subject to filter by (owner name, "Me", or "All")
 * @param {string} currentUser - Current user name for "Me" filter
 * @returns {Array} Chart data points
 */
export const processChartData = (tickets, metric, timeRange, subject, currentUser) => {
  if (!tickets || tickets.length === 0) return [];

  const end = new Date();
  const start = subDays(end, timeRange);
  const daysInterval = eachDayOfInterval({ start, end });

  let subjectName = subject === "Me" ? currentUser : subject;
  const isGlobal = subject === "All";
  const isTeam = TEAM_GROUPS[subjectName];

  const ticketsByDate = {};
  const getTicketDate = (t) =>
    metric === "volume" ? t.created_date : t.actual_close_date;

  for (const t of tickets) {
    if (!isGlobal) {
      const owner =
        FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
        t.owned_by?.[0]?.display_name ||
        "";
      if (isTeam) {
        const teamMembers = Object.values(TEAM_GROUPS[subjectName]);
        if (!teamMembers.some((m) => owner.includes(m))) continue;
      } else {
        if (!owner.toLowerCase().includes(subjectName?.toLowerCase())) continue;
      }
    }

    const dateRaw = getTicketDate(t);
    if (!dateRaw) continue;
    const dateKey = format(parseISO(dateRaw), "yyyy-MM-dd");

    if (!ticketsByDate[dateKey]) ticketsByDate[dateKey] = [];
    ticketsByDate[dateKey].push(t);
  }

  const getTicketValue = (t) => {
    if (metric === "volume" || metric === "solved") return 1;
    if (metric === "rwt") {
      if (!t.created_date || !t.actual_close_date) return null;
      const diff = differenceInHours(
        parseISO(t.actual_close_date),
        parseISO(t.created_date),
      );
      return diff > 0 ? diff : 0;
    }
    if (metric === "backlog") {
      if (!t.actual_close_date || !t.created_date) return 0;
      const ageInDays = differenceInDays(
        parseISO(t.actual_close_date),
        parseISO(t.created_date),
      );
      return ageInDays > 15 ? 1 : 0;
    }
    return 0;
  };

  return daysInterval.map((day) => {
    const dateKey = format(day, "yyyy-MM-dd");
    const dailyTickets = ticketsByDate[dateKey] || [];
    const subjectValues = dailyTickets
      .map(getTicketValue)
      .filter((v) => v !== null);

    let mainVal = 0;
    if (metric === "rwt") {
      mainVal = subjectValues.length
        ? Math.round(
            subjectValues.reduce((a, b) => a + b, 0) / subjectValues.length,
          )
        : 0;
    } else {
      mainVal = subjectValues.reduce((a, b) => a + b, 0);
    }

    return { name: format(day, "MMM dd"), main: mainVal, date: day };
  });
};

/**
 * Process multi-user data for expanded view charts
 */
export const processMultiUserData = (
  tickets,
  metric,
  timeRange,
  selectedUsers,
  showTeam,
  showGST,
  currentUserTeamName,
) => {
  const end = new Date();
  const start = subDays(end, timeRange);
  const daysInterval = eachDayOfInterval({ start, end });

  const getTicketDate = (t) =>
    metric === "volume" ? t.created_date : t.actual_close_date;

  const getTicketValue = (t) => {
    if (metric === "volume" || metric === "solved") return 1;
    if (metric === "rwt") {
      if (!t.created_date || !t.actual_close_date) return null;
      return Math.max(
        0,
        differenceInHours(
          parseISO(t.actual_close_date),
          parseISO(t.created_date),
        ),
      );
    }
    if (metric === "backlog") {
      if (!t.actual_close_date || !t.created_date) return 0;
      return differenceInDays(
        parseISO(t.actual_close_date),
        parseISO(t.created_date),
      ) > 15
        ? 1
        : 0;
    }
    return 0;
  };

  const teamMembers =
    currentUserTeamName && TEAM_GROUPS[currentUserTeamName]
      ? Object.values(TEAM_GROUPS[currentUserTeamName])
      : [];

  const gstMembers = Object.values(FLAT_TEAM_MAP);

  return daysInterval.map((day) => {
    const dailyTickets = tickets.filter((t) => {
      const d = getTicketDate(t);
      return d && isSameDay(parseISO(d), day);
    });

    let dataPoint = { name: format(day, "MMM dd"), date: day };

    // Plot selected users
    selectedUsers.forEach((user) => {
      const userTickets = dailyTickets.filter((t) => {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "";
        return owner === user;
      });
      const values = userTickets.map(getTicketValue).filter((v) => v !== null);

      if (metric === "rwt") {
        dataPoint[user] = values.length
          ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
          : 0;
      } else {
        dataPoint[user] = values.reduce((a, b) => a + b, 0);
      }
    });

    // Team & GST comparison
    if (showTeam || showGST) {
      const teamTickets = dailyTickets.filter((t) => {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "";
        return teamMembers.some((m) => owner.includes(m));
      });

      const gstTickets = dailyTickets.filter((t) => {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "";
        return gstMembers.some((m) => owner.includes(m));
      });

      if (showTeam) {
        const teamVals = teamTickets.map(getTicketValue).filter((v) => v !== null);
        dataPoint["compare_team"] =
          metric === "rwt" && teamVals.length
            ? Math.round(teamVals.reduce((a, b) => a + b, 0) / teamVals.length)
            : teamVals.reduce((a, b) => a + b, 0);
      }

      if (showGST) {
        const gstVals = gstTickets.map(getTicketValue).filter((v) => v !== null);
        dataPoint["compare_gst"] =
          metric === "rwt" && gstVals.length
            ? Math.round(gstVals.reduce((a, b) => a + b, 0) / gstVals.length)
            : gstVals.reduce((a, b) => a + b, 0);
      }
    }

    return dataPoint;
  });
};

/**
 * Get metric display label
 */
export const getMetricLabel = (metricKey) => {
  const labels = {
    volume: "Incoming Volume",
    solved: "Solved Tickets",
    rwt: "Avg Resolution Time",
    avgRWT: "Avg RWT",
    frt: "Avg First Response",
    avgFRT: "Avg FRT",
    backlog: "Backlog Cleared",
    csat: "CSAT",
    positiveCSAT: "Positive CSAT",
    frrPercent: "FRR Met",
    frr: "FRR Met",
    iterations: "Iterations",
    avgIterations: "Avg Iterations",
  };
  return labels[metricKey] || metricKey;
};

/**
 * Get week start date (Monday 12:00 AM)
 */
export const getWeekStart = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
};

/**
 * Calculate ISO week date range from week string (yyyy-Www)
 */
export const calculateWeekRange = (weekString) => {
  const [year, weekPart] = weekString.split("-W");
  const weekNum = parseInt(weekPart);

  const jan1 = new Date(parseInt(year), 0, 1);
  const jan1Day = jan1.getDay() || 7;

  let daysToMonday;
  if (jan1Day <= 4) {
    daysToMonday = 1 - jan1Day;
  } else {
    daysToMonday = 8 - jan1Day;
  }

  const week1Monday = new Date(parseInt(year), 0, 1 + daysToMonday);
  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (weekNum - 1) * 7);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    monday,
    sunday,
    rangeLabel: `${format(monday, "MMM dd")} - ${format(sunday, "MMM dd")}`,
  };
};

/**
 * Parse date string in various formats
 */
export const parseDateString = (dateStr) => {
  if (!dateStr) return null;

  const clean = dateStr.trim().toLowerCase();
  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // Try "jan 01 2026" format
  let match = clean.match(/^(\w{3})\s+(\d{1,2})\s+(\d{4})$/);
  if (match) {
    const [, mon, day, year] = match;
    if (months[mon] !== undefined) {
      return new Date(parseInt(year), months[mon], parseInt(day));
    }
  }

  // Try "01 jan 2026" format
  match = clean.match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})$/);
  if (match) {
    const [, day, mon, year] = match;
    if (months[mon] !== undefined) {
      return new Date(parseInt(year), months[mon], parseInt(day));
    }
  }

  // Fallback to Date.parse
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Filter tickets by date range
 */
export const filterTicketsByDateRange = (tickets, startDate, endDate, dateField = 'created_date') => {
  return tickets.filter((t) => {
    const dateValue = t[dateField] || t.actual_close_date || t.closed_date;
    if (!dateValue) return false;
    const date = parseISO(dateValue);
    return date >= startDate && date <= endDate;
  });
};

/**
 * Calculate stats from filtered tickets
 */
export const calculateTicketStats = (tickets) => {
  const totalSolved = tickets.length;
  const rwtValues = tickets
    .map((t) => t.custom_fields?.tnt__rwt_business_hours || t.rwt)
    .filter((v) => v > 0);
  const frtValues = tickets
    .map((t) => t.custom_fields?.tnt__frt_hours || t.frt)
    .filter((v) => v > 0);
  const iterValues = tickets
    .map((t) => t.custom_fields?.tnt__iteration_count || t.iterations)
    .filter((v) => v > 0);
  const positiveCSAT = tickets.filter(
    (t) => Number(t.custom_fields?.tnt__csatrating || t.csat) === 2,
  ).length;
  const negativeCSAT = tickets.filter(
    (t) => Number(t.custom_fields?.tnt__csatrating || t.csat) === 1,
  ).length;
  const frrMet = tickets.filter(
    (t) =>
      t.custom_fields?.tnt__frr === true ||
      t.custom_fields?.tnt__iteration_count === 1 ||
      t.frr === 1,
  ).length;

  return {
    totalTickets: totalSolved,
    totalSolved,
    avgRWT:
      rwtValues.length > 0
        ? (rwtValues.reduce((a, b) => a + b, 0) / rwtValues.length).toFixed(2)
        : "0.00",
    avgFRT:
      frtValues.length > 0
        ? (frtValues.reduce((a, b) => a + b, 0) / frtValues.length).toFixed(2)
        : "0.00",
    avgIterations:
      iterValues.length > 0
        ? (iterValues.reduce((a, b) => a + b, 0) / iterValues.length).toFixed(1)
        : "0.0",
    positiveCSAT,
    negativeCSAT,
    csatPercent:
      positiveCSAT + negativeCSAT > 0
        ? Math.round((positiveCSAT / (positiveCSAT + negativeCSAT)) * 100)
        : 0,
    frrPercent: totalSolved > 0 ? Math.round((frrMet / totalSolved) * 100) : 0,
  };
};

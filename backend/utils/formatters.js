/**
 * Shared response formatting utilities.
 * Eliminates duplicated rounding, percentage, and data-shaping logic
 * across analyticsController, analyticsService, and gamificationController.
 */

/** CSAT percent — positive / (positive + negative) × 100. Returns 0 if no ratings. */
export const csatPercent = (pos, neg) =>
  pos + neg > 0 ? Math.round((pos / (pos + neg)) * 100) : 0;

/** FRR percent — met / total × 100. Returns 0 if no tickets. */
export const frrPercent = (met, total) =>
  total > 0 ? Math.round((met / total) * 100) : 0;

/** Safe round: returns 0 for null/undefined, otherwise rounds to N decimals. */
export const roundMetric = (val, decimals = 2) =>
  val ? Number(val.toFixed(decimals)) : 0;

/**
 * Format a raw trend aggregation result into the shape the frontend expects.
 * @param {Object} t - Raw $group result with _id as date string
 * @param {Object} [csatOverride] - Optional CSAT override (for NOC-inclusive CSAT)
 */
export const formatTrend = (t, csatOverride = null) => ({
  date: t._id,
  solved: t.solved,
  avgRWT: roundMetric(t.avgRWT),
  avgFRT: roundMetric(t.avgFRT),
  avgIterations: roundMetric(t.avgIterations, 1),
  positiveCSAT: csatOverride?.positiveCSAT ?? t.positiveCSAT,
  negativeCSAT: csatOverride?.negativeCSAT ?? (t.negativeCSAT || 0),
  frrMet: t.frrMet || 0,
  frrPercent: frrPercent(t.frrMet, t.frrTotal),
});

/**
 * Format a raw leaderboard aggregation result.
 * @param {Object} l - Raw $group result with _id as owner name
 * @param {Object} [csatOverride] - Optional CSAT override (for NOC-inclusive CSAT)
 */
export const formatLeaderboardEntry = (l, csatOverride = null) => {
  const good = csatOverride?.goodCSAT ?? (l.goodCSAT || 0);
  const bad = csatOverride?.badCSAT ?? (l.badCSAT || 0);
  return {
    name: l._id,
    totalTickets: l.totalTickets,
    goodCSAT: good,
    badCSAT: bad,
    winRate: csatPercent(good, bad),
    avgRWT: roundMetric(l.avgRWT),
    avgFRT: roundMetric(l.avgFRT),
  };
};

/**
 * Format a raw individual trend aggregation result.
 * @param {Object} item - Raw $group result with _id: { date, owner }
 * @param {Object} [csatOverride] - Optional CSAT override
 */
export const formatIndividualTrend = (item, csatOverride = null) => ({
  date: item._id.date,
  solved: item.solved,
  avgRWT: roundMetric(item.avgRWT),
  avgFRT: roundMetric(item.avgFRT),
  avgIterations: roundMetric(item.avgIterations, 1),
  positiveCSAT: csatOverride?.positiveCSAT ?? (item.positiveCSAT || 0),
  negativeCSAT: csatOverride?.negativeCSAT ?? (item.negativeCSAT || 0),
  frrMet: item.frrMet || 0,
  frrTotal: item.frrTotal || 0,
  frrPercent: frrPercent(item.frrMet, item.frrTotal),
  rwtValidCount: item.rwtValidCount || 0,
  frtValidCount: item.frtValidCount || 0,
  iterValidCount: item.iterValidCount || 0,
  backlogCleared: item.backlogCleared || 0,
});

/**
 * Group individual trend results by owner into a { owner: [...trends] } map.
 * @param {Array} items - Raw aggregation results
 * @param {Function} formatFn - Formatting function for each item (receives item, returns formatted)
 */
export const groupByOwner = (items, formatFn) =>
  items.reduce((acc, item) => {
    const owner = item._id.owner;
    if (!acc[owner]) acc[owner] = [];
    acc[owner].push(formatFn(item));
    return acc;
  }, {});

/**
 * Format overall stats result for the analytics dashboard response.
 * @param {Object} stats - Raw $group result (or null/undefined)
 * @param {Object} [csatOverride] - Optional CSAT override (for NOC-inclusive values)
 */
export const formatOverallStats = (stats, csatOverride = null) => {
  const pos = csatOverride?.positiveCSAT ?? (stats?.positiveCSAT || 0);
  const neg = csatOverride?.negativeCSAT ?? (stats?.negativeCSAT || 0);
  return {
    totalTickets: stats?.totalTickets || 0,
    avgRWT: roundMetric(stats?.avgRWT),
    avgFRT: roundMetric(stats?.avgFRT),
    avgIterations: roundMetric(stats?.avgIterations, 1),
    positiveCSAT: pos,
    negativeCSAT: neg,
    csatPercent: csatPercent(pos, neg),
    frrPercent: frrPercent(stats?.frrMet, stats?.frrTotal),
  };
};

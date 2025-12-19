/**
 * Reusable MongoDB aggregation $group field definitions.
 *
 * These are composable — spread them into your $group stage:
 *   { $group: { _id: null, ...csatFields(), ...frrFields() } }
 *
 * Each function returns a plain object of field definitions,
 * NOT a full $group stage, so you can mix and match.
 */

// --- Atomic field sets (compose these) ---

/** CSAT positive/negative counting — used in ~15 aggregation pipelines. */
export const csatFields = () => ({
  positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
  negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
});

/** FRR met counting. */
export const frrFields = () => ({
  frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
});

/** Conditional averages that skip 0/null values. */
export const avgMetricFields = () => ({
  avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
  avgFRT: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
  avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
});

/** Valid-count fields for "N of M" display on frontend. */
export const validCountFields = () => ({
  rwtValidCount: { $sum: { $cond: [{ $gt: ["$rwt", 0] }, 1, 0] } },
  frtValidCount: { $sum: { $cond: [{ $gt: ["$frt", 0] }, 1, 0] } },
  iterValidCount: { $sum: { $cond: [{ $gt: ["$iterations", 0] }, 1, 0] } },
});

// --- Pre-composed $group stages (use directly) ---

/**
 * Overall stats $group — analytics dashboard, live stats, precompute.
 * Groups all matching docs into a single result with totals and averages.
 */
export const overallStatsGroup = () => ({
  _id: null,
  totalTickets: { $sum: 1 },
  ...avgMetricFields(),
  ...csatFields(),
  frrMet: { $sum: "$frr" },
  frrTotal: { $sum: 1 },
});

/**
 * Per-owner stats $group — gamification, drill-down summary.
 * Groups by owner name with per-user metrics.
 */
export const ownerStatsGroup = () => ({
  _id: "$owner",
  solved: { $sum: 1 },
  ...avgMetricFields(),
  ...csatFields(),
  ...frrFields(),
});

/**
 * Trend $group by date — daily/weekly/monthly charts.
 * @param {string} dateFormat - MongoDB date format string (default: "%Y-%m-%d")
 */
export const trendGroup = (dateFormat = "%Y-%m-%d") => ({
  _id: { $dateToString: { format: dateFormat, date: "$closed_date" } },
  solved: { $sum: 1 },
  avgRWT: { $avg: "$rwt" },
  avgFRT: { $avg: "$frt" },
  avgIterations: { $avg: "$iterations" },
  ...csatFields(),
  ...frrFields(),
  frrTotal: { $sum: 1 },
});

/**
 * Individual trend $group by date + owner.
 * Requires a preceding $addFields stage with `ticketAge`.
 */
export const individualTrendGroup = () => ({
  _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } }, owner: "$owner" },
  solved: { $sum: 1 },
  ...avgMetricFields(),
  ...validCountFields(),
  ...csatFields(),
  ...frrFields(),
  frrTotal: { $sum: 1 },
  backlogCleared: { $sum: { $cond: [{ $gte: ["$ticketAge", 15] }, 1, 0] } },
});

/**
 * Leaderboard $group by owner — analytics dashboard.
 * Uses simple averages (not conditional) since we show all values.
 */
export const leaderboardGroup = () => ({
  _id: "$owner",
  totalTickets: { $sum: 1 },
  goodCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
  badCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
  avgRWT: { $avg: "$rwt" },
  avgFRT: { $avg: "$frt" },
});

/** Backlog clearance $addFields stage — calculates ticket age in days. */
export const ticketAgeAddFields = () => ({
  ticketAge: { $divide: [{ $subtract: ["$closed_date", "$created_date"] }, 1000 * 60 * 60 * 24] },
});

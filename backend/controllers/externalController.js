import { AnalyticsTicket } from "../models/index.js";
import {
  resolveDateRange,
  getCurrentQuarterKey,
  EMAIL_TO_NAME_MAP,
  GAMIFICATION_TEAM_MAP,
} from "../config/constants.js";
import logger from "../config/logger.js";
import { ok, badRequest, serverError } from "../utils/response.js";
import { csatPercent, roundMetric } from "../utils/formatters.js";
import { csatFields, avgMetricFields, frrFields } from "../utils/aggregationStages.js";
import { applyResolvedByFilter } from "../utils/queryBuilders.js";

/**
 * External API: Per-user CSAT breakdown.
 *
 * Returns who got how many positive/negative CSAT ratings.
 * Supports quarter preset or custom date range.
 *
 * GET /external/csat?quarter=Q1_26
 * GET /external/csat?startDate=2026-01-01&endDate=2026-03-31
 * GET /external/csat?quarter=Q1_26&email=rohan.jadhav@clevertap.com  (single user)
 */
export const getCSATBreakdown = async (req, res) => {
  try {
    const { quarter = getCurrentQuarterKey(), startDate, endDate, email, resolvedBy } = req.query;

    const range = resolveDateRange({ quarter, startDate, endDate });
    if (range.error) return badRequest(res, range.error);
    const { start, end, label } = range;

    // Per-user CSAT — agent ("Unassigned") is not a user, so exclude it.
    // The optional resolvedBy filter further narrows to engineer-only or agent-only,
    // but for a "per user" breakdown agent-only would always be empty (no users).
    const matchConditions = {
      closed_date: { $gte: start, $lte: end },
      owner: { $nin: [null, "", "Unassigned"] },
      csat: { $in: [1, 2] }, // only tickets that have CSAT ratings
    };
    applyResolvedByFilter(matchConditions, resolvedBy);

    if (email) {
      const userName = EMAIL_TO_NAME_MAP[email.toLowerCase()];
      if (!userName) return badRequest(res, "Unknown email. Not a GST user.");
      matchConditions.owner = userName;
    }

    logger.info({ label, email: email || "all" }, "External CSAT breakdown request");

    const [perUser, lastTicket] = await Promise.all([
      AnalyticsTicket.aggregate([
        { $match: matchConditions },
        {
          $group: {
            _id: "$owner",
            positive: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
            negative: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
            total: { $sum: 1 },
          },
        },
        { $sort: { positive: -1 } },
      ]).allowDiskUse(true),
      AnalyticsTicket.findOne(
        { closed_date: { $gte: start, $lte: end }, owner: { $nin: [null, ""] } },
        { closed_date: 1, _id: 0 },
      ).sort({ closed_date: -1 }).lean(),
    ]);

    const users = perUser.map((u) => {
      const pos = u.positive || 0;
      const neg = u.negative || 0;
      return {
        owner: u._id,
        team: GAMIFICATION_TEAM_MAP[u._id] || "Unknown",
        positive_csat: pos,
        negative_csat: neg,
        total_rated: u.total,
        csat_percent: csatPercent(pos, neg),
      };
    });

    const totalPositive = users.reduce((s, u) => s + u.positive_csat, 0);
    const totalNegative = users.reduce((s, u) => s + u.negative_csat, 0);

    ok(res, {
      quarter: label,
      date_range: { start: start.toISOString(), end: end.toISOString() },
      last_updated: lastTicket?.closed_date?.toISOString() || null,
      overall: {
        total_rated: totalPositive + totalNegative,
        positive: totalPositive,
        negative: totalNegative,
        csat_percent: csatPercent(totalPositive, totalNegative),
      },
      users,
    });
  } catch (e) {
    logger.error({ err: e }, "External CSAT breakdown error");
    serverError(res, e.message);
  }
};

/**
 * External API: GST-wide analytics summary.
 *
 * Returns overall GST team numbers — total solved, avg RWT, avg FRT,
 * avg iterations, FRR %, CSAT %. No individual breakdown.
 * Includes last_updated (latest closed_date) so consumers know data freshness.
 *
 * GET /external/analytics?quarter=Q1_26
 * GET /external/analytics?startDate=2026-01-01&endDate=2026-03-31
 */
export const getAnalyticsSummary = async (req, res) => {
  try {
    const { quarter = getCurrentQuarterKey(), startDate, endDate } = req.query;

    const range = resolveDateRange({ quarter, startDate, endDate });
    if (range.error) return badRequest(res, range.error);
    const { start, end, label } = range;

    logger.info({ label }, "External analytics summary request");

    const matchConditions = {
      closed_date: { $gte: start, $lte: end },
      is_noc: { $ne: true },
    };

    // CSAT always includes NOC tickets
    const csatMatch = { closed_date: { $gte: start, $lte: end } };

    const [overallArr, csatArr, lastTicket] = await Promise.all([
      AnalyticsTicket.aggregate([
        { $match: matchConditions },
        {
          $group: {
            _id: null,
            total_solved: { $sum: 1 },
            ...avgMetricFields(),
            ...frrFields(),
          },
        },
      ]).allowDiskUse(true),
      AnalyticsTicket.aggregate([
        { $match: { ...csatMatch, csat: { $in: [1, 2] } } },
        { $group: { _id: null, ...csatFields() } },
      ]).allowDiskUse(true),
      AnalyticsTicket.findOne(
        { closed_date: { $gte: start, $lte: end } },
        { closed_date: 1, _id: 0 },
      ).sort({ closed_date: -1 }).lean(),
    ]);

    const overall = overallArr[0] || {};
    const csat = csatArr[0] || { positiveCSAT: 0, negativeCSAT: 0 };
    const pos = csat.positiveCSAT || 0;
    const neg = csat.negativeCSAT || 0;

    ok(res, {
      quarter: label,
      date_range: { start: start.toISOString(), end: end.toISOString() },
      last_updated: lastTicket?.closed_date?.toISOString() || null,
      summary: {
        total_solved: overall.total_solved || 0,
        avg_rwt: roundMetric(overall.avgRWT),
        avg_frt: roundMetric(overall.avgFRT),
        avg_iterations: roundMetric(overall.avgIterations),
        frr_percent: overall.total_solved > 0
          ? Math.round(((overall.frrMet || 0) / overall.total_solved) * 100)
          : 0,
        csat_positive: pos,
        csat_negative: neg,
        csat_percent: csatPercent(pos, neg),
      },
    });
  } catch (e) {
    logger.error({ err: e }, "External analytics summary error");
    serverError(res, e.message);
  }
};

import { AnalyticsTicket } from "../models/index.js";
import {
  resolveDateRange,
  EMAIL_TO_NAME_MAP,
  GAMIFICATION_TEAM_MAP,
} from "../config/constants.js";
import logger from "../config/logger.js";
import { ok, badRequest, serverError } from "../utils/response.js";

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
    const { quarter = "Q1_26", startDate, endDate, email } = req.query;

    const range = resolveDateRange({ quarter, startDate, endDate });
    if (range.error) return badRequest(res, range.error);
    const { start, end, label } = range;

    // Optional: filter to a single user
    const matchConditions = {
      closed_date: { $gte: start, $lte: end },
      owner: { $nin: [null, ""] },
      csat: { $in: [1, 2] }, // only tickets that have CSAT ratings
    };

    if (email) {
      const userName = EMAIL_TO_NAME_MAP[email.toLowerCase()];
      if (!userName) return badRequest(res, "Unknown email. Not a GST user.");
      matchConditions.owner = userName;
    }

    logger.info({ label, email: email || "all" }, "External CSAT breakdown request");

    const perUser = await AnalyticsTicket.aggregate([
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
        csat_percent: pos + neg > 0 ? Math.round((pos / (pos + neg)) * 100) : 0,
      };
    });

    // Overall totals
    const totalPositive = users.reduce((s, u) => s + u.positive_csat, 0);
    const totalNegative = users.reduce((s, u) => s + u.negative_csat, 0);

    ok(res, {
      quarter: label,
      date_range: { start: start.toISOString(), end: end.toISOString() },
      overall: {
        total_rated: totalPositive + totalNegative,
        positive: totalPositive,
        negative: totalNegative,
        csat_percent: totalPositive + totalNegative > 0
          ? Math.round((totalPositive / (totalPositive + totalNegative)) * 100)
          : 0,
      },
      users,
    });
  } catch (e) {
    logger.error({ err: e }, "External CSAT breakdown error");
    serverError(res, e.message);
  }
};

/**
 * External API: Overall analytics summary.
 *
 * Returns high-level numbers: total solved, avg RWT, avg FRT,
 * avg iterations, FRR %, CSAT %, and per-owner leaderboard.
 *
 * GET /external/analytics?quarter=Q1_26
 * GET /external/analytics?startDate=2026-01-01&endDate=2026-03-31
 */
export const getAnalyticsSummary = async (req, res) => {
  try {
    const { quarter = "Q1_26", startDate, endDate } = req.query;

    const range = resolveDateRange({ quarter, startDate, endDate });
    if (range.error) return badRequest(res, range.error);
    const { start, end, label } = range;

    logger.info({ label }, "External analytics summary request");

    const matchConditions = {
      closed_date: { $gte: start, $lte: end },
      owner: { $nin: [null, ""] },
      is_noc: { $ne: true },
    };

    // CSAT always includes NOC tickets
    const csatMatch = { ...matchConditions };
    delete csatMatch.is_noc;

    const [overallArr, csatArr, perOwner] = await Promise.all([
      // Overall stats (NOC excluded)
      AnalyticsTicket.aggregate([
        { $match: matchConditions },
        {
          $group: {
            _id: null,
            total_solved: { $sum: 1 },
            avg_rwt: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
            avg_frt: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
            avg_iterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
            frr_met: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
          },
        },
      ]),

      // CSAT overall (NOC included)
      AnalyticsTicket.aggregate([
        { $match: { ...csatMatch, csat: { $in: [1, 2] } } },
        {
          $group: {
            _id: null,
            positive: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
            negative: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          },
        },
      ]),

      // Per-owner breakdown (NOC excluded for general, but includes CSAT from all)
      AnalyticsTicket.aggregate([
        { $match: matchConditions },
        {
          $group: {
            _id: "$owner",
            solved: { $sum: 1 },
            avg_rwt: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
            avg_frt: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
            avg_iterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
            frr_met: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
            positive_csat: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
            negative_csat: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          },
        },
        { $sort: { solved: -1 } },
      ]),
    ]);

    const overall = overallArr[0] || {};
    const csat = csatArr[0] || { positive: 0, negative: 0 };
    const pos = csat.positive || 0;
    const neg = csat.negative || 0;

    ok(res, {
      quarter: label,
      date_range: { start: start.toISOString(), end: end.toISOString() },
      summary: {
        total_solved: overall.total_solved || 0,
        avg_rwt: overall.avg_rwt ? parseFloat(overall.avg_rwt.toFixed(2)) : 0,
        avg_frt: overall.avg_frt ? parseFloat(overall.avg_frt.toFixed(2)) : 0,
        avg_iterations: overall.avg_iterations ? parseFloat(overall.avg_iterations.toFixed(2)) : 0,
        frr_percent: overall.total_solved > 0
          ? Math.round(((overall.frr_met || 0) / overall.total_solved) * 100)
          : 0,
        csat_positive: pos,
        csat_negative: neg,
        csat_percent: pos + neg > 0 ? Math.round((pos / (pos + neg)) * 100) : 0,
      },
      per_owner: perOwner.map((o) => {
        const p = o.positive_csat || 0;
        const n = o.negative_csat || 0;
        return {
          owner: o._id,
          team: GAMIFICATION_TEAM_MAP[o._id] || "Unknown",
          solved: o.solved,
          avg_rwt: o.avg_rwt ? parseFloat(o.avg_rwt.toFixed(2)) : 0,
          avg_frt: o.avg_frt ? parseFloat(o.avg_frt.toFixed(2)) : 0,
          avg_iterations: o.avg_iterations ? parseFloat(o.avg_iterations.toFixed(2)) : 0,
          frr_percent: o.solved > 0 ? Math.round((o.frr_met / o.solved) * 100) : 0,
          positive_csat: p,
          negative_csat: n,
          csat_percent: p + n > 0 ? Math.round((p / (p + n)) * 100) : 0,
        };
      }),
    });
  } catch (e) {
    logger.error({ err: e }, "External analytics summary error");
    serverError(res, e.message);
  }
};

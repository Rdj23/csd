import { AnalyticsTicket } from "../models/index.js";
import {
  resolveDateRange,
  getCurrentQuarterKey,
  DESIGNATION_MAP,
  GAMIFICATION_TEAM_MAP,
  NAME_TO_ROSTER_MAP,
  EMAIL_TO_NAME_MAP,
  isGamificationExcluded,
} from "../config/constants.js";
import { getDaysWorked, isInRoster } from "../services/rosterService.js";
import { ok, badRequest, fail, serverError } from "../utils/response.js";
import logger from "../config/logger.js";
import { ownerStatsGroup, csatFields } from "../utils/aggregationStages.js";
import { csatPercent, frrPercent, roundMetric } from "../utils/formatters.js";
import { scoreAndRank } from "../utils/scoring.js";

/**
 * buildScoredBoard — SINGLE SOURCE OF TRUTH for gamification numbers.
 *
 * Both the admin leaderboard (getGamification) and the member view
 * (getMyStats) MUST read from this. They previously ran different formulas
 * over different peer pools — my-stats included ex-roster + "Unassigned"
 * owners and averaged the six metric percentiles, while the board ranked
 * the weighted composite score over roster-only peers — so the same
 * engineer saw a different Final % depending on who was looking.
 */
const buildScoredBoard = async (start, end) => {
  // Main stats aggregation (excludes NOC for general metrics)
  // Exclude unassigned tickets — only count tickets with a real GST owner.
  const baseMatch = {
    closed_date: { $gte: start, $lte: end },
    owner: { $nin: [null, "", "Unassigned", "unassigned"] },
  };
  const [stats, csatStats] = await Promise.all([
    AnalyticsTicket.aggregate([
      { $match: { ...baseMatch, is_noc: { $ne: true } } },
      { $group: ownerStatsGroup() },
    ]).allowDiskUse(true),
    // CSAT/DSAT always includes NOC tickets
    AnalyticsTicket.aggregate([
      { $match: baseMatch },
      { $group: { _id: "$owner", ...csatFields() } },
    ]).allowDiskUse(true),
  ]);

  // Build CSAT lookup from NOC-inclusive query
  const csatByOwner = {};
  csatStats.forEach(c => { csatByOwner[c._id] = c; });

  const data = { L1: [], L2: [] };

  stats.forEach(s => {
    const name = s._id;
    // Skip engineers who have been removed from the active roster (e.g. transfers).
    // Their historic tickets stay in DB but they should not appear in gamification.
    if (!isInRoster(name)) return;
    // Hard-exclude leavers (e.g. Debashish) from the leaderboard entirely.
    if (isGamificationExcluded(name)) return;
    const designation = DESIGNATION_MAP[name] || "L1";
    const team = GAMIFICATION_TEAM_MAP[name] || "Unknown";
    const daysWorked = getDaysWorked(name, start, end);
    const productivity = daysWorked > 0 ? parseFloat((s.solved / daysWorked).toFixed(2)) : 0;
    const ownerCsat = csatByOwner[name] || s;
    const posCSAT = ownerCsat.positiveCSAT || 0;
    const negCSAT = ownerCsat.negativeCSAT || 0;

    const entry = {
      name, team, designation, daysWorked,
      solved: s.solved,
      productivity,
      csatPercent: negCSAT > 0 ? csatPercent(posCSAT, negCSAT) : 100,
      positiveCSAT: posCSAT,
      avgRWT: roundMetric(s.avgRWT, 1),
      avgIterations: roundMetric(s.avgIterations),
      frrPercent: frrPercent(s.frrMet, s.solved),
    };

    if (designation === "L2") { data.L2.push(entry); } else { data.L1.push(entry); }
  });

  // Full scoring pipeline: percentiles → normalization → weighted score → rank
  // Extracted to utils/scoring.js for testability and Single Responsibility.
  // See scoring.js for detailed documentation of the 3-stage pipeline.
  scoreAndRank(data.L1);
  scoreAndRank(data.L2);

  return data;
};

export const getGamification = async (req, res) => {
  try {
    const { quarter = getCurrentQuarterKey(), startDate, endDate } = req.query;
    const range = resolveDateRange({ quarter, startDate, endDate });
    if (range.error) return badRequest(res, range.error);
    const { start, end, label } = range;

    logger.info({ label, start: start.toDateString(), end: end.toDateString() }, "Gamification request");

    const data = await buildScoredBoard(start, end);

    ok(res, {
      quarter: label,
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      data,
      totalL1: data.L1.length,
      totalL2: data.L2.length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (e) {
    logger.error({ err: e }, "Gamification error");
    serverError(res, e.message);
  }
};

export const getMyTickets = async (req, res) => {
  try {
    const { quarter = getCurrentQuarterKey(), email, startDate, endDate } = req.query;

    if (!email) {
      return badRequest(res, "Email is required");
    }

    const userName = EMAIL_TO_NAME_MAP[email.toLowerCase()];
    if (!userName) {
      return fail(res, 403, "Unauthorized: Not a GST user");
    }

    const range = resolveDateRange({ quarter, startDate, endDate });
    if (range.error) return badRequest(res, range.error);
    const { start, end, label } = range;
    logger.info({ userName, email, label }, "My Tickets request");

    const tickets = await AnalyticsTicket.find(
      {
        closed_date: { $gte: start, $lte: end },
        owner: userName,
        is_noc: { $ne: true },
      },
      {
        display_id: 1, title: 1, closed_date: 1, stage_name: 1,
        account_name: 1, csat: 1, rwt: 1, iterations: 1, frr: 1,
        account_cohort: 1, _id: 0,
      }
    ).sort({ closed_date: -1 }).lean();

    // Also fetch NOC tickets separately (they affect CSAT)
    const nocTickets = await AnalyticsTicket.find(
      {
        closed_date: { $gte: start, $lte: end },
        owner: userName,
        is_noc: true,
      },
      {
        display_id: 1, title: 1, closed_date: 1, stage_name: 1,
        account_name: 1, csat: 1, _id: 0,
      }
    ).sort({ closed_date: -1 }).lean();

    ok(res, {
      quarter: label,
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      owner: userName,
      totalSolved: tickets.length,
      totalNOC: nocTickets.length,
      tickets,
      nocTickets,
    });
  } catch (e) {
    logger.error({ err: e }, "My Tickets error");
    serverError(res, e.message);
  }
};

export const getMyStats = async (req, res) => {
  try {
    const { quarter = getCurrentQuarterKey(), email, startDate, endDate } = req.query;

    if (!email) {
      return badRequest(res, "Email is required");
    }

    const userName = EMAIL_TO_NAME_MAP[email.toLowerCase()];
    if (!userName) {
      return fail(res, 403, "Unauthorized: Not a GST user");
    }

    const range = resolveDateRange({ quarter, startDate, endDate });
    if (range.error) return badRequest(res, range.error);
    const { start, end, label } = range;
    logger.info({ userName, email, label }, "My Stats request");

    // Same pipeline as the admin leaderboard — the member view must show
    // EXACTLY the number the board shows (same formula, same peer pool).
    const board = await buildScoredBoard(start, end);
    const entry = [...board.L1, ...board.L2].find((e) => e.name === userName);
    if (entry) {
      return ok(res, {
        quarter: label,
        dateRange: { start: start.toISOString(), end: end.toISOString() },
        userData: entry,
        lastUpdated: new Date().toISOString(),
      });
    }

    // Not on the board this window (zero non-NOC solved tickets) — return a
    // zeroed card. CSAT may still exist via NOC tickets, which the board's
    // non-NOC pipeline won't surface.
    const myCSAT = await AnalyticsTicket.aggregate([
      { $match: { closed_date: { $gte: start, $lte: end }, owner: userName } },
      { $group: { _id: "$owner", ...csatFields() } },
    ]).allowDiskUse(true);

    const daysWorked = getDaysWorked(userName, start, end);

    // Even with no non-NOC tickets, check CSAT from NOC tickets
    const myCsatData = myCSAT[0] || { positiveCSAT: 0, negativeCSAT: 0 };
    ok(res, {
      quarter: label,
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      userData: {
        name: userName,
        team: GAMIFICATION_TEAM_MAP[userName] || "Unknown",
        designation: DESIGNATION_MAP[userName] || "L1",
        daysWorked,
        solved: 0, productivity: 0,
        csatPercent: myCsatData.negativeCSAT > 0
          ? Math.round((myCsatData.positiveCSAT / (myCsatData.positiveCSAT + myCsatData.negativeCSAT)) * 100)
          : 100,
        positiveCSAT: myCsatData.positiveCSAT || 0,
        avgRWT: 0, avgIterations: 0, frrPercent: 0,
        productivityPercentile: 0,
        csatPercentPercentile: 100,
        positiveCSATPercentile: 0,
        avgRWTPercentile: 0,
        avgIterationsPercentile: 0,
        frrPercentPercentile: 0,
        percentile: 0,
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (e) {
    logger.error({ err: e }, "My Stats error");
    serverError(res, e.message);
  }
};

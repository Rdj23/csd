import { AnalyticsTicket } from "../models/index.js";
import {
  getQuarterDateRange,
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
import { scoreAndRank, calculatePercentile } from "../utils/scoring.js";

export const getGamification = async (req, res) => {
  try {
    const { quarter = getCurrentQuarterKey(), startDate, endDate } = req.query;
    const range = resolveDateRange({ quarter, startDate, endDate });
    if (range.error) return badRequest(res, range.error);
    const { start, end, label } = range;

    logger.info({ label, start: start.toDateString(), end: end.toDateString() }, "Gamification request");

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

    // Run general stats (NOC excluded) and CSAT stats (NOC included) in parallel
    const myBaseMatch = { closed_date: { $gte: start, $lte: end }, owner: userName };
    const [stats, myCSAT] = await Promise.all([
      AnalyticsTicket.aggregate([
        { $match: { ...myBaseMatch, is_noc: { $ne: true } } },
        { $group: ownerStatsGroup() },
      ]).allowDiskUse(true),
      AnalyticsTicket.aggregate([
        { $match: myBaseMatch },
        { $group: { _id: "$owner", ...csatFields() } },
      ]).allowDiskUse(true),
    ]);

    const daysWorked = getDaysWorked(userName, start, end);

    if (stats.length === 0) {
      // Even with no non-NOC tickets, check CSAT from NOC tickets
      const myCsatData = myCSAT[0] || { positiveCSAT: 0, negativeCSAT: 0 };
      return ok(res, {
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
    }

    const s = stats[0];
    // Use NOC-inclusive CSAT values
    const myCsatData = myCSAT[0] || s;
    const myPosCSAT = myCsatData.positiveCSAT || 0;
    const myNegCSAT = myCsatData.negativeCSAT || 0;
    const productivity = daysWorked > 0 ? parseFloat((s.solved / daysWorked).toFixed(2)) : 0;
    const csatPercent = myNegCSAT > 0
      ? Math.round((myPosCSAT / (myPosCSAT + myNegCSAT)) * 100)
      : 100;
    const frrPercent = s.solved > 0 ? Math.round((s.frrMet / s.solved) * 100) : 0;

    const designation = DESIGNATION_MAP[userName] || "L1";
    // Run all-team stats (NOC excluded) and all-team CSAT (NOC included) in parallel
    const allBaseMatch = { closed_date: { $gte: start, $lte: end }, owner: { $nin: [null, ""] } };
    const [allStats, allCSATStats] = await Promise.all([
      AnalyticsTicket.aggregate([
        { $match: { ...allBaseMatch, is_noc: { $ne: true } } },
        { $group: ownerStatsGroup() },
      ]).allowDiskUse(true),
      AnalyticsTicket.aggregate([
        { $match: allBaseMatch },
        { $group: { _id: "$owner", ...csatFields() } },
      ]).allowDiskUse(true),
    ]);

    // Build CSAT lookup for all owners
    const allCSATByOwner = {};
    allCSATStats.forEach(c => { allCSATByOwner[c._id] = c; });

    // Merge NOC-inclusive CSAT into allStats for percentile calculation
    const teamData = allStats
      .filter(stat => (DESIGNATION_MAP[stat._id] || "L1") === designation)
      .filter(stat => !isGamificationExcluded(stat._id))
      .map(stat => {
        const ownerCsat = allCSATByOwner[stat._id] || stat;
        return { ...stat, positiveCSAT: ownerCsat.positiveCSAT || 0, negativeCSAT: ownerCsat.negativeCSAT || 0 };
      });

    // calculatePercentile imported from utils/scoring.js — no inline duplicate needed

    const productivityValues = teamData.map(t => {
      const days = getDaysWorked(t._id, start, end);
      return days > 0 ? parseFloat((t.solved / days).toFixed(2)) : 0;
    });
    const csatPercentValues = teamData.map(t => t.negativeCSAT > 0
      ? Math.round((t.positiveCSAT / (t.positiveCSAT + t.negativeCSAT)) * 100)
      : 100);
    const positiveCSATValues = teamData.map(t => t.positiveCSAT || 0);
    const avgRWTValues = teamData.map(t => t.avgRWT ? parseFloat(t.avgRWT.toFixed(1)) : 0);
    const avgIterationsValues = teamData.map(t => t.avgIterations ? parseFloat(t.avgIterations.toFixed(2)) : 0);
    const frrPercentValues = teamData.map(t => t.solved > 0 ? Math.round((t.frrMet / t.solved) * 100) : 0);

    const productivityPercentile = calculatePercentile(productivity, productivityValues);
    const csatPercentPercentile = calculatePercentile(csatPercent, csatPercentValues);
    const positiveCSATPercentile = calculatePercentile(myPosCSAT, positiveCSATValues);
    const avgRWTPercentile = calculatePercentile(parseFloat((s.avgRWT || 0).toFixed(1)), avgRWTValues, true);
    const avgIterationsPercentile = calculatePercentile(parseFloat((s.avgIterations || 0).toFixed(2)), avgIterationsValues, true);
    const frrPercentPercentile = calculatePercentile(frrPercent, frrPercentValues);

    const weights = {
      productivity: 30,
      csatPercent: 15,
      positiveCSAT: 10,
      avgRWT: 15,
      avgIterations: 15,
      frrPercent: 15,
    };

    const finalPercentile = Math.round(
      (productivityPercentile * weights.productivity +
       csatPercentPercentile * weights.csatPercent +
       positiveCSATPercentile * weights.positiveCSAT +
       avgRWTPercentile * weights.avgRWT +
       avgIterationsPercentile * weights.avgIterations +
       frrPercentPercentile * weights.frrPercent) / 100
    );

    ok(res, {
      quarter: label,
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      userData: {
        name: userName,
        team: GAMIFICATION_TEAM_MAP[userName] || "Unknown",
        designation,
        daysWorked,
        solved: s.solved,
        productivity, csatPercent,
        positiveCSAT: myPosCSAT,
        avgRWT: s.avgRWT ? parseFloat(s.avgRWT.toFixed(1)) : 0,
        avgIterations: s.avgIterations ? parseFloat(s.avgIterations.toFixed(2)) : 0,
        frrPercent,
        productivityPercentile, csatPercentPercentile,
        positiveCSATPercentile, avgRWTPercentile,
        avgIterationsPercentile, frrPercentPercentile,
        percentile: finalPercentile,
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (e) {
    logger.error({ err: e }, "My Stats error");
    serverError(res, e.message);
  }
};

import { AnalyticsTicket } from "../models/index.js";
import {
  getQuarterDateRange,
  resolveDateRange,
  DESIGNATION_MAP,
  GAMIFICATION_TEAM_MAP,
  NAME_TO_ROSTER_MAP,
  EMAIL_TO_NAME_MAP,
} from "../config/constants.js";
import { getDaysWorked } from "../services/rosterService.js";
import { ok, badRequest, fail, serverError } from "../utils/response.js";
import logger from "../config/logger.js";

export const getGamification = async (req, res) => {
  try {
    const { quarter = "Q1_26", startDate, endDate } = req.query;
    const range = resolveDateRange({ quarter, startDate, endDate });
    if (range.error) return badRequest(res, range.error);
    const { start, end, label } = range;

    logger.info({ label, start: start.toDateString(), end: end.toDateString() }, "Gamification request");

    // Main stats aggregation (excludes NOC for general metrics)
    const [stats, csatStats] = await Promise.all([
      AnalyticsTicket.aggregate([
        {
          $match: {
            closed_date: { $gte: start, $lte: end },
            owner: { $nin: [null, ""] },
            is_noc: { $ne: true }
          }
        },
        {
          $group: {
            _id: "$owner",
            solved: { $sum: 1 },
            avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
            avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
            positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
            negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
            frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
          },
        },
      ]),
      // CSAT/DSAT always includes NOC tickets
      AnalyticsTicket.aggregate([
        {
          $match: {
            closed_date: { $gte: start, $lte: end },
            owner: { $nin: [null, ""] },
          }
        },
        {
          $group: {
            _id: "$owner",
            positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
            negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          },
        },
      ]),
    ]);

    // Build CSAT lookup from NOC-inclusive query
    const csatByOwner = {};
    csatStats.forEach(c => { csatByOwner[c._id] = c; });

    const data = { L1: [], L2: [] };

    stats.forEach(s => {
      const name = s._id;
      const designation = DESIGNATION_MAP[name] || "L1";
      const team = GAMIFICATION_TEAM_MAP[name] || "Unknown";
      const daysWorked = getDaysWorked(name, start);
      const productivity = daysWorked > 0 ? parseFloat((s.solved / daysWorked).toFixed(2)) : 0;
      // Use NOC-inclusive CSAT values
      const ownerCsat = csatByOwner[name] || s;
      const posCSAT = ownerCsat.positiveCSAT || 0;
      const negCSAT = ownerCsat.negativeCSAT || 0;
      const csatPercent = negCSAT > 0
        ? Math.round((posCSAT / (posCSAT + negCSAT)) * 100)
        : 100;
      const frrPercent = s.solved > 0 ? Math.round((s.frrMet / s.solved) * 100) : 0;

      const entry = {
        name, team, designation, daysWorked,
        solved: s.solved,
        productivity, csatPercent,
        positiveCSAT: posCSAT,
        avgRWT: s.avgRWT ? parseFloat(s.avgRWT.toFixed(1)) : 0,
        avgIterations: s.avgIterations ? parseFloat(s.avgIterations.toFixed(2)) : 0,
        frrPercent,
      };

      if (designation === "L2") { data.L2.push(entry); } else { data.L1.push(entry); }
    });

    // STEP 1: Calculate per-metric PERCENTILES (for DISPLAY ONLY)
    const calculateMetricPercentiles = (arr, metricKey, lowerIsBetter = false) => {
      const total = arr.length;
      if (total === 0) return;
      const sorted = [...arr].sort((a, b) => {
        if (lowerIsBetter) return a[metricKey] - b[metricKey];
        return b[metricKey] - a[metricKey];
      });
      sorted.forEach((entry, idx) => {
        const rank = idx + 1;
        const original = arr.find(e => e.name === entry.name);
        if (original) {
          original[`${metricKey}Rank`] = rank;
          original[`${metricKey}Percentile`] = Math.round(((total - rank + 1) / total) * 100);
        }
      });
    };

    calculateMetricPercentiles(data.L1, "productivity", false);
    calculateMetricPercentiles(data.L1, "csatPercent", false);
    calculateMetricPercentiles(data.L1, "positiveCSAT", false);
    calculateMetricPercentiles(data.L1, "avgRWT", true);
    calculateMetricPercentiles(data.L1, "avgIterations", true);
    calculateMetricPercentiles(data.L1, "frrPercent", false);

    calculateMetricPercentiles(data.L2, "productivity", false);
    calculateMetricPercentiles(data.L2, "csatPercent", false);
    calculateMetricPercentiles(data.L2, "positiveCSAT", false);
    calculateMetricPercentiles(data.L2, "avgRWT", true);
    calculateMetricPercentiles(data.L2, "avgIterations", true);
    calculateMetricPercentiles(data.L2, "frrPercent", false);

    // STEP 2: Calculate NORMALIZED SCORES (0-100) using Min-Max normalization
    const calculateNormalizedScores = (arr) => {
      if (arr.length === 0) return;
      const metrics = [
        { key: "productivity", lowerIsBetter: false },
        { key: "csatPercent", lowerIsBetter: false },
        { key: "positiveCSAT", lowerIsBetter: false },
        { key: "avgRWT", lowerIsBetter: true },
        { key: "avgIterations", lowerIsBetter: true },
        { key: "frrPercent", lowerIsBetter: false },
      ];

      metrics.forEach(({ key, lowerIsBetter }) => {
        const values = arr.map(e => e[key] || 0);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min;

        arr.forEach(e => {
          const value = e[key] || 0;
          let normalizedScore;
          if (range === 0) {
            normalizedScore = 100;
          } else if (lowerIsBetter) {
            normalizedScore = ((max - value) / range) * 100;
          } else {
            normalizedScore = ((value - min) / range) * 100;
          }
          e[`${key}NormScore`] = parseFloat(normalizedScore.toFixed(2));
        });
      });
    };

    calculateNormalizedScores(data.L1);
    calculateNormalizedScores(data.L2);

    // STEP 3: Calculate FINAL SCORE using weighted sum of NORMALIZED SCORES
    const calculateFinalScore = (e, isL2) => {
      const csatWeight = isL2 ? 0.20 : 0.15;
      return (
        (e.productivityNormScore || 0) * 0.30 +
        (e.csatPercentNormScore || 0) * csatWeight +
        (e.positiveCSATNormScore || 0) * 0.10 +
        (e.avgRWTNormScore || 0) * 0.15 +
        (e.avgIterationsNormScore || 0) * 0.15 +
        (e.frrPercentNormScore || 0) * 0.15
      );
    };

    data.L1.forEach(e => { e.finalScore = parseFloat(calculateFinalScore(e, false).toFixed(2)); });
    data.L2.forEach(e => { e.finalScore = parseFloat(calculateFinalScore(e, true).toFixed(2)); });
    data.L1.forEach(e => { e.weightedAvg = e.finalScore; });
    data.L2.forEach(e => { e.weightedAvg = e.finalScore; });

    // STEP 4: Sort by finalScore with DETERMINISTIC tie-breaking
    data.L1.sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      return a.name.localeCompare(b.name);
    });
    data.L2.sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      return a.name.localeCompare(b.name);
    });

    const totalL1 = data.L1.length;
    const totalL2 = data.L2.length;
    data.L1.forEach((e, i) => {
      e.rank = i + 1;
      e.percentile = totalL1 > 0 ? Math.round(((totalL1 - e.rank + 1) / totalL1) * 100) : 0;
    });
    data.L2.forEach((e, i) => {
      e.rank = i + 1;
      e.percentile = totalL2 > 0 ? Math.round(((totalL2 - e.rank + 1) / totalL2) * 100) : 0;
    });

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
    const { quarter = "Q1_26", email, startDate, endDate } = req.query;

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
    const { quarter = "Q1_26", email, startDate, endDate } = req.query;

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
    const [stats, myCSAT] = await Promise.all([
      AnalyticsTicket.aggregate([
        {
          $match: {
            closed_date: { $gte: start, $lte: end },
            owner: userName,
            is_noc: { $ne: true }
          }
        },
        {
          $group: {
            _id: "$owner",
            solved: { $sum: 1 },
            avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
            avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
            positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
            negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
            frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
          },
        },
      ]),
      // CSAT/DSAT always includes NOC tickets
      AnalyticsTicket.aggregate([
        {
          $match: {
            closed_date: { $gte: start, $lte: end },
            owner: userName,
          }
        },
        {
          $group: {
            _id: "$owner",
            positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
            negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const daysWorked = getDaysWorked(userName, start);

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
    const [allStats, allCSATStats] = await Promise.all([
      AnalyticsTicket.aggregate([
        {
          $match: {
            closed_date: { $gte: start, $lte: end },
            owner: { $nin: [null, ""] },
            is_noc: { $ne: true }
          }
        },
        {
          $group: {
            _id: "$owner",
            solved: { $sum: 1 },
            avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
            avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
            positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
            negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
            frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
          },
        },
      ]),
      // CSAT/DSAT for all owners (NOC included) for percentile calculation
      AnalyticsTicket.aggregate([
        {
          $match: {
            closed_date: { $gte: start, $lte: end },
            owner: { $nin: [null, ""] },
          }
        },
        {
          $group: {
            _id: "$owner",
            positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
            negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          },
        },
      ]),
    ]);

    // Build CSAT lookup for all owners
    const allCSATByOwner = {};
    allCSATStats.forEach(c => { allCSATByOwner[c._id] = c; });

    // Merge NOC-inclusive CSAT into allStats for percentile calculation
    const teamData = allStats
      .filter(stat => (DESIGNATION_MAP[stat._id] || "L1") === designation)
      .map(stat => {
        const ownerCsat = allCSATByOwner[stat._id] || stat;
        return { ...stat, positiveCSAT: ownerCsat.positiveCSAT || 0, negativeCSAT: ownerCsat.negativeCSAT || 0 };
      });

    const calculatePercentile = (value, allValues, lowerIsBetter = false) => {
      if (allValues.length === 0) return 0;
      const sorted = [...allValues].sort((a, b) => lowerIsBetter ? a - b : b - a);
      const tolerance = 0.001;
      let rank = sorted.findIndex(v => Math.abs(v - value) < tolerance) + 1;
      if (rank === 0) {
        if (lowerIsBetter) {
          rank = sorted.filter(v => v < value).length + 1;
        } else {
          rank = sorted.filter(v => v > value).length + 1;
        }
      }
      const percentile = Math.round(((allValues.length - rank + 1) / allValues.length) * 100);
      return Math.min(percentile, 100);
    };

    const productivityValues = teamData.map(t => {
      const days = getDaysWorked(t._id, start);
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

    const isL2 = designation === "L2";
    const weights = {
      productivity: 30,
      csatPercent: isL2 ? 20 : 15,
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

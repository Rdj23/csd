import { AnalyticsTicket } from "../models/index.js";
import {
  getQuarterDateRange,
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
    const { quarter = "Q1_26" } = req.query;
    const { start, end } = getQuarterDateRange(quarter);

    logger.info({ quarter, start: start.toDateString(), end: end.toDateString() }, "Gamification request");

    const stats = await AnalyticsTicket.aggregate([
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
    ]);

    const data = { L1: [], L2: [] };

    stats.forEach(s => {
      const name = s._id;
      const designation = DESIGNATION_MAP[name] || "L1";
      const team = GAMIFICATION_TEAM_MAP[name] || "Unknown";
      const daysWorked = getDaysWorked(name, start);
      const productivity = daysWorked > 0 ? parseFloat((s.solved / daysWorked).toFixed(2)) : 0;
      const csatPercent = s.negativeCSAT > 0
        ? Math.round((s.positiveCSAT / (s.positiveCSAT + s.negativeCSAT)) * 100)
        : 100;
      const frrPercent = s.solved > 0 ? Math.round((s.frrMet / s.solved) * 100) : 0;

      const entry = {
        name, team, designation, daysWorked,
        solved: s.solved,
        productivity, csatPercent,
        positiveCSAT: s.positiveCSAT,
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
      quarter,
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

export const getMyStats = async (req, res) => {
  try {
    const { quarter = "Q1_26", email } = req.query;

    if (!email) {
      return badRequest(res, "Email is required");
    }

    const userName = EMAIL_TO_NAME_MAP[email.toLowerCase()];
    if (!userName) {
      return fail(res, 403, "Unauthorized: Not a GST user");
    }

    const { start, end } = getQuarterDateRange(quarter);
    logger.info({ userName, email, quarter }, "My Stats request");

    const stats = await AnalyticsTicket.aggregate([
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
    ]);

    const daysWorked = getDaysWorked(userName, start);

    if (stats.length === 0) {
      return ok(res, {
        quarter,
        dateRange: { start: start.toISOString(), end: end.toISOString() },
        userData: {
          name: userName,
          team: GAMIFICATION_TEAM_MAP[userName] || "Unknown",
          designation: DESIGNATION_MAP[userName] || "L1",
          daysWorked,
          solved: 0, productivity: 0,
          csatPercent: 100, positiveCSAT: 0,
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
    const productivity = daysWorked > 0 ? parseFloat((s.solved / daysWorked).toFixed(2)) : 0;
    const csatPercent = s.negativeCSAT > 0
      ? Math.round((s.positiveCSAT / (s.positiveCSAT + s.negativeCSAT)) * 100)
      : 100;
    const frrPercent = s.solved > 0 ? Math.round((s.frrMet / s.solved) * 100) : 0;

    const designation = DESIGNATION_MAP[userName] || "L1";
    const allStats = await AnalyticsTicket.aggregate([
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
    ]);

    const teamData = allStats.filter(stat => (DESIGNATION_MAP[stat._id] || "L1") === designation);

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
    const positiveCSATPercentile = calculatePercentile(s.positiveCSAT, positiveCSATValues);
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
      quarter,
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      userData: {
        name: userName,
        team: GAMIFICATION_TEAM_MAP[userName] || "Unknown",
        designation,
        daysWorked,
        solved: s.solved,
        productivity, csatPercent,
        positiveCSAT: s.positiveCSAT,
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

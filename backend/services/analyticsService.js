import { AnalyticsTicket, PrecomputedDashboard } from "../models/index.js";
import { getQuarterDateRange } from "../config/constants.js";
import logger from "../config/logger.js";
import { overallStatsGroup, trendGroup, leaderboardGroup, individualTrendGroup, ticketAgeAddFields } from "../utils/aggregationStages.js";
import { formatTrend, formatLeaderboardEntry, formatIndividualTrend, formatOverallStats, groupByOwner } from "../utils/formatters.js";

// precomputeAnalytics is now called by the Worker via BullMQ jobs.
// warmCache and runInitialPrecomputation are replaced by BullMQ startup jobs.

export const precomputeAnalytics = async (quarter) => {
  const cacheType = quarter.toLowerCase().replace("_", "");

  try {
    // Atomic lock: only proceeds if computing is not already true.
    const lockResult = await PrecomputedDashboard.findOneAndUpdate(
      { cache_type: cacheType, computing: { $ne: true } },
      { $set: { computing: true } },
      { upsert: true, returnDocument: "after" }
    );
    if (!lockResult) {
      logger.info({ quarter }, "Skipping quarter - already computing");
      return;
    }

    logger.info({ quarter }, "Pre-computing analytics");

    const { start, end } = getQuarterDateRange(quarter);
    const matchConditions = { closed_date: { $gte: start, $lte: end } };

    const [statsResult] = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $group: overallStatsGroup() },
    ]).allowDiskUse(true);

    const trends = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $group: trendGroup() },
      { $sort: { _id: 1 } },
      { $limit: 100 },
    ]).allowDiskUse(true);

    const leaderboard = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $group: leaderboardGroup() },
      { $match: { _id: { $ne: null }, totalTickets: { $gte: 3 } } },
      { $sort: { goodCSAT: -1 } },
      { $limit: 25 },
    ]).allowDiskUse(true);

    const individualTrends = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $addFields: ticketAgeAddFields() },
      { $group: individualTrendGroup() },
      { $sort: { "_id.date": 1 } },
    ]).allowDiskUse(true);

    const response = {
      quarter,
      dateRange: { start, end },
      stats: formatOverallStats(statsResult),
      trends: trends.map((t) => formatTrend(t)),
      leaderboard: leaderboard.map((l) => formatLeaderboardEntry(l)),
      individualTrends: groupByOwner(individualTrends, formatIndividualTrend),
      computed_at: new Date(),
      _isPrecomputed: true,
    };

    await PrecomputedDashboard.findOneAndUpdate(
      { cache_type: cacheType },
      { $set: { data: response, computed_at: new Date(), computing: false } },
      { upsert: true }
    );

    logger.info({ quarter, totalTickets: response.stats.totalTickets }, "Pre-computed analytics");
    return response;
  } catch (error) {
    logger.error({ err: error, quarter }, "Pre-compute failed");
    await PrecomputedDashboard.findOneAndUpdate(
      { cache_type: cacheType },
      { $set: { computing: false } }
    ).catch(() => {});
  }
};

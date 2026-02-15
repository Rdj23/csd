import axios from "axios";
import { AnalyticsTicket, PrecomputedDashboard } from "../models/index.js";
import { getQuarterDateRange } from "../config/constants.js";

let cacheWarmingStarted = false;

export const getCacheWarmingStarted = () => cacheWarmingStarted;

export const precomputeAnalytics = async (quarter) => {
  const cacheType = quarter.toLowerCase().replace("_", "");

  try {
    const existing = await PrecomputedDashboard.findOne({ cache_type: cacheType });
    if (existing?.computing) {
      console.log(`⏭️ Skipping ${quarter} - already computing`);
      return;
    }

    await PrecomputedDashboard.findOneAndUpdate(
      { cache_type: cacheType },
      { $set: { computing: true } },
      { upsert: true }
    );

    console.log(`🔄 Pre-computing ${quarter} analytics...`);

    const { start, end } = getQuarterDateRange(quarter);
    const matchConditions = {
      closed_date: { $gte: start, $lte: end },
    };

    const [statsResult] = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalTickets: { $sum: 1 },
          avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
          avgFRT: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
          avgIterations: { $avg: { $cond: [{ $ne: ["$iterations", null] }, "$iterations", null] } },
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          frrMet: { $sum: "$frr" },
          frrTotal: { $sum: 1 },
        },
      },
    ]);

    const trends = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } },
          solved: { $sum: 1 },
          avgRWT: { $avg: "$rwt" },
          avgFRT: { $avg: "$frt" },
          avgIterations: { $avg: "$iterations" },
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
          frrTotal: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 100 },
    ]);

    const trendsWithFRRPercent = trends.map((t) => ({
      date: t._id,
      solved: t.solved,
      avgRWT: t.avgRWT ? Number(t.avgRWT.toFixed(2)) : 0,
      avgFRT: t.avgFRT ? Number(t.avgFRT.toFixed(2)) : 0,
      avgIterations: t.avgIterations ? Number(t.avgIterations.toFixed(1)) : 0,
      positiveCSAT: t.positiveCSAT,
      negativeCSAT: t.negativeCSAT || 0,
      frrMet: t.frrMet,
      frrPercent: t.frrTotal > 0 ? Math.round((t.frrMet / t.frrTotal) * 100) : 0,
    }));

    const leaderboard = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: "$owner",
          totalTickets: { $sum: 1 },
          goodCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          badCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          avgRWT: { $avg: "$rwt" },
          avgFRT: { $avg: "$frt" },
        },
      },
      { $match: { _id: { $ne: null }, totalTickets: { $gte: 3 } } },
      { $sort: { goodCSAT: -1 } },
      { $limit: 25 },
    ]);

    const individualTrends = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $addFields: {
          ticketAge: {
            $divide: [
              { $subtract: ["$closed_date", "$created_date"] },
              1000 * 60 * 60 * 24,
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } },
            owner: "$owner",
          },
          solved: { $sum: 1 },
          avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
          avgFRT: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
          avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
          iterValidCount: { $sum: { $cond: [{ $gt: ["$iterations", 0] }, 1, 0] } },
          rwtValidCount: { $sum: { $cond: [{ $gt: ["$rwt", 0] }, 1, 0] } },
          frtValidCount: { $sum: { $cond: [{ $gt: ["$frt", 0] }, 1, 0] } },
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
          frrTotal: { $sum: 1 },
          backlogCleared: { $sum: { $cond: [{ $gte: ["$ticketAge", 15] }, 1, 0] } },
        },
      },
      { $sort: { "_id.date": 1 } },
    ]);

    const individualTrendsGrouped = individualTrends.reduce((acc, item) => {
      const { date, owner } = item._id;
      if (!acc[owner]) acc[owner] = [];
      acc[owner].push({
        date,
        solved: item.solved,
        avgRWT: item.avgRWT ? Number(item.avgRWT.toFixed(2)) : 0,
        avgFRT: item.avgFRT ? Number(item.avgFRT.toFixed(2)) : 0,
        avgIterations: item.avgIterations ? Number(item.avgIterations.toFixed(1)) : 0,
        iterValidCount: item.iterValidCount || 0,
        rwtValidCount: item.rwtValidCount || 0,
        frtValidCount: item.frtValidCount || 0,
        positiveCSAT: item.positiveCSAT || 0,
        negativeCSAT: item.negativeCSAT || 0,
        frrMet: item.frrMet || 0,
        backlogCleared: item.backlogCleared || 0,
      });
      return acc;
    }, {});

    const response = {
      quarter,
      dateRange: { start, end },
      stats: {
        totalTickets: statsResult?.totalTickets || 0,
        avgRWT: statsResult?.avgRWT ? Number(statsResult.avgRWT.toFixed(2)) : 0,
        avgFRT: statsResult?.avgFRT ? Number(statsResult.avgFRT.toFixed(2)) : 0,
        avgIterations: statsResult?.avgIterations ? Number(statsResult.avgIterations.toFixed(1)) : 0,
        positiveCSAT: statsResult?.positiveCSAT || 0,
        negativeCSAT: statsResult?.negativeCSAT || 0,
        csatPercent: (() => {
          const pos = statsResult?.positiveCSAT || 0;
          const neg = statsResult?.negativeCSAT || 0;
          return pos + neg > 0 ? Math.round((pos / (pos + neg)) * 100) : 0;
        })(),
        frrPercent: statsResult?.frrTotal > 0 ? Math.round((statsResult.frrMet / statsResult.frrTotal) * 100) : 0,
      },
      trends: trendsWithFRRPercent,
      leaderboard: leaderboard.map((l) => ({
        name: l._id,
        totalTickets: l.totalTickets,
        goodCSAT: l.goodCSAT,
        badCSAT: l.badCSAT,
        winRate: l.goodCSAT + l.badCSAT > 0 ? Math.round((l.goodCSAT / (l.goodCSAT + l.badCSAT)) * 100) : 0,
        avgRWT: l.avgRWT ? Number(l.avgRWT.toFixed(2)) : 0,
        avgFRT: l.avgFRT ? Number(l.avgFRT.toFixed(2)) : 0,
      })),
      individualTrends: individualTrendsGrouped,
      computed_at: new Date(),
      _isPrecomputed: true,
    };

    await PrecomputedDashboard.findOneAndUpdate(
      { cache_type: cacheType },
      { $set: { data: response, computed_at: new Date(), computing: false } },
      { upsert: true }
    );

    console.log(`✅ Pre-computed ${quarter} analytics (${response.stats.totalTickets} tickets)`);
    return response;
  } catch (error) {
    console.error(`❌ Pre-compute ${quarter} failed:`, error.message);
    await PrecomputedDashboard.findOneAndUpdate(
      { cache_type: cacheType },
      { $set: { computing: false } }
    ).catch(() => {});
  }
};

const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes

export const startBackgroundRefresh = () => {
  console.log("🔄 Starting background cache refresh (every 15 min)...");

  setTimeout(async () => {
    console.log("🚀 Initial pre-computation starting...");
    await precomputeAnalytics("Q4_25");
    await precomputeAnalytics("Q1_26");
  }, 10000);

  setInterval(async () => {
    console.log("⏰ Scheduled cache refresh...");
    await precomputeAnalytics("Q4_25");
    await precomputeAnalytics("Q1_26");
  }, REFRESH_INTERVAL);
};

export const warmCache = async (source = "unknown", fetchAndCacheTicketsFn = null) => {
  if (cacheWarmingStarted) {
    console.log(`⏭️ Cache warming already started, skipping (${source})`);
    return;
  }
  cacheWarmingStarted = true;
  console.log(`🔥 Warming cache (triggered by: ${source})...`);

  try {
    if (fetchAndCacheTicketsFn) {
      fetchAndCacheTicketsFn("startup").catch(console.error);
      console.log("✅ Ticket sync started in background");
    }

    setTimeout(async () => {
      try {
        const PORT = process.env.PORT || 5000;
        await axios.get(
          `http://localhost:${PORT}/api/tickets/analytics?quarter=Q1_26`,
          { timeout: 10000 }
        );
        console.log("✅ Analytics cache warmed");
      } catch (e) {
        console.log("⚠️ Analytics warming skipped:", e.message);
      }
    }, 2000);
  } catch (e) {
    console.log("⚠️ Cache warming failed:", e.message);
    cacheWarmingStarted = false;
  }
};

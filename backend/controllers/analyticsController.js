import { format } from "date-fns";
import { AnalyticsTicket, AnalyticsCache, PrecomputedDashboard } from "../models/index.js";
import { redisGet, redisSet, CACHE_TTL } from "../config/database.js";
import { getQuarterDateRange } from "../config/constants.js";

export const getAnalytics = async (req, res) => {
  try {
    const {
      quarter = "Q1_26",
      excludeZendesk,
      excludeNOC,
      owner,
      owners,
      region,
      forceRefresh,
      groupBy = "daily",
    } = req.query;
    const cacheKey = `analytics:${quarter}:${excludeZendesk || "false"}:${excludeNOC || "false"}:${owner || "all"}:${owners || "none"}:${region || "none"}:${groupBy}`;

    // Check pre-computed cache first (FASTEST - instant response)
    const isDefaultQuery = !excludeZendesk && !excludeNOC && !owner && !owners && !region && groupBy === "daily";
    if (isDefaultQuery && forceRefresh !== "true") {
      const cacheType = quarter.toLowerCase().replace("_", "");
      const precomputed = await PrecomputedDashboard.findOne({ cache_type: cacheType }).lean();

      if (precomputed?.data && !precomputed.computing) {
        const age = Date.now() - new Date(precomputed.computed_at).getTime();
        // Serve precomputed data if less than 25 hours old (daily refresh at 1 AM IST)
        if (age < 25 * 60 * 60 * 1000) {
          console.log(`⚡ PRECOMPUTED HIT: ${quarter} (${Math.round(age / 60000)}min old)`);
          return res.json(precomputed.data);
        }
      }
    }

    // 1. Check Redis cache first
    if (forceRefresh !== "true") {
      const redisData = await redisGet(cacheKey);
      if (redisData) {
        console.log(`⚡ Redis HIT: ${cacheKey}`);
        return res.json(redisData);
      }
    }

    console.log(`📊 Analytics Request (Cache MISS): ${cacheKey}`);

    // 2. Check MongoDB cache (fallback)
    if (forceRefresh !== "true") {
      const mongoCache = await AnalyticsCache.findOne({ cache_key: cacheKey }).lean();
      if (mongoCache && Date.now() - new Date(mongoCache.computed_at).getTime() < 25 * 60 * 60 * 1000) {
        console.log(`⚡ MongoDB Cache HIT`);
        await redisSet(cacheKey, mongoCache, CACHE_TTL.ANALYTICS);
        return res.json(mongoCache);
      }
    }

    // 3. Compute fresh data
    const { start, end } = getQuarterDateRange(quarter);
    console.log(`📅 Date Range: ${format(start, "MMM d")} - ${format(end, "MMM d")}`);

    const matchConditions = { closed_date: { $gte: start, $lte: end } };
    if (excludeZendesk === "true") matchConditions.is_zendesk = { $ne: true };
    if (excludeNOC === "true") matchConditions.is_noc = { $ne: true };
    if (owner && owner !== "All") matchConditions.owner = { $regex: owner, $options: "i" };

    // Aggregate Stats
    const [statsResult] = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalTickets: { $sum: 1 },
          avgRWT: { $avg: { $cond: [{ $and: [{ $ne: ["$rwt", null] }, { $gt: ["$rwt", 0] }] }, "$rwt", null] } },
          avgFRT: { $avg: { $cond: [{ $and: [{ $ne: ["$frt", null] }, { $gt: ["$frt", 0] }] }, "$frt", null] } },
          avgIterations: { $avg: { $cond: [{ $ne: ["$iterations", null] }, "$iterations", null] } },
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          frrMet: { $sum: "$frr" },
          frrTotal: { $sum: 1 },
        },
      },
    ]);

    let dateFormat = "%Y-%m-%d";
    if (groupBy === "weekly") dateFormat = "%Y-W%V";
    if (groupBy === "monthly") dateFormat = "%Y-%m";

    // Daily/Weekly/Monthly Trends
    const trends = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: "$closed_date" } },
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
      _id: t._id,
      solved: t.solved,
      avgRWT: t.avgRWT,
      avgFRT: t.avgFRT,
      avgIterations: t.avgIterations,
      positiveCSAT: t.positiveCSAT,
      negativeCSAT: t.negativeCSAT,
      frrMet: t.frrMet,
      frrPercent: t.frrTotal > 0 ? Math.round((t.frrMet / t.frrTotal) * 100) : 0,
    }));

    // Backlog Clearance
    const backlogCleared = await AnalyticsTicket.aggregate([
      {
        $match: {
          ...matchConditions,
          $expr: { $gt: [{ $subtract: ["$closed_date", "$created_date"] }, 15 * 24 * 60 * 60 * 1000] },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: "$closed_date" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 100 },
    ]);

    // Leaderboard
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
      {
        $addFields: {
          winRate: {
            $cond: [
              { $gt: [{ $add: ["$goodCSAT", "$badCSAT"] }, 0] },
              { $multiply: [{ $divide: ["$goodCSAT", { $add: ["$goodCSAT", "$badCSAT"] }] }, 100] },
              0,
            ],
          },
        },
      },
      { $sort: { goodCSAT: -1, winRate: -1 } },
      { $limit: 25 },
    ]);

    // Bad CSAT
    const dsatMatch = { closed_date: { $gte: start, $lte: end }, csat: 1 };
    if (excludeZendesk === "true") dsatMatch.is_zendesk = { $ne: true };
    if (excludeNOC === "true") dsatMatch.is_noc = { $ne: true };
    const badTickets = await AnalyticsTicket.find(dsatMatch, {
      ticket_id: 1, display_id: 1, title: 1, owner: 1, created_date: 1, closed_date: 1,
    }).sort({ closed_date: -1 }).limit(50).lean();

    // Individual trends
    const individualTrends = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $addFields: {
          ticketAge: { $divide: [{ $subtract: ["$closed_date", "$created_date"] }, 1000 * 60 * 60 * 24] },
        },
      },
      {
        $group: {
          _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } }, owner: "$owner" },
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

    const response = {
      cache_key: cacheKey,
      computed_at: new Date(),
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
      trends: trendsWithFRRPercent.map((t) => {
        const backlog = backlogCleared.find((b) => b._id === t._id);
        return {
          date: t._id,
          solved: t.solved,
          avgRWT: t.avgRWT ? Number(t.avgRWT.toFixed(2)) : 0,
          avgFRT: t.avgFRT ? Number(t.avgFRT.toFixed(2)) : 0,
          avgIterations: t.avgIterations ? Number(t.avgIterations.toFixed(1)) : 0,
          backlogCleared: backlog?.count || 0,
          positiveCSAT: t.positiveCSAT,
          negativeCSAT: t.negativeCSAT || 0,
          frrMet: t.frrMet || 0,
          frrPercent: t.frrPercent || 0,
        };
      }),
      leaderboard: leaderboard.map((l) => ({
        name: l._id,
        totalTickets: l.totalTickets,
        goodCSAT: l.goodCSAT,
        badCSAT: l.badCSAT,
        winRate: Math.round(l.winRate || 0),
        avgRWT: l.avgRWT ? Number(l.avgRWT.toFixed(2)) : 0,
        avgFRT: l.avgFRT ? Number(l.avgFRT.toFixed(2)) : 0,
      })),
      badTickets: badTickets.map((t) => ({
        id: t.ticket_id,
        display_id: t.display_id,
        title: t.title,
        owner: t.owner,
        created_date: t.created_date,
        closed_date: t.closed_date,
      })),
      individualTrends: individualTrends.reduce((acc, item) => {
        const { date, owner } = item._id;
        if (!acc[owner]) acc[owner] = [];
        acc[owner].push({
          date,
          solved: item.solved,
          avgRWT: item.avgRWT ? Number(item.avgRWT.toFixed(2)) : 0,
          avgFRT: item.avgFRT ? Number(item.avgFRT.toFixed(2)) : 0,
          avgIterations: item.avgIterations ? Number(item.avgIterations.toFixed(1)) : 0,
          positiveCSAT: item.positiveCSAT || 0,
          negativeCSAT: item.negativeCSAT || 0,
          frrMet: item.frrMet || 0,
          frrTotal: item.frrTotal || 0,
          frrPercent: item.frrTotal > 0 ? Math.round((item.frrMet / item.frrTotal) * 100) : 0,
          rwtValidCount: item.rwtValidCount || 0,
          frtValidCount: item.frtValidCount || 0,
          iterValidCount: item.iterValidCount || 0,
          backlogCleared: item.backlogCleared || 0,
        });
        return acc;
      }, {}),
    };

    // Cache in Redis (fast) and MongoDB (persistent)
    await Promise.all([
      redisSet(cacheKey, response, CACHE_TTL.ANALYTICS),
      AnalyticsCache.findOneAndUpdate(
        { cache_key: cacheKey },
        { $set: response },
        { upsert: true },
      ),
    ]);

    console.log(`✅ Analytics computed & cached: ${cacheKey}`);
    res.json(response);
  } catch (e) {
    console.error("❌ Analytics Error:", e.message, e.stack);
    res.status(500).json({
      stats: {},
      trends: [],
      leaderboard: [],
      badTickets: [],
      individualTrends: {},
    });
  }
};

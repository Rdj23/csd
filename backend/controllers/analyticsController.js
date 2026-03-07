import { format } from "date-fns";
import { AnalyticsTicket, AnalyticsCache, PrecomputedDashboard } from "../models/index.js";
import { redisGet, redisSet, CACHE_TTL } from "../config/database.js";
import {
  getQuarterDateRange,
  resolveDateRange,
  EMAIL_TO_NAME_MAP,
  TEAM_MAPPING,
  GAMIFICATION_TEAM_MAP,
} from "../config/constants.js";
import logger from "../config/logger.js";
import { ok, badRequest, fail, serverError } from "../utils/response.js";

/** Escape special regex characters so user input is treated as a literal string. */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
          logger.info({ quarter, ageMin: Math.round(age / 60000) }, "Precomputed cache HIT");
          return res.json(precomputed.data);
        }
      }
    }

    // 1. Check Redis cache first
    if (forceRefresh !== "true") {
      const redisData = await redisGet(cacheKey);
      if (redisData) {
        logger.info({ cacheKey }, "Redis cache HIT");
        return res.json(redisData);
      }
    }

    logger.info({ cacheKey }, "Analytics cache MISS");

    // 2. Check MongoDB cache (fallback)
    if (forceRefresh !== "true") {
      const mongoCache = await AnalyticsCache.findOne({ cache_key: cacheKey }).lean();
      if (mongoCache && Date.now() - new Date(mongoCache.computed_at).getTime() < 25 * 60 * 60 * 1000) {
        logger.info("MongoDB cache HIT");
        await redisSet(cacheKey, mongoCache, CACHE_TTL.ANALYTICS);
        return res.json(mongoCache);
      }
    }

    // 3. Compute fresh data
    const { start, end } = getQuarterDateRange(quarter);
    logger.info({ start: format(start, "MMM d"), end: format(end, "MMM d") }, "Computing analytics");

    const matchConditions = { closed_date: { $gte: start, $lte: end } };
    if (excludeZendesk === "true") matchConditions.is_zendesk = { $ne: true };
    if (excludeNOC === "true") matchConditions.is_noc = { $ne: true };
    if (owner && owner !== "All") matchConditions.owner = { $regex: escapeRegex(owner), $options: "i" };

    // CSAT/DSAT match conditions - never excludes NOC (CSAT/DSAT always includes all tickets)
    const csatMatchConditions = { ...matchConditions };
    delete csatMatchConditions.is_noc;

    const nocExcluded = excludeNOC === "true";

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

    // Bad CSAT - never excludes NOC (DSAT always includes all tickets)
    const dsatMatch = { closed_date: { $gte: start, $lte: end }, csat: 1 };
    if (excludeZendesk === "true") dsatMatch.is_zendesk = { $ne: true };
    const badTickets = await AnalyticsTicket.find(dsatMatch, {
      ticket_id: 1, display_id: 1, title: 1, owner: 1, created_date: 1, closed_date: 1, is_noc: 1,
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

    // When NOC is excluded, CSAT/DSAT must still include NOC tickets.
    // Run separate CSAT-inclusive queries and merge the results.
    let csatOverride = null;
    let csatTrendsByDate = null;
    let csatByOwner = null;
    let csatIndividualByKey = null;

    if (nocExcluded) {
      const [csatStatsArr, csatTrendsArr, csatLeaderboardArr, csatIndTrendsArr] = await Promise.all([
        // Overall CSAT stats (includes NOC)
        AnalyticsTicket.aggregate([
          { $match: csatMatchConditions },
          {
            $group: {
              _id: null,
              positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
              negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
            },
          },
        ]),
        // CSAT per date (includes NOC)
        AnalyticsTicket.aggregate([
          { $match: csatMatchConditions },
          {
            $group: {
              _id: { $dateToString: { format: dateFormat, date: "$closed_date" } },
              positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
              negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
            },
          },
        ]),
        // CSAT per owner (includes NOC) for leaderboard
        AnalyticsTicket.aggregate([
          { $match: csatMatchConditions },
          {
            $group: {
              _id: "$owner",
              goodCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
              badCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
            },
          },
        ]),
        // CSAT per owner-date (includes NOC) for individual trends
        AnalyticsTicket.aggregate([
          { $match: csatMatchConditions },
          {
            $group: {
              _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } }, owner: "$owner" },
              positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
              negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
            },
          },
        ]),
      ]);

      csatOverride = csatStatsArr[0] || { positiveCSAT: 0, negativeCSAT: 0 };

      csatTrendsByDate = {};
      csatTrendsArr.forEach((t) => { csatTrendsByDate[t._id] = t; });

      csatByOwner = {};
      csatLeaderboardArr.forEach((l) => { csatByOwner[l._id] = l; });

      csatIndividualByKey = {};
      csatIndTrendsArr.forEach((t) => {
        csatIndividualByKey[`${t._id.owner}:${t._id.date}`] = t;
      });
    }

    // Use CSAT override (NOC-inclusive) when available, otherwise use stats from main query
    const effectiveCSAT = csatOverride || { positiveCSAT: statsResult?.positiveCSAT || 0, negativeCSAT: statsResult?.negativeCSAT || 0 };

    const trendsWithFRRPercent = trends.map((t) => {
      const csat = csatTrendsByDate?.[t._id] || t;
      return {
        _id: t._id,
        solved: t.solved,
        avgRWT: t.avgRWT,
        avgFRT: t.avgFRT,
        avgIterations: t.avgIterations,
        positiveCSAT: csat.positiveCSAT,
        negativeCSAT: csat.negativeCSAT,
        frrMet: t.frrMet,
        frrPercent: t.frrTotal > 0 ? Math.round((t.frrMet / t.frrTotal) * 100) : 0,
      };
    });

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
        positiveCSAT: effectiveCSAT.positiveCSAT || 0,
        negativeCSAT: effectiveCSAT.negativeCSAT || 0,
        csatPercent: (() => {
          const pos = effectiveCSAT.positiveCSAT || 0;
          const neg = effectiveCSAT.negativeCSAT || 0;
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
      leaderboard: leaderboard.map((l) => {
        const ownerCsat = csatByOwner?.[l._id] || l;
        const good = ownerCsat.goodCSAT || 0;
        const bad = ownerCsat.badCSAT || 0;
        return {
          name: l._id,
          totalTickets: l.totalTickets,
          goodCSAT: good,
          badCSAT: bad,
          winRate: good + bad > 0 ? Math.round((good / (good + bad)) * 100) : 0,
          avgRWT: l.avgRWT ? Number(l.avgRWT.toFixed(2)) : 0,
          avgFRT: l.avgFRT ? Number(l.avgFRT.toFixed(2)) : 0,
        };
      }).sort((a, b) => b.goodCSAT - a.goodCSAT || b.winRate - a.winRate),
      badTickets: badTickets.map((t) => ({
        id: t.ticket_id,
        display_id: t.display_id,
        title: t.title,
        owner: t.owner,
        created_date: t.created_date,
        closed_date: t.closed_date,
        is_noc: t.is_noc || false,
      })),
      individualTrends: individualTrends.reduce((acc, item) => {
        const { date, owner } = item._id;
        if (!acc[owner]) acc[owner] = [];
        const csatData = csatIndividualByKey?.[`${owner}:${date}`] || item;
        acc[owner].push({
          date,
          solved: item.solved,
          avgRWT: item.avgRWT ? Number(item.avgRWT.toFixed(2)) : 0,
          avgFRT: item.avgFRT ? Number(item.avgFRT.toFixed(2)) : 0,
          avgIterations: item.avgIterations ? Number(item.avgIterations.toFixed(1)) : 0,
          positiveCSAT: csatData.positiveCSAT || 0,
          negativeCSAT: csatData.negativeCSAT || 0,
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

    // Send response immediately — don't let cache failures block the client
    res.json(response);

    // Cache in background (non-blocking) — errors here should never cause 500
    Promise.all([
      redisSet(cacheKey, response, CACHE_TTL.ANALYTICS),
      AnalyticsCache.findOneAndUpdate(
        { cache_key: cacheKey },
        { $set: { cache_key: cacheKey, computed_at: response.computed_at, stats: response.stats, trends: response.trends, leaderboard: response.leaderboard, badTickets: response.badTickets, individualTrends: response.individualTrends } },
        { upsert: true },
      ),
    ]).then(() => {
      logger.info({ cacheKey }, "Analytics cached");
    }).catch((cacheErr) => {
      logger.error({ err: cacheErr, cacheKey }, "Analytics cache save failed (response already sent)");
    });
  } catch (e) {
    logger.error({ err: e, stack: e.stack }, "Analytics error");
    res.status(500).json({
      error: e.message,
      stats: {},
      trends: [],
      leaderboard: [],
      badTickets: [],
      individualTrends: {},
    });
  }
};

/**
 * Centralized ticket drill-down API.
 *
 * Scopes:
 *   - individual: single user (by email or owner name)
 *   - team:       all members of a team lead's group (by team name)
 *   - all:        entire GST
 *
 * Returns per-ticket RWT, FRR, CSAT, iterations + aggregated summary.
 */
export const getTicketDrillDown = async (req, res) => {
  try {
    const { quarter = "Q1_26", scope = "all", email, owner, team, startDate, endDate } = req.query;
    const range = resolveDateRange({ quarter, startDate, endDate });
    if (range.error) return badRequest(res, range.error);
    const { start, end, label } = range;

    // API keys can only access individual scope — block team/all to prevent oversharing
    if (req.user?.isApiKey && scope !== "individual") {
      return fail(res, 403, "Forbidden: API keys can only use scope=individual");
    }

    // Resolve owner filter based on scope
    let ownerFilter = null; // null = all GST
    let scopeLabel = "all";

    if (scope === "individual") {
      let userName = owner;
      if (email) {
        userName = EMAIL_TO_NAME_MAP[email.toLowerCase()];
        if (!userName) return fail(res, 403, "Unauthorized: Not a GST user");
      }
      if (!userName) return badRequest(res, "email or owner is required for individual scope");
      ownerFilter = [userName];
      scopeLabel = userName;
    } else if (scope === "team") {
      if (!team) return badRequest(res, "team param is required for team scope (e.g. Rohan, Shweta, Harsh)");
      const teamInfo = TEAM_MAPPING[team];
      if (!teamInfo) return badRequest(res, `Unknown team: ${team}. Valid: Rohan, Shweta, Harsh, Aditya, Debashish, Tuaha, Adish`);
      ownerFilter = teamInfo.members;
      scopeLabel = `Team ${teamInfo.team}`;
    }

    logger.info({ scope, scopeLabel, quarter }, "Ticket drill-down request");

    const matchConditions = {
      closed_date: { $gte: start, $lte: end },
      owner: { $nin: [null, ""] },
      is_noc: { $ne: true },
    };
    if (ownerFilter) {
      matchConditions.owner = ownerFilter.length === 1 ? ownerFilter[0] : { $in: ownerFilter };
    }

    // NOC-inclusive match for CSAT
    const csatMatchConditions = { ...matchConditions };
    delete csatMatchConditions.is_noc;

    const [tickets, nocTickets, summary] = await Promise.all([
      // All non-NOC tickets
      AnalyticsTicket.find(matchConditions, {
        display_id: 1, title: 1, closed_date: 1, created_date: 1, stage_name: 1,
        owner: 1, account_name: 1, account_cohort: 1,
        csat: 1, rwt: 1, frt: 1, iterations: 1, frr: 1, _id: 0,
      }).sort({ closed_date: -1 }).lean(),

      // NOC tickets (CSAT-relevant)
      AnalyticsTicket.find(
        { ...csatMatchConditions, is_noc: true },
        {
          display_id: 1, title: 1, closed_date: 1, owner: 1,
          account_name: 1, csat: 1, stage_name: 1, _id: 0,
        }
      ).sort({ closed_date: -1 }).lean(),

      // Aggregated summary per owner
      AnalyticsTicket.aggregate([
        { $match: matchConditions },
        {
          $group: {
            _id: "$owner",
            solved: { $sum: 1 },
            avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
            avgFRT: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
            avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
            frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
            positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
            negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
          },
        },
        { $sort: { solved: -1 } },
      ]),
    ]);

    // Build per-owner summary with derived fields
    const ownerSummary = summary.map(s => {
      const pos = s.positiveCSAT || 0;
      const neg = s.negativeCSAT || 0;
      return {
        owner: s._id,
        team: GAMIFICATION_TEAM_MAP[s._id] || "Unknown",
        solved: s.solved,
        avgRWT: s.avgRWT ? parseFloat(s.avgRWT.toFixed(2)) : 0,
        avgFRT: s.avgFRT ? parseFloat(s.avgFRT.toFixed(2)) : 0,
        avgIterations: s.avgIterations ? parseFloat(s.avgIterations.toFixed(2)) : 0,
        frrPercent: s.solved > 0 ? Math.round((s.frrMet / s.solved) * 100) : 0,
        csatPercent: pos + neg > 0 ? Math.round((pos / (pos + neg)) * 100) : 100,
        positiveCSAT: pos,
        negativeCSAT: neg,
      };
    });

    ok(res, {
      quarter: label,
      scope: scopeLabel,
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      totalSolved: tickets.length,
      totalNOC: nocTickets.length,
      ownerSummary,
      tickets,
      nocTickets,
    });
  } catch (e) {
    logger.error({ err: e }, "Ticket drill-down error");
    serverError(res, e.message);
  }
};

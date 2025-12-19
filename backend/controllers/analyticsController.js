import { format } from "date-fns";
import { AnalyticsTicket, AnalyticsCache, PrecomputedDashboard } from "../models/index.js";
import { redisGet, redisSet, redisLock, redisUnlock, CACHE_TTL } from "../config/database.js";
import {
  getQuarterDateRange,
  resolveDateRange,
  getCurrentQuarterKey,
  EMAIL_TO_NAME_MAP,
  TEAM_MAPPING,
  GAMIFICATION_TEAM_MAP,
} from "../config/constants.js";
import logger from "../config/logger.js";
import { ok, badRequest, fail, serverError } from "../utils/response.js";
import { applySingleOwnerFilter, applyExclusionFilters, applyCohortFilter } from "../utils/queryBuilders.js";
import { overallStatsGroup, trendGroup, leaderboardGroup, individualTrendGroup, csatFields, ticketAgeAddFields, ownerStatsGroup } from "../utils/aggregationStages.js";
import { formatTrend, formatLeaderboardEntry, formatIndividualTrend, formatOverallStats, groupByOwner, csatPercent, frrPercent, roundMetric } from "../utils/formatters.js";

export const getAnalytics = async (req, res) => {
  try {
    const {
      quarter = getCurrentQuarterKey(),
      excludeZendesk,
      excludeNOC,
      owner,
      owners,
      region,
      cohort,
      cohorts,
      forceRefresh,
      groupBy = "daily",
    } = req.query;
    const cacheKey = `analytics:${quarter}:${excludeZendesk || "false"}:${excludeNOC || "false"}:${owner || "all"}:${owners || "none"}:${region || "none"}:${cohorts || cohort || "none"}:${groupBy}`;

    // Check pre-computed cache first (FASTEST - instant response)
    const isDefaultQuery = !excludeZendesk && !excludeNOC && !owner && !owners && !region && !cohort && !cohorts && groupBy === "daily";
    if (isDefaultQuery && forceRefresh !== "true") {
      const cacheType = quarter.toLowerCase().replace("_", "");
      const precomputed = await PrecomputedDashboard.findOne({ cache_type: cacheType }).lean();

      if (precomputed?.data && !precomputed.computing) {
        const age = Date.now() - new Date(precomputed.computed_at).getTime();
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

    logger.info({ cacheKey, cohortFilter: cohorts || cohort || "none" }, "Analytics cache MISS");

    // 2. Check MongoDB cache (fallback)
    if (forceRefresh !== "true") {
      const mongoCache = await AnalyticsCache.findOne({ cache_key: cacheKey }).lean();
      if (mongoCache && Date.now() - new Date(mongoCache.computed_at).getTime() < 25 * 60 * 60 * 1000) {
        logger.info("MongoDB cache HIT");
        await redisSet(cacheKey, mongoCache, CACHE_TTL.ANALYTICS);
        return res.json(mongoCache);
      }
    }

    // 3. Acquire lock to prevent cache stampede (only one request computes at a time)
    const lockKey = `lock:${cacheKey}`;
    const lockToken = await redisLock(lockKey, 60);
    if (!lockToken) {
      await new Promise((r) => setTimeout(r, 2000));
      const retryData = await redisGet(cacheKey);
      if (retryData) {
        logger.info({ cacheKey }, "Analytics cache HIT after lock wait");
        return res.json(retryData);
      }
    }

    // 4. Compute fresh data
    const { start, end } = getQuarterDateRange(quarter);
    logger.info({ start: format(start, "MMM d"), end: format(end, "MMM d") }, "Computing analytics");

    const matchConditions = { closed_date: { $gte: start, $lte: end } };
    applyExclusionFilters(matchConditions, { excludeZendesk, excludeNOC });
    applySingleOwnerFilter(matchConditions, owner);
    const cohortFilter = cohorts || cohort;
    applyCohortFilter(matchConditions, cohortFilter);

    // CSAT/DSAT match conditions - never excludes NOC
    const csatMatchConditions = { ...matchConditions };
    delete csatMatchConditions.is_noc;

    const nocExcluded = excludeNOC === "true";

    let dateFormat = "%Y-%m-%d";
    if (groupBy === "weekly") dateFormat = "%Y-W%V";
    if (groupBy === "monthly") dateFormat = "%Y-%m";

    // Aggregate Stats
    const [statsResult] = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $group: overallStatsGroup() },
    ]).allowDiskUse(true);

    // Daily/Weekly/Monthly Trends
    const trends = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $group: trendGroup(dateFormat) },
      { $sort: { _id: 1 } },
      { $limit: 100 },
    ]).allowDiskUse(true);

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
    ]).allowDiskUse(true);

    // Leaderboard
    const leaderboard = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $group: leaderboardGroup() },
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
    ]).allowDiskUse(true);

    // Bad CSAT - never excludes NOC
    const dsatMatch = { closed_date: { $gte: start, $lte: end }, csat: 1 };
    if (excludeZendesk === "true") dsatMatch.is_zendesk = { $ne: true };
    applyCohortFilter(dsatMatch, cohortFilter);

    const badTickets = await AnalyticsTicket.find(dsatMatch, {
      ticket_id: 1, display_id: 1, title: 1, owner: 1, created_date: 1, closed_date: 1, is_noc: 1,
    }).sort({ closed_date: -1 }).limit(50).lean();

    // Individual trends
    const individualTrends = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      { $addFields: ticketAgeAddFields() },
      { $group: individualTrendGroup() },
      { $sort: { "_id.date": 1 } },
    ]).allowDiskUse(true);

    // When NOC is excluded, CSAT/DSAT must still include NOC tickets.
    let csatOverride = null;
    let csatTrendsByDate = null;
    let csatByOwner = null;
    let csatIndividualByKey = null;

    if (nocExcluded) {
      const csatOnlyGroup = { ...csatFields() };
      const [csatStatsArr, csatTrendsArr, csatLeaderboardArr, csatIndTrendsArr] = await Promise.all([
        AnalyticsTicket.aggregate([
          { $match: csatMatchConditions },
          { $group: { _id: null, ...csatOnlyGroup } },
        ]).allowDiskUse(true),
        AnalyticsTicket.aggregate([
          { $match: csatMatchConditions },
          { $group: { _id: { $dateToString: { format: dateFormat, date: "$closed_date" } }, ...csatOnlyGroup } },
        ]).allowDiskUse(true),
        AnalyticsTicket.aggregate([
          { $match: csatMatchConditions },
          {
            $group: {
              _id: "$owner",
              goodCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
              badCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
            },
          },
        ]).allowDiskUse(true),
        AnalyticsTicket.aggregate([
          { $match: csatMatchConditions },
          {
            $group: {
              _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } }, owner: "$owner" },
              ...csatOnlyGroup,
            },
          },
        ]).allowDiskUse(true),
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

    const effectiveCSAT = csatOverride || { positiveCSAT: statsResult?.positiveCSAT || 0, negativeCSAT: statsResult?.negativeCSAT || 0 };

    const response = {
      cache_key: cacheKey,
      computed_at: new Date(),
      quarter,
      dateRange: { start, end },
      stats: formatOverallStats(statsResult, csatOverride),
      trends: trends.map((t) => {
        const csat = csatTrendsByDate?.[t._id] || null;
        const base = formatTrend(t, csat);
        const backlog = backlogCleared.find((b) => b._id === t._id);
        return { ...base, backlogCleared: backlog?.count || 0 };
      }),
      leaderboard: leaderboard
        .map((l) => formatLeaderboardEntry(l, csatByOwner?.[l._id]))
        .sort((a, b) => b.goodCSAT - a.goodCSAT || b.winRate - a.winRate),
      badTickets: badTickets.map((t) => ({
        id: t.ticket_id,
        display_id: t.display_id,
        title: t.title,
        owner: t.owner,
        created_date: t.created_date,
        closed_date: t.closed_date,
        is_noc: t.is_noc || false,
      })),
      individualTrends: groupByOwner(individualTrends, (item) => {
        const csatData = csatIndividualByKey?.[`${item._id.owner}:${item._id.date}`] || null;
        return formatIndividualTrend(item, csatData);
      }),
    };

    // Send response immediately — don't let cache failures block the client
    res.json(response);

    // Cache in background (non-blocking)
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
    }).finally(() => {
      redisUnlock(lockKey, lockToken);
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
 */
export const getTicketDrillDown = async (req, res) => {
  try {
    const { quarter = getCurrentQuarterKey(), scope = "all", email, owner, team, cohort, cohorts, startDate, endDate } = req.query;
    const range = resolveDateRange({ quarter, startDate, endDate });
    if (range.error) return badRequest(res, range.error);
    const { start, end, label } = range;

    if (req.user?.isApiKey && scope !== "individual") {
      return fail(res, 403, "Forbidden: API keys can only use scope=individual");
    }

    let ownerFilter = null;
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
    applyCohortFilter(matchConditions, cohorts || cohort);

    // NOC-inclusive match for CSAT
    const csatMatchConditions = { ...matchConditions };
    delete csatMatchConditions.is_noc;

    const [tickets, nocTickets, summary] = await Promise.all([
      AnalyticsTicket.find(matchConditions, {
        display_id: 1, title: 1, closed_date: 1, created_date: 1, stage_name: 1,
        owner: 1, account_name: 1, account_cohort: 1,
        csat: 1, rwt: 1, frt: 1, iterations: 1, frr: 1, _id: 0,
      }).sort({ closed_date: -1 }).lean(),

      AnalyticsTicket.find(
        { ...csatMatchConditions, is_noc: true },
        {
          display_id: 1, title: 1, closed_date: 1, owner: 1,
          account_name: 1, csat: 1, stage_name: 1, _id: 0,
        }
      ).sort({ closed_date: -1 }).lean(),

      AnalyticsTicket.aggregate([
        { $match: matchConditions },
        { $group: ownerStatsGroup() },
        { $sort: { solved: -1 } },
      ]).allowDiskUse(true),
    ]);

    const ownerSummary = summary.map(s => {
      const pos = s.positiveCSAT || 0;
      const neg = s.negativeCSAT || 0;
      return {
        owner: s._id,
        team: GAMIFICATION_TEAM_MAP[s._id] || "Unknown",
        solved: s.solved,
        avgRWT: roundMetric(s.avgRWT),
        avgFRT: roundMetric(s.avgFRT),
        avgIterations: roundMetric(s.avgIterations),
        frrPercent: frrPercent(s.frrMet, s.solved),
        csatPercent: pos + neg > 0 ? csatPercent(pos, neg) : 100,
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

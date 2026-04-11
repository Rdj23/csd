import axios from "axios";
import { AnalyticsTicket } from "../models/index.js";
import { redisGet, redisSet, CACHE_TTL } from "../config/database.js";
import { DEVREV_API, HEADERS } from "../services/devrevApi.js";
import { fetchAndCacheTickets, quickFetchTickets } from "../services/syncService.js";
import { getTicketSyncQueue } from "../lib/queues.js";
import { ok, badRequest, serverError } from "../utils/response.js";
import logger from "../config/logger.js";
import { applyOwnerFilter, applyRegionFilter, applyExclusionFilters, applyBacklogFilter } from "../utils/queryBuilders.js";

// Helper: try BullMQ dispatch, fall back to direct execution if Redis is down
const dispatchOrRun = async (getQueue, jobName, jobData, directFn) => {
  const queue = getQueue();
  if (queue) {
    try {
      await queue.add(jobName, jobData, { jobId: `${jobName}-${Date.now()}` });
      return;
    } catch (err) {
      logger.warn({ err }, "BullMQ dispatch failed, running directly");
    }
  }
  // Fallback: run directly (non-blocking)
  directFn().catch((e) => logger.error({ err: e }, "Direct job failed"));
};

export const getLiveStats = async (req, res) => {
  try {
    const { start, end, owners, teams, region, excludeZendesk, excludeNOC } = req.query;

    if (!start || !end) {
      return badRequest(res, "Start and End dates required");
    }

    const cacheKey = `livestats:${start}:${end}:${owners || "all"}:${region || "all"}:${excludeZendesk || "false"}:${excludeNOC || "false"}`;
    const cachedData = await redisGet(cacheKey);
    if (cachedData) {
      logger.info("LiveStats Redis HIT");
      return ok(res, cachedData);
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (startDate.getHours() === 0) startDate.setHours(0, 0, 0, 0);
    if (endDate.getHours() === 0) endDate.setHours(23, 59, 59, 999);

    const matchConditions = { closed_date: { $gte: startDate, $lte: endDate } };
    applyOwnerFilter(matchConditions, owners);
    applyRegionFilter(matchConditions, region);
    applyExclusionFilters(matchConditions, { excludeZendesk, excludeNOC: req.query.excludeNOC });

    // Two parallel aggregations: overall stats + daily trends (avoids $push of all docs into RAM)
    const [statsResult, trendsResult] = await Promise.all([
      AnalyticsTicket.aggregate([
        { $match: matchConditions },
        {
          $group: {
            _id: null,
            totalSolved: { $sum: 1 },
            avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
            avgFRT: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
            avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
            rwtValidCount: { $sum: { $cond: [{ $gt: ["$rwt", 0] }, 1, 0] } },
            frtValidCount: { $sum: { $cond: [{ $gt: ["$frt", 0] }, 1, 0] } },
            iterValidCount: { $sum: { $cond: [{ $gt: ["$iterations", 0] }, 1, 0] } },
            positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
            frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
          },
        },
      ]),
      AnalyticsTicket.aggregate([
        { $match: matchConditions },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } },
            solved: { $sum: 1 },
            positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
            frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
            frrTotal: { $sum: 1 },
            avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
            avgFRT: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
            avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    if (statsResult.length === 0) {
      return ok(res, { stats: {}, trends: [] });
    }

    const data = statsResult[0];
    const trends = trendsResult.map((day) => ({
      date: day._id,
      solved: day.solved,
      positiveCSAT: day.positiveCSAT,
      frrMet: day.frrMet,
      frrPercent: day.frrTotal > 0 ? Math.round((day.frrMet / day.frrTotal) * 100) : 0,
      avgRWT: day.avgRWT || 0,
      avgFRT: day.avgFRT || 0,
      avgIterations: day.avgIterations || 0,
    }));

    const responseData = {
      stats: {
        totalSolved: data.totalSolved,
        avgRWT: data.avgRWT || 0,
        avgFRT: data.avgFRT || 0,
        avgIterations: data.avgIterations || 0,
        rwtValidCount: data.rwtValidCount || 0,
        frtValidCount: data.frtValidCount || 0,
        iterValidCount: data.iterValidCount || 0,
        positiveCSAT: data.positiveCSAT,
        frrPercent: data.totalSolved ? Math.round((data.frrMet / data.totalSolved) * 100) : 0,
      },
      trends,
    };

    await redisSet(cacheKey, responseData, CACHE_TTL.DRILLDOWN);
    ok(res, responseData);
  } catch (e) {
    logger.error({ err: e }, "Live Stats error");
    serverError(res, e.message);
  }
};

export const getDrilldown = async (req, res) => {
  try {
    const { date, metric, type } = req.query;
    if (!date) return badRequest(res, "Date required");

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    let query = {};
    if (type === "created") {
      query.created_date = { $gte: startOfDay, $lte: endOfDay };
    } else {
      query.actual_close_date = { $gte: startOfDay, $lte: endOfDay };
      query.stage_name = { $in: ["solved", "closed", "resolved", "Resolved", "Solved", "Closed"] };
    }

    const tickets = await AnalyticsTicket.find(query)
      .select("display_id title created_date actual_close_date owner stage_name rwt account_name")
      .lean();

    ok(res, { tickets });
  } catch (error) {
    logger.error({ err: error }, "Drilldown error");
    serverError(res, "Failed to fetch drilldown data");
  }
};

export const getTicketsByRange = async (req, res) => {
  try {
    const { start, end, owners, metric, excludeZendesk, excludeNOC, region } = req.query;
    if (!start || !end) {
      return badRequest(res, "Start and end dates required");
    }

    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    logger.info({ start, end, metric }, "By-Range request");

    const matchConditions = { closed_date: { $gte: startDate, $lte: endDate } };
    applyOwnerFilter(matchConditions, owners);
    applyRegionFilter(matchConditions, region);
    applyExclusionFilters(matchConditions, { excludeZendesk, excludeNOC });
    applyBacklogFilter(matchConditions, metric);

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(200, parseInt(req.query.pageSize) || 200);

    // Compute stats via aggregation (avoids loading all docs into Node.js memory)
    const [statsAgg, tickets] = await Promise.all([
      AnalyticsTicket.aggregate([
        { $match: matchConditions },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
            frrNotMet: { $sum: { $cond: [{ $ne: ["$frr", 1] }, 1, 0] } },
            positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
            negativeCSAT: { $sum: { $cond: [{ $eq: ["$csat", 1] }, 1, 0] } },
            avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
            avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
          },
        },
      ]),
      AnalyticsTicket.find(matchConditions)
        .sort({ closed_date: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    const stats = statsAgg[0] || { total: 0, frrMet: 0, frrNotMet: 0, positiveCSAT: 0, negativeCSAT: 0, avgRWT: 0, avgIterations: 0 };
    if (stats.avgRWT) stats.avgRWT = Number(stats.avgRWT.toFixed(2));
    if (stats.avgIterations) stats.avgIterations = Number(stats.avgIterations.toFixed(2));
    const totalPages = Math.ceil((stats.total || 0) / pageSize);

    ok(res, { tickets, stats, count: stats.total, page, pageSize, totalPages });
  } catch (e) {
    logger.error({ err: e }, "By-range fetch error");
    serverError(res, e.message);
  }
};

export const getTicketsByDate = async (req, res) => {
  try {
    const { date, owners, metric, excludeZendesk, region, excludeNOC } = req.query;
    if (!date) return badRequest(res, "Date required");

    const cacheKey = `bydate:${date}:${owners || "all"}:${excludeZendesk || "false"}:${excludeNOC || "false"}`;
    const cached = await redisGet(cacheKey);
    if (cached) {
      logger.info("ByDate Redis HIT");
      return ok(res, cached);
    }

    let startOfDay, endOfDay;
    if (date.includes("W")) {
      const [year, weekPart] = date.split("-W");
      const weekNum = parseInt(weekPart);
      const jan1 = new Date(parseInt(year), 0, 1);
      const jan1Day = jan1.getDay();

      let week1Monday;
      if (jan1Day === 0) {
        week1Monday = new Date(jan1);
        week1Monday.setDate(jan1.getDate() + 1);
      } else if (jan1Day <= 4) {
        week1Monday = new Date(jan1);
        week1Monday.setDate(jan1.getDate() - (jan1Day - 1));
      } else {
        week1Monday = new Date(jan1);
        week1Monday.setDate(jan1.getDate() + (8 - jan1Day));
      }

      startOfDay = new Date(week1Monday);
      startOfDay.setDate(week1Monday.getDate() + (weekNum - 1) * 7);
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(startOfDay);
      endOfDay.setDate(startOfDay.getDate() + 6);
      endOfDay.setHours(23, 59, 59, 999);
    } else if (date.length === 7 && date.match(/^\d{4}-\d{2}$/)) {
      const [year, month] = date.split("-").map(Number);
      startOfDay = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      endOfDay = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    } else {
      startOfDay = new Date(date + "T00:00:00.000Z");
      endOfDay = new Date(date + "T23:59:59.999Z");
    }

    const matchConditions = { closed_date: { $gte: startOfDay, $lte: endOfDay } };
    applyOwnerFilter(matchConditions, owners);
    applyRegionFilter(matchConditions, region);
    applyBacklogFilter(matchConditions, metric);
    applyExclusionFilters(matchConditions, { excludeZendesk, excludeNOC: req.query.excludeNOC });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(200, parseInt(req.query.pageSize) || 200);

    const [totalCount, tickets] = await Promise.all([
      AnalyticsTicket.countDocuments(matchConditions),
      AnalyticsTicket.find(matchConditions)
        .sort({ closed_date: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    const totalPages = Math.ceil(totalCount / pageSize);
    const result = { tickets, count: totalCount, page, pageSize, totalPages };
    if (page === 1) await redisSet(cacheKey, result, CACHE_TTL.DRILLDOWN);
    ok(res, result);
  } catch (e) {
    logger.error({ err: e }, "By-date fetch error");
    serverError(res, e.message);
  }
};

export const getActiveTickets = async (req, res) => {
  try {
    const stableTickets = await redisGet("tickets:active");
    if (stableTickets && stableTickets.length > 0) {
      logger.info({ count: stableTickets.length }, "Serving stable tickets");
      return ok(res, {
        tickets: stableTickets,
        total: stableTickets.length,
        isPartial: false,
        isSyncing: false,
      });
    }

    const stagingTickets = await redisGet("tickets:syncing");
    if (stagingTickets && stagingTickets.length > 0) {
      logger.info({ count: stagingTickets.length }, "Serving staging tickets");
      return ok(res, {
        tickets: stagingTickets,
        total: stagingTickets.length,
        isPartial: true,
      });
    }

    // Cold start — quick-fetch first few pages from DevRev and return
    // immediately. A full sync would take minutes and time out on Render.
    logger.info("Cold start - no cache, quick-fetching tickets");
    try {
      const tickets = await quickFetchTickets();
      // Kick off full sync in background (non-blocking) — it will populate
      // Redis once done (if Redis has space).
      dispatchOrRun(
        getTicketSyncQueue, "sync-active", { source: "cold_start" },
        () => fetchAndCacheTickets("cold_start"),
      ).catch((e) => logger.error({ err: e }, "Background sync dispatch failed"));

      return ok(res, {
        tickets,
        total: tickets.length,
        isPartial: true,
        isSyncing: true,
      });
    } catch (syncErr) {
      logger.error({ err: syncErr }, "Quick fetch failed");
      return ok(res, { tickets: [], total: 0, isPartial: true, message: "Loading tickets..." });
    }
  } catch (e) {
    logger.error({ err: e }, "Tickets API error");
    serverError(res, e.message);
  }
};

export const getTicketLinks = async (req, res) => {
  try {
    const { ticketId } = req.body;
    const linksRes = await axios.post(
      `${DEVREV_API}/links.list`,
      {
        object: `don:core:dvrv-us-1:devo/1iVu4ClfVV:ticket/${ticketId}`,
        object_types: ["issue"],
        limit: 10,
      },
      { headers: HEADERS },
    );

    const links = linksRes.data.links || [];
    if (links.length === 0) {
      return ok(res, { hasDependency: false, issues: [] });
    }

    const issues = links
      .map((link) => {
        const target = link.target;
        if (!target || target.type !== "issue") return null;
        return {
          issueId: target.display_id,
          title: target.title,
          owner: target.owned_by?.[0]?.display_name || "Unassigned",
          ownerEmail: target.owned_by?.[0]?.email,
          priority: target.priority || target.priority_v2?.label,
          stage: target.stage?.name,
          jiraLink: target.sync_metadata?.external_reference,
        };
      })
      .filter(Boolean);

    ok(res, { hasDependency: true, issues });
  } catch (e) {
    logger.error({ err: e }, "Links fetch error");
    ok(res, { hasDependency: false, issues: [], error: e.message });
  }
};

export const getIssueDetails = async (req, res) => {
  try {
    const { issueId } = req.body;
    const issRes = await axios.post(
      `${DEVREV_API}/works.get`,
      { id: issueId },
      { headers: HEADERS },
    );

    const issue = issRes.data.work;
    if (!issue) {
      return ok(res, { error: "Issue not found" });
    }

    const customFields = issue.custom_fields || {};
    const subtype = issue.subtype || "";

    let team = "Unknown";
    if (customFields.ctype__issuetype === "PSN Task") {
      team = "NOC";
    } else if (customFields.ctype__team_involved) {
      team = customFields.ctype__team_involved;
    } else if (subtype === "internal_clevertap_slack") {
      team = customFields.ctype__team_involved || "Internal";
    } else if (subtype.includes("email")) {
      team = "Email";
    } else if (subtype.includes("whatsapp")) {
      team = "Whatsapp";
    }

    ok(res, {
      issueId: issue.display_id,
      title: issue.title,
      owner: issue.owned_by?.[0]?.display_name || "Unassigned",
      ownerEmail: issue.owned_by?.[0]?.email,
      team,
      subtype,
      jiraKey: customFields.ctype__key,
      jiraLink: issue.sync_metadata?.external_reference,
      rca: customFields.ctype__customfield_10169,
      priority: issue.priority_v2?.label || issue.priority,
      stage: issue.stage?.name,
      isNOC: customFields.ctype__issuetype === "PSN Task",
    });
  } catch (e) {
    logger.error({ err: e }, "Issue fetch error");
    ok(res, { error: e.message });
  }
};

export const getBatchDependencies = async (req, res) => {
  try {
    const { ticketIds } = req.body;
    const results = {};
    const BATCH_SIZE = 5;

    for (let i = 0; i < ticketIds.length; i += BATCH_SIZE) {
      const batch = ticketIds.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (ticketId) => {
          try {
            const linksRes = await axios.post(
              `${DEVREV_API}/links.list`,
              {
                object: `don:core:dvrv-us-1:devo/1iVu4ClfVV:ticket/${ticketId}`,
                object_types: ["issue"],
                limit: 10,
              },
              { headers: HEADERS },
            );

            const links = linksRes.data.links || [];
            if (links.length === 0) {
              results[ticketId] = { hasDependency: false, issues: [] };
              return;
            }

            const issues = await Promise.all(
              links.map(async (link) => {
                const target = link.target;
                if (!target || target.type !== "issue") return null;
                try {
                  const issRes = await axios.post(
                    `${DEVREV_API}/works.get`,
                    { id: target.display_id },
                    { headers: HEADERS },
                  );
                  const issue = issRes.data.work;
                  if (!issue) return null;
                  const customFields = issue.custom_fields || {};
                  let team = "Other";
                  if (customFields.ctype__issuetype === "PSN Task") {
                    team = "NOC";
                  } else if (customFields.ctype__team_involved) {
                    team = customFields.ctype__team_involved;
                  } else if (issue.subtype === "internal_clevertap_slack") {
                    team = "Internal";
                  }
                  return {
                    issueId: issue.display_id,
                    title: issue.title,
                    owner: issue.owned_by?.[0]?.display_name || "Unassigned",
                    team,
                    isNOC: customFields.ctype__issuetype === "PSN Task",
                    jiraKey: customFields.ctype__key,
                    priority: issue.priority_v2?.label,
                    stage: issue.stage?.name,
                  };
                } catch (e) {
                  return {
                    issueId: target.display_id,
                    title: target.title,
                    owner: target.owned_by?.[0]?.display_name || "Unassigned",
                    team: "Unknown",
                    isNOC: false,
                  };
                }
              }),
            );

            const validIssues = issues.filter(Boolean);
            validIssues.sort((a, b) => {
              if (a.isNOC && !b.isNOC) return -1;
              if (!a.isNOC && b.isNOC) return 1;
              return 0;
            });

            results[ticketId] = {
              hasDependency: true,
              issues: validIssues,
              primary: validIssues.find((i) => i.isNOC) || validIssues[0],
            };
          } catch (e) {
            results[ticketId] = { hasDependency: false, issues: [], error: e.message };
          }
        }),
      );
    }

    ok(res, results);
  } catch (e) {
    logger.error({ err: e }, "Dependencies batch fetch error");
    serverError(res, e.message);
  }
};

export const syncTickets = async (req, res) => {
  await dispatchOrRun(
    getTicketSyncQueue, "sync-active", { source: "manual" },
    () => fetchAndCacheTickets("manual"),
  );
  ok(res, null);
};

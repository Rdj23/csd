import { startOfISOWeek, addWeeks, addDays, endOfDay, startOfDay as dfnsStartOfDay } from "date-fns";
import { AnalyticsTicket } from "../models/index.js";
import { redisGet, redisGetRaw, redisSet, CACHE_TTL } from "../config/database.js";
import { fetchTicketLinks, fetchWorkItem, classifyIssueTeam } from "../services/devrevApi.js";
import { fetchAndCacheTickets, quickFetchTickets } from "../services/syncService.js";
import { getTicketSyncQueue } from "../lib/queues.js";
import { ok, okRaw, badRequest, serverError } from "../utils/response.js";
import logger from "../config/logger.js";
import { applyOwnerFilter, applyRegionFilter, applyExclusionFilters, applyBacklogFilter } from "../utils/queryBuilders.js";
import { SOLVED_STATUSES } from "../config/constants.js";

// Fields the frontend analytics table actually renders — excludes heavy NOC
// metadata, devrev_id, owner_id, sync fields, etc. to keep documents small.
const TICKET_TABLE_FIELDS = {
  display_id: 1, ticket_id: 1, title: 1, owner: 1,
  created_date: 1, closed_date: 1, actual_close_date: 1,
  rwt: 1, frt: 1, iterations: 1, csat: 1, frr: 1,
  account_name: 1, region: 1, stage_name: 1,
  is_noc: 1, account_cohort: 1, priority: 1,
  _id: 1,
};

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
    const cachedRaw = await redisGetRaw(cacheKey);
    if (cachedRaw) {
      logger.info("LiveStats Redis HIT");
      return okRaw(res, cachedRaw);
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
      ]).allowDiskUse(true),
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
      ]).allowDiskUse(true),
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
      query.stage_name = { $in: SOLVED_STATUSES };
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

    const pageSize = Math.min(200, parseInt(req.query.pageSize) || 200);
    const { cursor } = req.query;

    // Build ticket query — cursor-based when cursor is provided, offset otherwise
    const ticketQuery = { ...matchConditions };
    let usingCursor = false;
    if (cursor) {
      // cursor = "<closed_date ISO>_<_id>" — encodes the last item seen
      const sep = cursor.lastIndexOf("_");
      if (sep > 0) {
        const cursorDate = new Date(cursor.slice(0, sep));
        const cursorId = cursor.slice(sep + 1);
        if (!isNaN(cursorDate.getTime())) {
          // Fetch the next page: items whose (closed_date, _id) sort AFTER the cursor
          ticketQuery.$or = [
            { closed_date: { ...ticketQuery.closed_date, $lt: cursorDate } },
            { closed_date: cursorDate, _id: { $lt: cursorId } },
          ];
          usingCursor = true;
        }
      }
    }
    const page = usingCursor ? null : Math.max(1, parseInt(req.query.page) || 1);

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
      ]).allowDiskUse(true),
      AnalyticsTicket.find(ticketQuery)
        .select(TICKET_TABLE_FIELDS)
        .sort({ closed_date: -1, _id: -1 })
        .skip(usingCursor ? 0 : (page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    const stats = statsAgg[0] || { total: 0, frrMet: 0, frrNotMet: 0, positiveCSAT: 0, negativeCSAT: 0, avgRWT: 0, avgIterations: 0 };
    if (stats.avgRWT) stats.avgRWT = Number(stats.avgRWT.toFixed(2));
    if (stats.avgIterations) stats.avgIterations = Number(stats.avgIterations.toFixed(2));
    const totalPages = Math.ceil((stats.total || 0) / pageSize);

    // Build next cursor from the last returned ticket
    const last = tickets[tickets.length - 1];
    const nextCursor = last ? `${new Date(last.closed_date).toISOString()}_${last._id}` : null;

    ok(res, { tickets, stats, count: stats.total, page, pageSize, totalPages, nextCursor });
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
    const cachedRaw = await redisGetRaw(cacheKey);
    if (cachedRaw) {
      logger.info("ByDate Redis HIT");
      return okRaw(res, cachedRaw);
    }

    let startDate, endDate;
    if (date.includes("W")) {
      // "2026-W10" → ISO week 10 of 2026 (Monday–Sunday)
      const [year, weekPart] = date.split("-W");
      const weekNum = parseInt(weekPart);
      // startOfISOWeek of Jan 4 always lands in ISO week 1
      const week1Monday = startOfISOWeek(new Date(parseInt(year), 0, 4));
      startDate = dfnsStartOfDay(addWeeks(week1Monday, weekNum - 1));
      endDate = endOfDay(addDays(startDate, 6));
    } else if (date.length === 7 && date.match(/^\d{4}-\d{2}$/)) {
      const [year, month] = date.split("-").map(Number);
      startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    } else {
      startDate = new Date(date + "T00:00:00.000Z");
      endDate = new Date(date + "T23:59:59.999Z");
    }

    const matchConditions = { closed_date: { $gte: startDate, $lte: endDate } };
    applyOwnerFilter(matchConditions, owners);
    applyRegionFilter(matchConditions, region);
    applyBacklogFilter(matchConditions, metric);
    applyExclusionFilters(matchConditions, { excludeZendesk, excludeNOC: req.query.excludeNOC });

    const pageSize = Math.min(200, parseInt(req.query.pageSize) || 200);
    const { cursor } = req.query;

    const ticketQuery = { ...matchConditions };
    let usingCursor = false;
    if (cursor) {
      const sep = cursor.lastIndexOf("_");
      if (sep > 0) {
        const cursorDate = new Date(cursor.slice(0, sep));
        const cursorId = cursor.slice(sep + 1);
        if (!isNaN(cursorDate.getTime())) {
          ticketQuery.$or = [
            { closed_date: { ...ticketQuery.closed_date, $lt: cursorDate } },
            { closed_date: cursorDate, _id: { $lt: cursorId } },
          ];
          usingCursor = true;
        }
      }
    }
    const page = usingCursor ? null : Math.max(1, parseInt(req.query.page) || 1);

    const [totalCount, tickets] = await Promise.all([
      AnalyticsTicket.countDocuments(matchConditions),
      AnalyticsTicket.find(ticketQuery)
        .select(TICKET_TABLE_FIELDS)
        .sort({ closed_date: -1, _id: -1 })
        .skip(usingCursor ? 0 : (page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    const totalPages = Math.ceil(totalCount / pageSize);
    const last = tickets[tickets.length - 1];
    const nextCursor = last ? `${new Date(last.closed_date).toISOString()}_${last._id}` : null;

    const result = { tickets, count: totalCount, page, pageSize, totalPages, nextCursor };
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
    const links = await fetchTicketLinks(ticketId);

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
    const issue = await fetchWorkItem(issueId);

    if (!issue) {
      return ok(res, { error: "Issue not found" });
    }

    const customFields = issue.custom_fields || {};
    const team = classifyIssueTeam(issue);

    ok(res, {
      issueId: issue.display_id,
      title: issue.title,
      owner: issue.owned_by?.[0]?.display_name || "Unassigned",
      ownerEmail: issue.owned_by?.[0]?.email,
      team,
      subtype: issue.subtype || "",
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
            const links = await fetchTicketLinks(ticketId);

            if (links.length === 0) {
              results[ticketId] = { hasDependency: false, issues: [] };
              return;
            }

            const issues = await Promise.all(
              links.map(async (link) => {
                const target = link.target;
                if (!target || target.type !== "issue") return null;
                try {
                  const issue = await fetchWorkItem(target.display_id);
                  if (!issue) return null;
                  const customFields = issue.custom_fields || {};
                  return {
                    issueId: issue.display_id,
                    title: issue.title,
                    owner: issue.owned_by?.[0]?.display_name || "Unassigned",
                    team: classifyIssueTeam(issue, "Other"),
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
            const sorted = [...validIssues].sort((a, b) => {
              if (a.isNOC && !b.isNOC) return -1;
              if (!a.isNOC && b.isNOC) return 1;
              return 0;
            });

            results[ticketId] = {
              hasDependency: true,
              issues: sorted,
              primary: sorted.find((i) => i.isNOC) || sorted[0],
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

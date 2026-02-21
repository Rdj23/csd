import axios from "axios";
import { AnalyticsTicket } from "../models/index.js";
import { redisGet, redisSet, CACHE_TTL } from "../config/database.js";
import { DEVREV_API, HEADERS } from "../services/devrevApi.js";
import { batchFetchTimelineReplies, fetchMissingTimelinesForWorker } from "../services/timelineService.js";
import { fetchAndCacheTickets, quickFetchTickets } from "../services/syncService.js";
import { getTicketSyncQueue, getTimelineQueue } from "../lib/queues.js";
import { ok, badRequest, serverError } from "../utils/response.js";
import logger from "../config/logger.js";

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
    if (owners && owners.length > 0 && owners !== "All") {
      const ownerList = owners.split(",").filter((o) => o.trim());
      if (ownerList.length > 0) matchConditions.owner = { $in: ownerList };
    }
    if (region && region.length > 0 && region !== "All") {
      matchConditions.region = { $in: region.split(",").filter((r) => r.trim()) };
    }
    if (excludeZendesk === "true") matchConditions.is_zendesk = { $ne: true };
    if (req.query.excludeNOC === "true") matchConditions.is_noc = { $ne: true };

    const result = await AnalyticsTicket.aggregate([
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
          dailyData: {
            $push: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } },
              rwt: "$rwt",
              frt: "$frt",
              iterations: "$iterations",
              csat: "$csat",
              frr: "$frr",
            },
          },
        },
      },
    ]);

    if (result.length === 0) {
      return ok(res, { stats: {}, trends: [] });
    }

    const data = result[0];
    const trendsMap = {};
    data.dailyData.forEach((t) => {
      if (!trendsMap[t.date]) {
        trendsMap[t.date] = { date: t.date, solved: 0, sumRWT: 0, countRWT: 0, sumFRT: 0, countFRT: 0, sumIter: 0, countIter: 0, positiveCSAT: 0, frrMet: 0, frrTotal: 0 };
      }
      const day = trendsMap[t.date];
      day.solved++;
      day.frrTotal++;
      if (t.csat === 2) day.positiveCSAT++;
      if (t.frr === 1) day.frrMet++;
      if (t.rwt > 0) { day.sumRWT += t.rwt; day.countRWT++; }
      if (t.frt > 0) { day.sumFRT += t.frt; day.countFRT++; }
      if (t.iterations > 0) { day.sumIter += t.iterations; day.countIter++; }
    });

    const trends = Object.values(trendsMap)
      .map((day) => ({
        date: day.date,
        solved: day.solved,
        positiveCSAT: day.positiveCSAT,
        frrMet: day.frrMet,
        frrPercent: day.frrTotal > 0 ? Math.round((day.frrMet / day.frrTotal) * 100) : 0,
        avgRWT: day.countRWT ? day.sumRWT / day.countRWT : 0,
        avgFRT: day.countFRT ? day.sumFRT / day.countFRT : 0,
        avgIterations: day.countIter ? day.sumIter / day.countIter : 0,
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

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
    if (owners && owners !== "All") {
      const ownerList = owners.split(",").filter((o) => o.trim());
      if (ownerList.length > 0) matchConditions.owner = { $in: ownerList };
    }
    if (region && region !== "All") {
      matchConditions.region = { $in: region.split(",").filter((r) => r.trim()) };
    }
    if (excludeZendesk === "true") matchConditions.is_zendesk = { $ne: true };
    if (excludeNOC === "true") matchConditions.is_noc = { $ne: true };
    if (metric === "backlog") {
      matchConditions.$expr = { $gt: [{ $subtract: ["$closed_date", "$created_date"] }, 15 * 86400000] };
    }

    const tickets = await AnalyticsTicket.find(matchConditions).sort({ closed_date: -1 }).limit(2000).lean();

    const stats = {
      total: tickets.length,
      frrMet: tickets.filter(t => t.frr === 1).length,
      frrNotMet: tickets.filter(t => t.frr !== 1).length,
      positiveCSAT: tickets.filter(t => t.csat === 2).length,
      negativeCSAT: tickets.filter(t => t.csat === 1).length,
      avgRWT: tickets.length > 0
        ? (tickets.reduce((sum, t) => sum + (t.rwt || 0), 0) / tickets.filter(t => t.rwt > 0).length).toFixed(2)
        : 0,
      avgIterations: tickets.length > 0
        ? (tickets.reduce((sum, t) => sum + (t.iterations || 0), 0) / tickets.filter(t => t.iterations > 0).length).toFixed(2)
        : 0,
    };

    ok(res, { tickets, stats, count: tickets.length });
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
    if (owners && owners.length > 0 && owners !== "All") {
      const ownerList = owners.split(",").filter((o) => o.trim());
      if (ownerList.length > 0) matchConditions.owner = { $in: ownerList };
    }
    if (region && region !== "All") {
      matchConditions.region = { $in: region.split(",").filter((r) => r.trim()) };
    }
    if (metric === "backlog") {
      matchConditions.$expr = { $gt: [{ $subtract: ["$closed_date", "$created_date"] }, 15 * 86400000] };
    }
    if (excludeZendesk === "true") matchConditions.is_zendesk = { $ne: true };
    if (region && region.length > 0) matchConditions.region = { $in: region.split(",") };
    if (req.query.excludeNOC === "true") matchConditions.is_noc = { $ne: true };

    const tickets = await AnalyticsTicket.find(matchConditions).sort({ closed_date: -1 }).limit(2000).lean();

    await redisSet(cacheKey, { tickets }, CACHE_TTL.DRILLDOWN);
    ok(res, { tickets, count: tickets.length });
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

export const getTimelineReplies = async (req, res) => {
  try {
    const { ticketIds } = req.body;
    if (!ticketIds || !ticketIds.length) {
      return ok(res, { cached: {}, pending: [] });
    }

    // Instant cache-only read — no DevRev calls in this HTTP path
    const { cached, pending } = await batchFetchTimelineReplies(ticketIds);

    // Dispatch timeline fetch via BullMQ, or run directly if Redis is down
    if (pending.length > 0) {
      await dispatchOrRun(
        getTimelineQueue, "fetch-missing", { ticketIds: pending },
        () => fetchMissingTimelinesForWorker(pending),
      );
    }

    ok(res, { cached, pending });
  } catch (e) {
    logger.error({ err: e }, "Timeline replies batch fetch error");
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

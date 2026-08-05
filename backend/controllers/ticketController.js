import { AnalyticsTicket } from "../models/index.js";
import { redisGet, redisGetRaw, redisSet, CACHE_TTL } from "../config/database.js";
import { fetchTicketLinks, fetchWorkItem, fetchWorkItems, dependencyCounterpart, classifyLinkedWorkTeam } from "../services/devrevApi.js";
import { fetchAndCacheTickets, quickFetchTickets } from "../services/syncService.js";
import { getTicketSyncQueue } from "../lib/queues.js";
import { ok, okRaw, badRequest, serverError } from "../utils/response.js";
import logger from "../config/logger.js";
import { applyOwnerFilter, applyRegionFilter, applyExclusionFilters, applyBacklogFilter } from "../utils/queryBuilders.js";
import { SOLVED_STATUSES, istDayStart, istDayEnd } from "../config/constants.js";
import { DASH_TZ } from "../utils/aggregationStages.js";

// Parse a keyset cursor "<ISO_date>_<_id>" into { cursorDate, cursorId }.
// Handles URL-encoded values (colons, plus signs in ISO dates) transparently.
const parseCursor = (raw) => {
  if (!raw) return null;
  const decoded = decodeURIComponent(raw);
  const sep = decoded.lastIndexOf("_");
  if (sep <= 0) return null;
  const cursorDate = new Date(decoded.slice(0, sep));
  if (isNaN(cursorDate.getTime())) return null;
  return { cursorDate, cursorId: decoded.slice(sep + 1) };
};

// Fields the frontend analytics table actually renders — excludes heavy NOC
// metadata, devrev_id, owner_id, sync fields, etc. to keep documents small.
const TICKET_TABLE_FIELDS = {
  display_id: 1, ticket_id: 1, title: 1, owner: 1,
  created_date: 1, closed_date: 1, actual_close_date: 1,
  rwt: 1, frt: 1, iterations: 1, csat: 1, frr: 1,
  account_name: 1, region: 1, stage_name: 1,
  is_noc: 1, account_cohort: 1, priority: 1,
  has_dependency: 1, dependency_teams: 1, dependency_assignees: 1,
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

    // "ist" = IST-bucketed cache format; keeps old UTC-bucketed entries from serving.
    const cacheKey = `livestats:ist:${start}:${end}:${owners || "all"}:${region || "all"}:${excludeZendesk || "false"}:${excludeNOC || "false"}`;
    const cachedRaw = await redisGetRaw(cacheKey);
    if (cachedRaw) {
      logger.info("LiveStats Redis HIT");
      return okRaw(res, cachedRaw);
    }

    // Date-only params are IST calendar days (matches the IST trend bucketing).
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    const startDate = dateOnly.test(start) ? istDayStart(start) : new Date(start);
    const endDate = dateOnly.test(end) ? istDayEnd(end) : new Date(end);

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
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date", timezone: DASH_TZ } },
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

    // IST calendar day (matches the IST trend bucketing)
    const startOfDay = istDayStart(date.slice(0, 10));
    const endOfDay = istDayEnd(date.slice(0, 10));

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

    // IST calendar days (matches the IST trend bucketing)
    const startDate = istDayStart(start.slice(0, 10));
    const endDate = istDayEnd(end.slice(0, 10));

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
    const parsed = parseCursor(cursor);
    if (parsed) {
      ticketQuery.$or = [
        { closed_date: { ...ticketQuery.closed_date, $lt: parsed.cursorDate } },
        { closed_date: parsed.cursorDate, _id: { $lt: parsed.cursorId } },
      ];
    }
    const page = parsed ? null : Math.max(1, parseInt(req.query.page) || 1);

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
        .skip(parsed ? 0 : (page - 1) * pageSize)
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

// Fields the All Tickets reshape needs from Mongo. Mirrors TICKET_TABLE_FIELDS
// plus the classification fields the frontend uses to bucket "Resolved By".
const ALL_SOLVED_FIELDS = {
  display_id: 1, ticket_id: 1, title: 1, owner: 1,
  created_date: 1, closed_date: 1, actual_close_date: 1,
  rwt: 1, frt: 1, iterations: 1, csat: 1, frr: 1,
  account_name: 1, region: 1, stage_name: 1, priority: 1,
  is_zendesk: 1, resolved_by: 1, agent_resolved: 1, devrev_id: 1,
  has_dependency: 1, dependency_teams: 1, dependency_assignees: 1,
  _id: 1,
};

// Defensive ceiling on a single quarter's solved set. Far above realistic
// volume (~a few thousand/quarter); if we ever hit it we log rather than
// silently truncate, so the gap is visible instead of looking like "all data".
const ALL_SOLVED_MAX = 20000;

/**
 * Reshape a flat AnalyticsTicket (Mongo) doc into the nested DevRev-style shape
 * the All Tickets view expects, so it flows through the same client-side
 * mapping/filtering pipeline as live cache tickets — no frontend branching.
 *
 * Lossy by necessity: CSM/TAM are not persisted in analyticstickets, so they
 * surface as "Unknown" for historical solved tickets (the CSM/TAM group-by and
 * filters degrade gracefully; GST/Region/Account remain accurate).
 */
const reshapeSolvedTicket = (d) => ({
  id: d.devrev_id || d.ticket_id || String(d._id),
  display_id: d.display_id || d.ticket_id,
  title: d.title,
  stage: { name: d.stage_name || "Solved" },
  // owner already holds the resolved GST name (or "Unassigned" for agent-only).
  // No display_id, so the frontend's FLAT_TEAM_MAP lookup misses and falls back
  // to display_name — exactly the resolved name we want.
  owned_by: d.owner ? [{ display_name: d.owner }] : [],
  created_date: d.created_date,
  // Expose the canonical closed_date (the field the server filtered on, and the
  // one Analytics counts) as actual_close_date so the client's re-filter keeps
  // exactly this set — avoids drift when DevRev's actual_close_date differs.
  actual_close_date: d.closed_date || d.actual_close_date,
  isZendesk: d.is_zendesk === true,
  // Sync-time dependency snapshot (see AnalyticsTicketSchema). undefined/null
  // means "never checked" — the frontend then falls back to the live map.
  has_dependency: d.has_dependency ?? null,
  dependency_teams: d.dependency_teams || [],
  dependency_assignees: d.dependency_assignees || [],
  custom_fields: {
    tnt__region_salesforce: d.region || "Unknown",
    tnt__instance_account_name: d.account_name || "Unknown",
    tnt__rwt_business_hours: d.rwt ?? null,
    tnt__frt_hours: d.frt ?? null,
    tnt__iteration_count: d.iterations ?? null,
    tnt__csatrating: d.csat ?? null,
    tnt__frr: d.frr === 1,
    // Mirror Mongo's canonical resolved_by into the two flags the frontend reads.
    tnt__agent_resolved: d.resolved_by === "agent",
    tnt__support_engineer_handled: d.resolved_by === "engineer",
  },
});

/**
 * All Tickets — full solved/closed history for a date range, sourced from
 * MongoDB (analyticstickets) by closed_date.
 *
 * WHY this exists: GET /api/tickets serves the Redis "tickets:active" cache,
 * which only retains solved tickets created since SOLVED_CUTOFF_DATE and is
 * bounded by the Valkey memory cap. Past quarters' solved tickets get squeezed
 * out, so the All Tickets view showed zeros for e.g. Q1. Mongo is the permanent
 * store, so we read solved buckets from here while the live (open/pending/
 * on-hold) buckets keep coming from the active cache.
 */
export const getAllSolvedForRange = async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return badRequest(res, "Start and end dates required");

    // Interpret the yyyy-MM-dd range as IST calendar days so the solved bucket
    // matches the IST-bucketed analytics (was UTC/server-local midnight).
    const startDate = istDayStart(start.slice(0, 10));
    const endDate = istDayEnd(end.slice(0, 10));

    const cacheKey = `alltickets:solved:ist:${start}:${end}`;
    const cachedRaw = await redisGetRaw(cacheKey);
    if (cachedRaw) {
      logger.info("AllSolved Redis HIT");
      return okRaw(res, cachedRaw);
    }

    const matchConditions = { closed_date: { $gte: startDate, $lte: endDate } };

    const docs = await AnalyticsTicket.find(matchConditions)
      .select(ALL_SOLVED_FIELDS)
      .sort({ closed_date: -1, _id: -1 })
      .limit(ALL_SOLVED_MAX)
      .lean();

    if (docs.length >= ALL_SOLVED_MAX) {
      logger.warn(
        { start, end, returned: docs.length, cap: ALL_SOLVED_MAX },
        "AllSolved hit the result cap — older solved tickets in range were truncated",
      );
    }

    const tickets = docs.map(reshapeSolvedTicket);
    const result = { tickets, count: tickets.length, capped: docs.length >= ALL_SOLVED_MAX };
    await redisSet(cacheKey, result, CACHE_TTL.DRILLDOWN);
    ok(res, result);
  } catch (e) {
    logger.error({ err: e }, "AllSolved fetch error");
    serverError(res, e.message);
  }
};

export const getTicketsByDate = async (req, res) => {
  try {
    const { date, owners, metric, excludeZendesk, region, excludeNOC } = req.query;
    if (!date) return badRequest(res, "Date required");

    const cacheKey = `bydate:ist:${date}:${owners || "all"}:${excludeZendesk || "false"}:${excludeNOC || "false"}`;
    const cachedRaw = await redisGetRaw(cacheKey);
    if (cachedRaw) {
      logger.info("ByDate Redis HIT");
      return okRaw(res, cachedRaw);
    }

    // All windows are IST calendar days/weeks/months — the trend buckets the
    // user clicked were produced with timezone: DASH_TZ, so the drill-down
    // window must open/close at IST midnight to return the same tickets.
    const DAY_MS = 24 * 60 * 60 * 1000;
    let startDate, endDate;
    if (date.includes("W")) {
      // "2026-W10" → ISO week 10 of 2026 (Monday–Sunday, IST days)
      const [yearStr, weekPart] = date.split("-W");
      const weekNum = parseInt(weekPart);
      // Jan 4 always lands in ISO week 1. Its weekday is timezone-independent
      // for a calendar date, so derive Monday's date arithmetically.
      const jan4 = new Date(Date.UTC(parseInt(yearStr), 0, 4));
      const mondayOffset = (jan4.getUTCDay() + 6) % 7; // days since Monday
      const week1MondayUTC = new Date(jan4.getTime() - mondayOffset * DAY_MS);
      const targetMondayUTC = new Date(week1MondayUTC.getTime() + (weekNum - 1) * 7 * DAY_MS);
      startDate = istDayStart(targetMondayUTC.toISOString().slice(0, 10));
      endDate = new Date(startDate.getTime() + 7 * DAY_MS - 1);
    } else if (date.length === 7 && date.match(/^\d{4}-\d{2}$/)) {
      const [year, month] = date.split("-").map(Number);
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      startDate = istDayStart(`${date}-01`);
      endDate = istDayEnd(`${date}-${String(lastDay).padStart(2, "0")}`);
    } else {
      startDate = istDayStart(date);
      endDate = istDayEnd(date);
    }

    const matchConditions = { closed_date: { $gte: startDate, $lte: endDate } };
    applyOwnerFilter(matchConditions, owners);
    applyRegionFilter(matchConditions, region);
    applyBacklogFilter(matchConditions, metric);
    applyExclusionFilters(matchConditions, { excludeZendesk, excludeNOC: req.query.excludeNOC });

    const pageSize = Math.min(200, parseInt(req.query.pageSize) || 200);
    const { cursor } = req.query;

    const ticketQuery = { ...matchConditions };
    const parsed = parseCursor(cursor);
    if (parsed) {
      ticketQuery.$or = [
        { closed_date: { ...ticketQuery.closed_date, $lt: parsed.cursorDate } },
        { closed_date: parsed.cursorDate, _id: { $lt: parsed.cursorId } },
      ];
    }
    const page = parsed ? null : Math.max(1, parseInt(req.query.page) || 1);

    const [totalCount, tickets] = await Promise.all([
      AnalyticsTicket.countDocuments(matchConditions),
      AnalyticsTicket.find(ticketQuery)
        .select(TICKET_TABLE_FIELDS)
        .sort({ closed_date: -1, _id: -1 })
        .skip(parsed ? 0 : (page - 1) * pageSize)
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
    // Hot path — pipe the raw JSON string from Redis without parsing.
    // "tickets:active" holds ~3,000 full DevRev ticket objects (~20-60 MB).
    // JSON.parse() on this would spike the heap for every concurrent request.
    const [rawStable, storedEtag] = await Promise.all([
      redisGetRaw("tickets:active"),
      redisGetRaw("tickets:active:etag"),
    ]);
    if (rawStable && rawStable.length > 5) {
      if (storedEtag) {
        res.setHeader("ETag", storedEtag);
        // Compare ignoring the W/ weak prefix — intermediaries (CDN/proxy)
        // may weaken a strong ETag when they re-compress the response.
        const clientEtag = (req.headers["if-none-match"] || "").replace(/^W\//, "");
        if (clientEtag && clientEtag === storedEtag.replace(/^W\//, "")) {
          logger.info("Serving stable tickets (304 not modified)");
          return res.status(304).end();
        }
      }
      logger.info("Serving stable tickets (raw)");
      res.setHeader("Content-Type", "application/json");
      return res.end(`{"success":true,"isPartial":false,"isSyncing":false,"tickets":${rawStable}}`);
    }

    const rawStaging = await redisGetRaw("tickets:syncing");
    if (rawStaging && rawStaging.length > 5) {
      logger.info("Serving staging tickets (raw)");
      res.setHeader("Content-Type", "application/json");
      return res.end(`{"success":true,"isPartial":true,"isSyncing":false,"tickets":${rawStaging}}`);
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

    const seen = new Set();
    const issues = links
      .map((link) => {
        const target = dependencyCounterpart(link, ticketId);
        if (!target || seen.has(target.display_id)) return null;
        seen.add(target.display_id);
        return {
          issueId: target.display_id,
          title: target.title,
          owner: target.owned_by?.[0]?.display_name || "Unassigned",
          ownerEmail: target.owned_by?.[0]?.email,
          team: classifyLinkedWorkTeam(target),
          priority: target.priority || target.priority_v2?.label,
          stage: target.stage?.name,
          jiraLink: target.sync_metadata?.external_reference,
        };
      })
      .filter(Boolean);

    ok(res, { hasDependency: issues.length > 0, issues });
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
    const team = classifyLinkedWorkTeam(issue, null, "Unknown");

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
      createdDate: issue.created_date || null,
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

      // Step 1: Fetch all links for this batch of tickets in parallel
      const batchLinks = await Promise.all(
        batch.map(async (ticketId) => {
          try {
            const links = await fetchTicketLinks(ticketId);
            return { ticketId, links };
          } catch (e) {
            logger.warn({ err: e.message, ticketId }, "Failed to fetch links for ticket");
            results[ticketId] = { hasDependency: false, issues: [], error: e.message };
            return { ticketId, links: [] };
          }
        }),
      );

      // Step 2: Pick the dependency counterpart of every link — issues, plus
      // UCMR-synced tickets and TAM tasks / custom objects — deduped per
      // ticket and across the batch (Sets keep the dedup O(1) per check).
      const depsByTicket = new Map();
      const allIssueIdSet = new Set();
      for (const { ticketId, links } of batchLinks) {
        const seen = new Set();
        const deps = [];
        for (const link of links) {
          const counterpart = dependencyCounterpart(link, ticketId);
          if (!counterpart || seen.has(counterpart.display_id)) continue;
          seen.add(counterpart.display_id);
          deps.push({ displayId: counterpart.display_id, snapshot: counterpart });
        }
        depsByTicket.set(ticketId, deps);
        for (const { displayId } of deps) {
          // Custom objects (e.g. TAM tasks) aren't works — works.get would
          // fail on them, so only real work items get the enrichment fetch;
          // everything else renders from the links.list snapshot.
          if (/^(ISS|TKT|TASK)-/i.test(displayId)) allIssueIdSet.add(displayId);
        }
      }
      const allIssueIds = [...allIssueIdSet];

      // Step 3: Single batch fetch for all linked issues (replaces N separate works.get calls)
      let issueMap = new Map();
      if (allIssueIds.length > 0) {
        try {
          issueMap = await fetchWorkItems(allIssueIds);
        } catch (e) {
          logger.warn({ err: e.message, issueCount: allIssueIds.length }, "Batch fetch of linked work items failed, falling back to individual fetches");
          // Fallback: fetch individually so partial data is still returned
          for (const id of allIssueIds) {
            try {
              const work = await fetchWorkItem(id);
              if (work) issueMap.set(id, work);
            } catch (innerErr) {
              logger.warn({ err: innerErr.message, targetId: id }, "Failed to fetch linked work item individually");
            }
          }
        }
      }

      // Step 4: Assemble results for each ticket using the pre-fetched issue map
      for (const { ticketId } of batchLinks) {
        if (results[ticketId]) continue; // already set (e.g. link-fetch error)
        const deps = depsByTicket.get(ticketId) || [];

        if (deps.length === 0) {
          results[ticketId] = { hasDependency: false, issues: [] };
          continue;
        }

        const issues = deps.map(({ displayId, snapshot }) => {
          // Custom objects and failed fetches fall back to the links.list
          // snapshot, which already carries owner/stage/title.
          const work = issueMap.get(displayId) || snapshot;
          const customFields = work.custom_fields || {};
          return {
            issueId: displayId,
            title: work.title,
            owner: work.owned_by?.[0]?.display_name || "Unassigned",
            team: classifyLinkedWorkTeam(work, snapshot),
            isNOC: customFields.ctype__issuetype === "PSN Task",
            jiraKey: customFields.ctype__key,
            priority: work.priority_v2?.label || work.priority,
            stage: work.stage?.name,
            // Feeds the Attention Queue on-hold rule (linked ISS age ≥7d)
            createdDate: work.created_date || snapshot?.created_date || null,
          };
        }).filter(Boolean);

        const sorted = [...issues].sort((a, b) => {
          if (a.isNOC && !b.isNOC) return -1;
          if (!a.isNOC && b.isNOC) return 1;
          return 0;
        });

        results[ticketId] = {
          hasDependency: true,
          issues: sorted,
          primary: sorted.find((i) => i.isNOC) || sorted[0],
        };
      }
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

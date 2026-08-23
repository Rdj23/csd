import { UserActivityEntry, UserActivityDaily, AnalyticsTicket, ActivitySyncedTicket } from "../models/index.js";
import { syncActivityBatch } from "../services/activityService.js";
import { getActivitySyncQueue } from "../lib/queues.js";
import { redisGet, redisLock } from "../config/database.js";
import { GST_MEMBERS, resolveOwnerName, getCurrentQuarterKey, INACTIVITY_HIDE_DAYS } from "../config/constants.js";
import { ok, badRequest, serverError } from "../utils/response.js";
import logger from "../config/logger.js";

// ---------------------------------------------------------------------------
// Demand-driven ("sync-on-read") activity refresh
// ---------------------------------------------------------------------------
// WHY THIS EXISTS:
// The background crons (frequent/daily) are the intended freshness mechanism,
// but they are fragile on a spin-down host: when the instance sleeps, the
// scheduler dies, and if it comes back as NODE_ROLE=api the crons never
// re-register — so the tracker silently stops updating (fine till date X,
// then nothing). This makes freshness DEMAND-DRIVEN instead: when a human
// actually opens the Activity view, we kick off one incremental sync.
//
// WHY IT DOESN'T STRESS THE SERVER (the explicit requirement):
//  - Rate-limited: a Redis NX key (redisLock, no unlock) acts as a cooldown —
//    at most ONE sync per READ_SYNC_COOLDOWN_S window, no matter how many
//    users/tabs/endpoints fire. Idle hours = zero DevRev calls.
//  - Non-blocking: fire-and-forget. The read returns immediately from Mongo;
//    the (~seconds-long) DevRev sync happens in the worker. The user sees
//    fresh numbers on their next poll — the "5s is fine" tolerance.
//  - Deduped: the sync itself dedups by entry_id, so overlapping runs are safe.
const READ_SYNC_COOLDOWN_S = 600; // 10 min — matches the frequent-cron cadence
const READ_SYNC_COOLDOWN_KEY = "activity:read-sync:cooldown";

const maybeTriggerReadSync = async () => {
  try {
    const queue = getActivitySyncQueue();
    if (!queue) return; // No BullMQ worker — never run a heavy sync on the API event loop.

    // NX cooldown: first caller in the window wins; everyone else is a no-op.
    // We intentionally DON'T release the lock — its TTL is the cooldown window.
    const token = await redisLock(READ_SYNC_COOLDOWN_KEY, READ_SYNC_COOLDOWN_S);
    if (!token || token === "no-redis") return; // synced recently, or Redis unavailable

    // No fixed jobId: the queue keeps only the last few completed jobs
    // (removeOnComplete), so a reused id would eventually be rejected. The
    // cooldown above is what prevents pile-up, not the id.
    await queue.add("frequent", {});
    logger.info("Dispatched demand-driven activity sync (read-triggered)");
  } catch (err) {
    // A trigger failure must never affect the read response.
    logger.warn({ err: err.message }, "Read-triggered activity sync dispatch failed");
  }
};

// ---------------------------------------------------------------------------
// Inactive-member (leaver) detection
// ---------------------------------------------------------------------------
// A member whose most recent comment is older than INACTIVITY_HIDE_DAYS is
// treated as "left the org" and hidden from the activity view. Members with NO
// activity at all are NOT hidden (benefit of the doubt — could be new / on
// leave); only people who were once active and then went silent are dropped.
const getInactiveMemberSet = async (days = INACTIVITY_HIDE_DAYS) => {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await UserActivityEntry.aggregate([
    { $group: { _id: "$user_name", last: { $max: "$created_date" } } },
    { $match: { last: { $lt: cutoff } } },
  ]).allowDiskUse(true);
  return new Set(rows.map((r) => r._id));
};

// ---------------------------------------------------------------------------
// GET /api/activity/members — list of active GST members for the sidebar
// ---------------------------------------------------------------------------
export const getMembers = async (_req, res) => {
  try {
    maybeTriggerReadSync(); // fire-and-forget: refresh activity when someone opens the view
    const inactive = await getInactiveMemberSet();
    const members = [...GST_MEMBERS].filter((m) => !inactive.has(m)).sort();
    res.json({ members });
  } catch (err) {
    // Fail open: a broken inactivity query should never blank the sidebar.
    logger.error({ err: err.message }, "getMembers inactivity filter failed");
    res.json({ members: [...GST_MEMBERS].sort() });
  }
};

// ---------------------------------------------------------------------------
// GET /api/activity/daily?user=Rohan&date=2026-02-28
// Returns: external/internal counts, hourly breakdown, co-op, points for one day
// ---------------------------------------------------------------------------
export const getDailySummary = async (req, res) => {
  try {
    const { user, date } = req.query;
    if (!user || !date) {
      return badRequest(res, "user and date are required");
    }

    const daily = await UserActivityDaily.findOne(
      { user_name: user, date_bucket: date },
    ).lean();

    if (!daily) {
      return res.json({
        user_name: user,
        date_bucket: date,
        internal_count: 0,
        external_count: 0,
        total_points: 0,
        hourly: {},
        coop_count: 0,
        coop_tickets: [],
        point_breakdown: { key_ext: 0, non_key_ext: 0 },
      });
    }

    // Recompute coop_count from entries — external only, distinct tickets
    const coopTickets = await UserActivityEntry.distinct("ticket_display_id", {
      user_name: user,
      date_bucket: date,
      is_coop: true,
      visibility: { $ne: "internal" },
    });
    daily.coop_count = coopTickets.length;

    res.json(daily);
  } catch (err) {
    logger.error({ err: err.message }, "getDailySummary error");
    serverError(res, "Internal server error");
  }
};

// ---------------------------------------------------------------------------
// GET /api/activity/calendar?user=Rohan&start=2026-01-01&end=2026-03-31
// Returns: per-day summary for the calendar heatmap
// ---------------------------------------------------------------------------
export const getCalendar = async (req, res) => {
  try {
    const { user, start, end } = req.query;
    if (!user || !start || !end) {
      return badRequest(res, "user, start, and end are required");
    }

    const days = await UserActivityDaily.find(
      { user_name: user, date_bucket: { $gte: start, $lte: end } },
      { _id: 0, date_bucket: 1, internal_count: 1, external_count: 1, total_points: 1, coop_count: 1 },
    )
      .sort({ date_bucket: 1 })
      .lean();

    res.json({ user, days });
  } catch (err) {
    logger.error({ err: err.message }, "getCalendar error");
    serverError(res, "Internal server error");
  }
};

// ---------------------------------------------------------------------------
// GET /api/activity/drill-down?user=Rohan&date=2026-02-28&hour=14
//   OR  /api/activity/drill-down?user=Rohan&start=2026-02-14&end=2026-02-28
// Returns: ticket-level entries enriched with co-op owner name and dependency team
// ---------------------------------------------------------------------------
export const getDrillDown = async (req, res) => {
  try {
    const { user, date, start, end, hour } = req.query;
    if (!user || (!date && (!start || !end))) {
      return badRequest(res, "user and (date OR start+end) are required");
    }

    // Build date filter: single date or range
    const filter = { user_name: user };
    if (start && end) {
      filter.date_bucket = { $gte: start, $lte: end };
    } else {
      filter.date_bucket = date;
    }
    if (hour !== undefined) filter.hour_bucket = Number(hour);

    const entries = await UserActivityEntry.find(filter, {
      _id: 0,
      entry_id: 1,
      ticket_id: 1,
      ticket_display_id: 1,
      visibility: 1,
      created_date: 1,
      date_bucket: 1,
      hour_bucket: 1,
      is_coop: 1,
      points: 1,
      account_cohort: 1,
      ticket_stage: 1,
    })
      .sort({ created_date: 1 })
      .lean();

    // --- Enrich with co-op owner names and dependency (team) info ---
    const uniqueTicketIds = [...new Set(entries.map((e) => e.ticket_display_id).filter(Boolean))];

    // Batch-lookup from AnalyticsTicket for owner + is_noc
    const ticketDocs = uniqueTicketIds.length > 0
      ? await AnalyticsTicket.find(
          { ticket_id: { $in: uniqueTicketIds } },
          { ticket_id: 1, owner: 1, is_noc: 1, noc_issue_id: 1 },
        ).lean()
      : [];

    const ticketMap = {};
    for (const t of ticketDocs) {
      ticketMap[t.ticket_id] = t;
    }

    // Also check Redis active tickets for those not found in AnalyticsTicket
    const missingIds = uniqueTicketIds.filter((id) => !ticketMap[id]);
    if (missingIds.length > 0) {
      try {
        const active = await redisGet("tickets:active");
        if (active) {
          for (const t of active) {
            if (missingIds.includes(t.display_id)) {
              const rawName = t.owned_by?.[0]?.display_name;
              ticketMap[t.display_id] = {
                ticket_id: t.display_id,
                // Use GST short name if available, otherwise raw display name
                owner: rawName
                  ? (resolveOwnerName(rawName) || rawName)
                  : null,
                is_noc: false,
              };
            }
          }
        }
      } catch (_) { /* Redis unavailable — skip */ }
    }

    // For co-op entries where we still don't have the owner, try to infer from
    // other entries on the same ticket where is_coop=false (those belong to the owner)
    const coopTicketsMissingOwner = entries
      .filter((e) => e.is_coop && !ticketMap[e.ticket_display_id]?.owner)
      .map((e) => e.ticket_display_id)
      .filter(Boolean);

    if (coopTicketsMissingOwner.length > 0) {
      const uniqueMissing = [...new Set(coopTicketsMissingOwner)];
      const ownerEntries = await UserActivityEntry.find(
        { ticket_display_id: { $in: uniqueMissing }, is_coop: false },
        { ticket_display_id: 1, user_name: 1 },
      ).lean();

      for (const oe of ownerEntries) {
        if (!ticketMap[oe.ticket_display_id]) {
          ticketMap[oe.ticket_display_id] = {};
        }
        if (!ticketMap[oe.ticket_display_id].owner) {
          ticketMap[oe.ticket_display_id].owner = oe.user_name;
        }
      }
    }

    // Attach enrichment to each entry
    const enriched = entries.map((e) => {
      const ticket = ticketMap[e.ticket_display_id] || {};
      return {
        ...e,
        coop_with: e.is_coop ? (ticket.owner || null) : null,
        dep_team: ticket.is_noc ? "NOC" : null,
      };
    });

    res.json({ user, date: date || `${start} to ${end}`, entries: enriched });
  } catch (err) {
    logger.error({ err: err.message }, "getDrillDown error");
    serverError(res, "Internal server error");
  }
};

// ---------------------------------------------------------------------------
// GET /api/activity/leaderboard?start=2026-01-01&end=2026-03-31
// Returns: ranked list of users by total_points in the range
// ---------------------------------------------------------------------------
export const getLeaderboard = async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return badRequest(res, "start and end are required");
    }
    maybeTriggerReadSync(); // fire-and-forget: refresh activity when someone opens the view

    // Pre-aggregated daily rollups (fast)
    const dailyResult = await UserActivityDaily.aggregate([
      { $match: { date_bucket: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: "$user_name",
          total_points: { $sum: "$total_points" },
          internal_count: { $sum: "$internal_count" },
          external_count: { $sum: "$external_count" },
          coop_count: { $sum: "$coop_count" },
          days_active: { $sum: 1 },
        },
      },
      { $sort: { total_points: -1 } },
    ]).allowDiskUse(true);

    // Distinct ticket count per user from granular entries
    const ticketCounts = await UserActivityEntry.aggregate([
      { $match: { date_bucket: { $gte: start, $lte: end } } },
      { $group: { _id: { user: "$user_name", ticket: "$ticket_display_id" } } },
      { $group: { _id: "$_id.user", ticket_count: { $sum: 1 } } },
    ]).allowDiskUse(true);
    const ticketMap = {};
    for (const t of ticketCounts) {
      ticketMap[t._id] = t.ticket_count;
    }

    // Distinct external-only co-op ticket count per user from entries
    const coopCounts = await UserActivityEntry.aggregate([
      { $match: { date_bucket: { $gte: start, $lte: end }, is_coop: true, visibility: { $ne: "internal" } } },
      { $group: { _id: { user: "$user_name", ticket: "$ticket_display_id" } } },
      { $group: { _id: "$_id.user", coop_count: { $sum: 1 } } },
    ]).allowDiskUse(true);
    const coopMap = {};
    for (const c of coopCounts) {
      coopMap[c._id] = c.coop_count;
    }

    // Hide members who have left the org (no comment in the last
    // INACTIVITY_HIDE_DAYS days) — same rule as the members sidebar.
    const inactive = await getInactiveMemberSet();

    const result = dailyResult
      .filter((d) => !inactive.has(d._id))
      .map((d) => ({
        user_name: d._id,
        total_points: d.total_points,
        internal_count: d.internal_count,
        external_count: d.external_count,
        coop_count: coopMap[d._id] || 0,
        days_active: d.days_active,
        ticket_count: ticketMap[d._id] || 0,
      }));

    res.json({ leaderboard: result });
  } catch (err) {
    logger.error({ err: err.message }, "getLeaderboard error");
    serverError(res, "Internal server error");
  }
};

// ---------------------------------------------------------------------------
// GET /api/activity/dependency?start=2026-01-01&end=2026-03-31
// Returns: per-engineer co-op received (tickets where others helped on their tickets)
// ---------------------------------------------------------------------------
export const getDependencyTable = async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return badRequest(res, "start and end are required");
    }

    // Step 1: Get all external co-op entries with their ticket IDs
    const coopEntries = await UserActivityEntry.aggregate([
      {
        $match: {
          date_bucket: { $gte: start, $lte: end },
          is_coop: true,
          visibility: { $ne: "internal" },
        },
      },
      // Distinct (helper, ticket) pairs
      { $group: { _id: { helper: "$user_name", ticket: "$ticket_display_id" } } },
      // Lookup ticket owner from AnalyticsTicket
      {
        $lookup: {
          from: "analyticstickets",
          localField: "_id.ticket",
          foreignField: "ticket_id",
          as: "ticketInfo",
        },
      },
      { $unwind: { path: "$ticketInfo", preserveNullAndEmptyArrays: true } },
      // Group by ticket owner (the engineer who received help)
      {
        $group: {
          _id: "$ticketInfo.owner",
          coop_received: { $sum: 1 },
          unique_tickets: { $addToSet: "$_id.ticket" },
          helpers: { $addToSet: "$_id.helper" },
        },
      },
      {
        $project: {
          engineer: "$_id",
          coop_received: 1,
          ticket_count: { $size: "$unique_tickets" },
          helper_count: { $size: "$helpers" },
        },
      },
      { $match: { engineer: { $ne: null } } },
      { $sort: { coop_received: -1 } },
    ]).allowDiskUse(true);

    res.json({ dependency: coopEntries });
  } catch (err) {
    logger.error({ err: err.message }, "getDependencyTable error");
    serverError(res, "Internal server error");
  }
};

// ---------------------------------------------------------------------------
// GET /api/activity/summary?user=Rohan&start=2026-01-01&end=2026-03-31
// Returns: aggregated totals for the date range
// ---------------------------------------------------------------------------
export const getSummary = async (req, res) => {
  try {
    const { user, start, end } = req.query;
    if (!user || !start || !end) {
      return badRequest(res, "user, start, and end are required");
    }

    const [result] = await UserActivityDaily.aggregate([
      { $match: { user_name: user, date_bucket: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: null,
          total_internal: { $sum: "$internal_count" },
          total_external: { $sum: "$external_count" },
          total_points: { $sum: "$total_points" },
          key_ext_points: { $sum: "$point_breakdown.key_ext" },
          non_key_ext_points: { $sum: "$point_breakdown.non_key_ext" },
          days_active: { $sum: 1 },
        },
      },
    ]).allowDiskUse(true);

    // Get truly distinct co-op ticket count across the entire range (external only)
    const coopTickets = await UserActivityEntry.distinct("ticket_display_id", {
      user_name: user,
      date_bucket: { $gte: start, $lte: end },
      is_coop: true,
      visibility: { $ne: "internal" },
    });

    res.json({
      user,
      start,
      end,
      ...(result || {
        total_internal: 0,
        total_external: 0,
        total_points: 0,
        key_ext_points: 0,
        non_key_ext_points: 0,
        days_active: 0,
      }),
      total_coop: coopTickets.length,
    });
  } catch (err) {
    logger.error({ err: err.message }, "getSummary error");
    serverError(res, "Internal server error");
  }
};

// ---------------------------------------------------------------------------
// POST /api/admin/activity-rebuild-dailies — rebuild daily rollups from entries
// No external API calls — purely recalculates from existing UserActivityEntry docs
// ---------------------------------------------------------------------------
export const rebuildDailyRollups = async (_req, res) => {
  try {
    // 1. Aggregate entries grouped by user + date
    const groups = await UserActivityEntry.aggregate([
      {
        $group: {
          _id: { user: "$user_name", date: "$date_bucket" },
          internal_count: { $sum: { $cond: [{ $eq: ["$visibility", "internal"] }, 1, 0] } },
          external_count: { $sum: { $cond: [{ $ne: ["$visibility", "internal"] }, 1, 0] } },
          total_points: { $sum: "$points" },
          coop_tickets: {
            $addToSet: {
              $cond: [
                { $and: [
                  { $eq: ["$is_coop", true] },
                  { $ne: ["$visibility", "internal"] },
                  { $ne: ["$ticket_display_id", null] },
                ] },
                "$ticket_display_id",
                "$$REMOVE",
              ],
            },
          },
          entries: {
            $push: {
              hour: "$hour_bucket",
              vis: "$visibility",
              points: "$points",
              cohort: "$account_cohort",
              is_coop: "$is_coop",
            },
          },
        },
      },
    ]).allowDiskUse(true);

    logger.info({ groupCount: groups.length }, "Aggregated entry groups for daily rebuild");

    // 2. Build daily docs
    const dailyDocs = groups.map((g) => {
      const hourly = {};
      let keyExtPts = 0;
      let nonKeyExtPts = 0;

      for (const e of g.entries) {
        const h = String(e.hour);
        if (!hourly[h]) hourly[h] = { int: 0, ext: 0 };
        if (e.vis === "internal") {
          hourly[h].int += 1;
        } else {
          hourly[h].ext += 1;
        }
        if (e.points > 0) {
          const cohort = (e.cohort || "").toLowerCase();
          const isKey = cohort.includes("key") || cohort.includes("strategic");
          if (isKey) keyExtPts += e.points;
          else nonKeyExtPts += e.points;
        }
      }

      // Filter out $$REMOVE artifacts (empty strings) from coop_tickets
      const coopTickets = (g.coop_tickets || []).filter(Boolean);

      return {
        user_name: g._id.user,
        date_bucket: g._id.date,
        internal_count: g.internal_count,
        external_count: g.external_count,
        total_points: g.total_points,
        hourly,
        coop_tickets: coopTickets,
        coop_count: coopTickets.length,
        point_breakdown: { key_ext: keyExtPts, non_key_ext: nonKeyExtPts },
      };
    });

    // 3. Drop existing dailies and bulk insert fresh ones
    const { deletedCount } = await UserActivityDaily.deleteMany({});
    let insertedCount = 0;
    if (dailyDocs.length > 0) {
      const result = await UserActivityDaily.insertMany(dailyDocs, { ordered: false });
      insertedCount = result.length;
    }

    logger.info({ deletedCount, insertedCount }, "Daily rollups rebuilt from entries");
    res.json({ status: "completed", deletedCount, insertedCount });
  } catch (err) {
    logger.error({ err: err.message }, "rebuildDailyRollups error");
    serverError(res, "Failed to rebuild daily rollups");
  }
};

// ---------------------------------------------------------------------------
// POST /api/admin/activity-sync  — manual sync (admin only)
// body: { fullBackfill?: boolean, quarter?: string }
// ---------------------------------------------------------------------------
export const triggerActivitySync = async (req, res) => {
  const { fullBackfill = false, quarter = getCurrentQuarterKey() } = req.body || {};

  const queue = getActivitySyncQueue();
  if (queue) {
    try {
      const jobName = fullBackfill ? "backfill" : "incremental";
      const job = await queue.add(jobName, { fullBackfill, quarter }, {
        jobId: `manual-activity-${Date.now()}`,
      });
      return res.json({ status: "queued", jobId: job.id, fullBackfill });
    } catch (err) {
      logger.warn({ err }, "BullMQ unavailable for activity sync, running directly");
    }
  }

  // Fallback: run directly (blocking)
  try {
    const result = await syncActivityBatch({ fullBackfill, quarter });
    res.json({ status: "completed", ...result });
  } catch (err) {
    logger.error({ err: err.message }, "Manual activity sync failed");
    serverError(res, "Activity sync failed");
  }
};

// ---------------------------------------------------------------------------
// POST /api/admin/activity-resync  — clear synced tracker & full backfill
// body: { quarter?: string, clearDaily?: boolean }
// ---------------------------------------------------------------------------
export const resyncActivity = async (req, res) => {
  const { quarter = getCurrentQuarterKey(), clearDaily = false } = req.body || {};

  try {
    // 1. Clear the "already synced" tracker so all tickets are re-processed
    const { deletedCount: clearedSynced } = await ActivitySyncedTicket.deleteMany({});
    logger.info({ clearedSynced }, "Cleared ActivitySyncedTicket tracker");

    // 2. Optionally wipe existing daily rollups + entries for a clean slate
    if (clearDaily) {
      const { deletedCount: clearedEntries } = await UserActivityEntry.deleteMany({});
      const { deletedCount: clearedDaily } = await UserActivityDaily.deleteMany({});
      logger.info({ clearedEntries, clearedDaily }, "Cleared activity entries & daily rollups");
    }

    // 3. Queue a full backfill
    const queue = getActivitySyncQueue();
    if (queue) {
      try {
        const job = await queue.add("backfill", { fullBackfill: true, quarter }, {
          jobId: `resync-activity-${Date.now()}`,
        });
        return res.json({
          status: "queued",
          jobId: job.id,
          clearedSynced,
          clearDaily,
          quarter,
        });
      } catch (err) {
        logger.warn({ err }, "BullMQ unavailable, running resync directly");
      }
    }

    // Fallback: run directly
    const result = await syncActivityBatch({ fullBackfill: true, quarter });
    res.json({ status: "completed", clearedSynced, clearDaily, quarter, ...result });
  } catch (err) {
    logger.error({ err: err.message }, "Activity resync failed");
    serverError(res, "Activity resync failed");
  }
};

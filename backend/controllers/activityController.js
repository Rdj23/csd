import { UserActivityEntry, UserActivityDaily, AnalyticsTicket, ActivitySyncedTicket } from "../models/index.js";
import { syncActivityBatch } from "../services/activityService.js";
import { getActivitySyncQueue } from "../lib/queues.js";
import { redisGet } from "../config/database.js";
import { GST_MEMBERS, resolveOwnerName } from "../config/constants.js";
import logger from "../config/logger.js";

// ---------------------------------------------------------------------------
// GET /api/activity/members — list of all GST members for the sidebar
// ---------------------------------------------------------------------------
export const getMembers = (_req, res) => {
  res.json({ members: [...GST_MEMBERS].sort() });
};

// ---------------------------------------------------------------------------
// GET /api/activity/daily?user=Rohan&date=2026-02-28
// Returns: external/internal counts, hourly breakdown, co-op, points for one day
// ---------------------------------------------------------------------------
export const getDailySummary = async (req, res) => {
  try {
    const { user, date } = req.query;
    if (!user || !date) {
      return res.status(400).json({ error: "user and date are required" });
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

    res.json(daily);
  } catch (err) {
    logger.error({ err: err.message }, "getDailySummary error");
    res.status(500).json({ error: "Internal server error" });
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
      return res.status(400).json({ error: "user, start, and end are required" });
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
    res.status(500).json({ error: "Internal server error" });
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
      return res.status(400).json({ error: "user and (date OR start+end) are required" });
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
    res.status(500).json({ error: "Internal server error" });
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
      return res.status(400).json({ error: "start and end are required" });
    }

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
    ]);

    // Distinct ticket count per user from granular entries
    const ticketCounts = await UserActivityEntry.aggregate([
      { $match: { date_bucket: { $gte: start, $lte: end } } },
      { $group: { _id: { user: "$user_name", ticket: "$ticket_display_id" } } },
      { $group: { _id: "$_id.user", ticket_count: { $sum: 1 } } },
    ]);
    const ticketMap = {};
    for (const t of ticketCounts) {
      ticketMap[t._id] = t.ticket_count;
    }

    const result = dailyResult.map((d) => ({
      user_name: d._id,
      total_points: d.total_points,
      internal_count: d.internal_count,
      external_count: d.external_count,
      coop_count: d.coop_count,
      days_active: d.days_active,
      ticket_count: ticketMap[d._id] || 0,
    }));

    res.json({ leaderboard: result });
  } catch (err) {
    logger.error({ err: err.message }, "getLeaderboard error");
    res.status(500).json({ error: "Internal server error" });
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
      return res.status(400).json({ error: "user, start, and end are required" });
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
    ]);

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
    res.status(500).json({ error: "Internal server error" });
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
    ]);

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
    res.status(500).json({ error: "Failed to rebuild daily rollups" });
  }
};

// ---------------------------------------------------------------------------
// POST /api/admin/activity-sync  — manual sync (admin only)
// body: { fullBackfill?: boolean, quarter?: string }
// ---------------------------------------------------------------------------
export const triggerActivitySync = async (req, res) => {
  const { fullBackfill = false, quarter = "Q1_26" } = req.body || {};

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
    res.status(500).json({ error: "Activity sync failed" });
  }
};

// ---------------------------------------------------------------------------
// POST /api/admin/activity-resync  — clear synced tracker & full backfill
// body: { quarter?: string, clearDaily?: boolean }
// ---------------------------------------------------------------------------
export const resyncActivity = async (req, res) => {
  const { quarter = "Q1_26", clearDaily = false } = req.body || {};

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
    res.status(500).json({ error: "Activity resync failed" });
  }
};

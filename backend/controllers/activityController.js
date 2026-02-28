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

    const result = await UserActivityDaily.aggregate([
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
      {
        $project: {
          _id: 0,
          user_name: "$_id",
          total_points: 1,
          internal_count: 1,
          external_count: 1,
          coop_count: 1,
          days_active: 1,
        },
      },
    ]);

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

    // Get truly distinct co-op ticket count across the entire range
    const coopTickets = await UserActivityEntry.distinct("ticket_display_id", {
      user_name: user,
      date_bucket: { $gte: start, $lte: end },
      is_coop: true,
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
// GET /api/activity/search?user=Rohan&query=please+allow&start=2026-01-01&end=2026-03-31
// Returns: entries where text_body matches the query (case-insensitive regex)
// ---------------------------------------------------------------------------
export const searchActivity = async (req, res) => {
  try {
    const { user, query, start, end } = req.query;
    if (!user || !query || !start || !end) {
      return res.status(400).json({ error: "user, query, start, and end are required" });
    }

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const entries = await UserActivityEntry.find(
      {
        user_name: user,
        date_bucket: { $gte: start, $lte: end },
        text_body: { $regex: escapedQuery, $options: "i" },
      },
      {
        _id: 0,
        entry_id: 1,
        ticket_display_id: 1,
        user_name: 1,
        visibility: 1,
        created_date: 1,
        text_body: 1,
        points: 1,
        is_coop: 1,
      },
    )
      .sort({ created_date: -1 })
      .limit(100)
      .lean();

    res.json({ user, query, match_count: entries.length, entries });
  } catch (err) {
    logger.error({ err: err.message }, "searchActivity error");
    res.status(500).json({ error: "Internal server error" });
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

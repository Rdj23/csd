/**
 * activity/sync — The batch/backfill worker that walks solved tickets and their timelines.
 *
 * Extracted from the 653-line activityService.js; logic unchanged.
 * See activity/index.js for how a comment becomes points.
 */

import logger from "../../config/logger.js";
import { getCurrentQuarterKey, getQuarterDateRange, resolveOwnerName } from "../../config/constants.js";
import { redisGet, redisLock } from "../../lib/cache.js";
import { ActivitySyncedTicket, AnalyticsTicket, SyncMetadata, UserActivityEntry } from "../../models/index.js";
import { fetchTimelineEntries, fetchWorkItem } from "../devrevApi.js";
import { fetchAndCacheTickets } from "../sync/index.js";
import { ACTIVITY_START_DATE, BATCH_DELAY_MS, CONCURRENCY, REPOPULATE_COOLDOWN_KEY, REPOPULATE_COOLDOWN_S } from "./config.js";
import { upsertDailyRollup } from "./entries.js";
import { calculatePoints, getAccountCohort, getTicketOwner, resolveUserName, toISTBucket } from "./resolve.js";

// ---------------------------------------------------------------------------
// Batch sync for a single ticket — optimized with batch dedup + date filter
// ---------------------------------------------------------------------------

export const syncTicketActivity = async (ticketId, ticketDisplayId, ctx = {}) => {
  // Pre-load all existing entry IDs for this ticket to avoid N individual findOne queries
  const existingDocs = await UserActivityEntry.find(
    { ticket_display_id: ticketDisplayId },
    { entry_id: 1 },
  ).lean();
  const existingIds = new Set(existingDocs.map((d) => d.entry_id));

  // Resolve owner & accountCohort once per ticket (not per entry)
  // Uses the same DB → Redis → API fallback chain as before
  const owner = ctx.owner ?? (await getTicketOwner(ticketId, ticketDisplayId));
  const accountCohort = ctx.accountCohort ?? (await getAccountCohort(ticketId, ticketDisplayId));

  let cursor = null;
  let processed = 0;
  let skippedOld = 0;
  let skippedDup = 0;

  do {
    try {
      // Uses devrevApi.fetchTimelineEntries abstraction (DI principle).
      // All DevRev HTTP config (base URL, auth headers, timeout) lives in devrevApi.js.
      const result = await fetchTimelineEntries(ticketId, { cursor });
      const entries = result.entries;
      cursor = result.nextCursor;

      if (!entries.length) continue;

      // Prepare batch of new entries to insert
      const toInsert = [];
      // Track daily rollup updates (indexed to match toInsert for partial-failure handling)
      const dailyUpdates = [];

      for (const entry of entries) {
        if (entry.type !== "timeline_comment") continue;

        // Skip entries before activity start date
        const createdDate = new Date(entry.created_date);
        if (createdDate < ACTIVITY_START_DATE) {
          skippedOld++;
          continue;
        }

        // In-memory dedup (no DB query per entry)
        if (existingIds.has(entry.id)) {
          skippedDup++;
          continue;
        }

        const userName = resolveUserName(entry.created_by);
        if (!userName) continue;

        const isCoop = !!(owner && owner !== userName);
        const visibility = entry.visibility || "internal";
        const points = calculatePoints(visibility, accountCohort, isCoop, ctx.stage);
        const { dateBucket, hourBucket } = toISTBucket(createdDate);

        toInsert.push({
          entry_id: entry.id,
          ticket_id: ticketId,
          ticket_display_id: ticketDisplayId,
          user_id: entry.created_by?.id,
          user_name: userName,
          visibility,
          created_date: createdDate,
          date_bucket: dateBucket,
          hour_bucket: hourBucket,
          is_coop: isCoop,
          account_cohort: accountCohort,
          ticket_stage: ctx.stage || null,
          points,
        });

        dailyUpdates.push({
          userName, dateBucket, hourBucket, visibility, points, accountCohort, isCoop,
          ticketRef: ticketDisplayId || ticketId,
        });

        // Mark as seen so later pages don't re-process
        existingIds.add(entry.id);
      }

      // Bulk insert entries (skip duplicates via ordered:false)
      // Track which indices failed so we skip their rollup updates
      const failedIndices = new Set();
      if (toInsert.length > 0) {
        try {
          await UserActivityEntry.insertMany(toInsert, { ordered: false });
        } catch (err) {
          if (err.code === 11000 || err.writeErrors) {
            // Collect indices of duplicate entries so we don't double-count in rollups
            for (const we of (err.writeErrors || [])) {
              failedIndices.add(we.index);
            }
          } else {
            throw err;
          }
        }
        processed += toInsert.length - failedIndices.size;
      }

      // Apply daily rollup updates only for successfully inserted entries
      for (let j = 0; j < dailyUpdates.length; j++) {
        if (failedIndices.has(j)) continue;
        const u = dailyUpdates[j];
        await upsertDailyRollup(u.userName, u.dateBucket, u.hourBucket, u.visibility, u.points, u.accountCohort, u.isCoop, u.ticketRef);
      }
    } catch (err) {
      logger.error({ ticketId, err: err.message }, "Timeline fetch error");
      break;
    }
  } while (cursor);

  if (skippedOld > 0 || skippedDup > 0) {
    logger.debug({ ticketId: ticketDisplayId, skippedOld, skippedDup, processed }, "Ticket sync stats");
  }

  return processed;
};

// ---------------------------------------------------------------------------
// Batch sync: cron / backfill / manual
// ---------------------------------------------------------------------------

/**
 * @param {Object} opts
 * @param {string} opts.since       ISO date — only process tickets modified after this
 * @param {boolean} opts.fullBackfill  If true, process ALL tickets in the quarter
 * @param {string} opts.quarter     Quarter key, e.g. "Q1_26"
 */
export const syncActivityBatch = async (opts = {}) => {
  const { since, fullBackfill = false, quarter = getCurrentQuarterKey() } = opts;

  let tickets = [];

  if (fullBackfill) {
    // --- Backfill: solved tickets from Mongo + active from Redis ---
    const range = getQuarterDateRange(quarter);
    const solved = await AnalyticsTicket.find(
      { closed_date: { $gte: range.start, $lte: range.end } },
      { ticket_id: 1, devrev_id: 1, owner: 1, owner_id: 1, account_cohort: 1, stage_name: 1 },
    ).lean();

    // Load already-synced ticket IDs to skip them
    const syncedDocs = await ActivitySyncedTicket.find({}, { ticket_display_id: 1 }).lean();
    const syncedSet = new Set(syncedDocs.map((d) => d.ticket_display_id));

    // Use Set for O(1) dedup of solved display IDs
    const solvedDisplayIds = new Set();

    let skippedCount = 0;
    for (const t of solved) {
      if (syncedSet.has(t.ticket_id)) {
        skippedCount++;
        continue;
      }
      solvedDisplayIds.add(t.ticket_id);
      tickets.push({
        devrev_id: t.devrev_id,
        display_id: t.ticket_id,
        owner: t.owner,
        accountCohort: t.account_cohort,
        stage: t.stage_name || "solved",
        isSolved: true,
      });
    }
    if (skippedCount > 0) {
      logger.info({ skippedCount }, "Skipped already-synced solved tickets");
    }

    // Active tickets from Redis (always sync — they can get new comments)
    const active = await redisGet("tickets:active");
    if (active) {
      for (const t of active) {
        const owner = resolveOwnerName(t.owned_by?.[0]?.display_name);
        if (!owner) continue;
        // O(1) lookup instead of .some()
        if (solvedDisplayIds.has(t.display_id)) continue;
        tickets.push({
          devrev_id: t.id,
          display_id: t.display_id,
          owner,
          accountCohort: t.custom_fields?.tnt__account_cohort_fy_25,
          stage: t.stage?.name,
          isSolved: false,
        });
      }
    }
  } else {
    // --- Incremental: recently modified ACTIVE tickets (Redis) + recently CLOSED tickets (Mongo) ---
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const seen = new Set();

    // 1. Active tickets from Redis.
    //    WHY SELF-HEAL: tickets:active has a 5-min TTL and is only refreshed by
    //    webhook-driven ticket syncs. In quiet periods (nights/weekends) it can be
    //    EXPIRED when this job runs. Previously that meant we logged a warning and
    //    silently captured nothing — the cause of whole-day activity gaps. Now we
    //    repopulate the cache before giving up, so the sync no longer depends on
    //    another job having run recently.
    let active = await redisGet("tickets:active");
    if (!active) {
      // WHY THE COOLDOWN: this self-heal assumes a missing cache is a TTL
      // expiry that one sync will fix. If the sync is instead broken — as on
      // 2026-08-08, when a ReferenceError killed it after the crawl but before
      // the cache write — the cache stays missing, so this branch re-fires on
      // EVERY run and each attempt burns a full ~8k-ticket DevRev crawl. That
      // unbounded retry loop was the engine of the OOM.
      //
      // A no-unlock NX key (same pattern as the activityController read-sync
      // gate) caps repopulate attempts at one per REPOPULATE_COOLDOWN_S. A
      // genuine TTL expiry still heals on the next tick; a broken sync now
      // degrades to a logged gap instead of a runaway loop.
      const cooldownOk = await redisLock(REPOPULATE_COOLDOWN_KEY, REPOPULATE_COOLDOWN_S);
      if (!cooldownOk) {
        logger.warn("tickets:active missing but repopulate is on cooldown — skipping active tickets this run");
      } else {
        logger.warn("tickets:active missing — repopulating before activity sync");
        try {
          await fetchAndCacheTickets("activity-sync");
          active = await redisGet("tickets:active");
        } catch (e) {
          logger.error({ err: e.message }, "Failed to repopulate tickets:active for activity sync");
        }
      }
    }
    for (const t of (active || [])) {
      if (new Date(t.modified_date) < sinceDate) continue;
      const owner = resolveOwnerName(t.owned_by?.[0]?.display_name);
      if (!owner) continue;
      seen.add(t.display_id);
      tickets.push({
        devrev_id: t.id,
        display_id: t.display_id,
        owner,
        accountCohort: t.custom_fields?.tnt__account_cohort_fy_25,
        stage: t.stage?.name,
        isSolved: false,
      });
    }

    // 2. Durable Mongo safety-net: tickets CLOSED within the window (with a 1h buffer).
    //    The Redis-only path above can miss comments on tickets that were solved during
    //    a cache-cold gap — once a ticket is solved it leaves tickets:active entirely.
    //    AnalyticsTicket has no TTL, so this guarantees solved-ticket activity is picked
    //    up. Gated by ActivitySyncedTicket so each closed ticket is deep-synced once
    //    (bounds DevRev timeline fetches on the every-10-min frequent job).
    const closedSince = new Date(sinceDate.getTime() - 60 * 60 * 1000);
    const recentlyClosed = await AnalyticsTicket.find(
      { closed_date: { $gte: closedSince } },
      { ticket_id: 1, devrev_id: 1, owner: 1, account_cohort: 1, stage_name: 1 },
    ).lean();
    if (recentlyClosed.length) {
      const syncedDocs = await ActivitySyncedTicket.find(
        { ticket_display_id: { $in: recentlyClosed.map((t) => t.ticket_id) } },
        { ticket_display_id: 1 },
      ).lean();
      const syncedSet = new Set(syncedDocs.map((d) => d.ticket_display_id));
      for (const t of recentlyClosed) {
        if (seen.has(t.ticket_id) || syncedSet.has(t.ticket_id)) continue;
        seen.add(t.ticket_id);
        tickets.push({
          devrev_id: t.devrev_id,
          display_id: t.ticket_id,
          owner: t.owner,
          accountCohort: t.account_cohort,
          stage: t.stage_name || "solved",
          isSolved: true,
        });
      }
    }
  }

  logger.info({ ticketCount: tickets.length, fullBackfill }, "Activity sync batch starting");

  let totalProcessed = 0;
  let ticketsCompleted = 0;
  const solvedToMark = [];

  // --- Process tickets in concurrent batches ---
  for (let i = 0; i < tickets.length; i += CONCURRENCY) {
    const batch = tickets.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (t) => {
        // Resolve missing devrev_id via devrevApi abstraction
        if (!t.devrev_id && t.display_id) {
          try {
            const work = await fetchWorkItem(t.display_id);
            if (work?.id) {
              t.devrev_id = work.id;
              await AnalyticsTicket.updateOne(
                { ticket_id: t.display_id },
                { $set: { devrev_id: work.id } },
              );
            }
          } catch (err) {
            logger.warn({ display_id: t.display_id, err: err.message }, "Failed to resolve devrev_id");
          }
        }

        if (!t.devrev_id) {
          logger.warn({ display_id: t.display_id }, "Missing devrev_id, skipping");
          return 0;
        }

        const count = await syncTicketActivity(t.devrev_id, t.display_id, {
          owner: t.owner,
          accountCohort: t.accountCohort,
          stage: t.stage,
        });

        if (t.isSolved) {
          solvedToMark.push(t.display_id);
        }

        return count;
      }),
    );

    for (const r of results) {
      ticketsCompleted++;
      if (r.status === "fulfilled") {
        totalProcessed += r.value;
      } else {
        logger.error({ err: r.reason?.message }, "Ticket activity sync failed");
      }
    }

    // Progress log every batch
    if (totalProcessed > 0 || ticketsCompleted % 30 === 0) {
      logger.info(
        { progress: `${ticketsCompleted}/${tickets.length}`, totalProcessed },
        "Activity sync progress",
      );
    }

    // Rate-limit between batches (not between individual tickets)
    if (i + CONCURRENCY < tickets.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // Batch-mark solved tickets as synced
  if (solvedToMark.length > 0) {
    const bulkOps = solvedToMark.map((id) => ({
      updateOne: {
        filter: { ticket_display_id: id },
        update: { $setOnInsert: { ticket_display_id: id, synced_at: new Date() } },
        upsert: true,
      },
    }));
    await ActivitySyncedTicket.bulkWrite(bulkOps, { ordered: false });
    logger.info({ count: solvedToMark.length }, "Marked solved tickets as synced");
  }

  // Persist last sync timestamp
  await SyncMetadata.updateOne(
    { key: "activity_last_sync" },
    { $set: { value: new Date().toISOString(), updated_at: new Date() } },
    { upsert: true },
  );

  logger.info({ totalProcessed, tickets: tickets.length }, "Activity sync batch complete");
  return { totalProcessed, ticketsProcessed: tickets.length };
};

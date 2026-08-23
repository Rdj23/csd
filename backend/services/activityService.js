import { fetchWorkItem, fetchTimelineEntries } from "./devrevApi.js";
import { fetchAndCacheTickets } from "./syncService.js";
import { redisGet, redisHGet, redisLock } from "../config/database.js";
import { UserActivityEntry, UserActivityDaily, AnalyticsTicket, SyncMetadata, ActivitySyncedTicket } from "../models/index.js";
import {
  GST_NAME_MAP, GST_MEMBERS, GST_DEVU_MAP,
  resolveOwnerName, getQuarterDateRange, getCurrentQuarterKey,
} from "../config/constants.js";
import logger from "../config/logger.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Only ingest comments from this date onwards (IST)
const ACTIVITY_START_DATE = new Date("2025-12-31T18:30:00Z"); // Jan 1 2026 00:00 IST

// Concurrency: process N tickets in parallel
const CONCURRENCY = 3;

// Delay between each concurrent batch (ms) — keeps DevRev API happy
const BATCH_DELAY_MS = 500;

// Rate limit for the tickets:active self-heal below. Deliberately longer than
// the "frequent" job's 10-min cadence so at most every OTHER run can trigger a
// full ticket crawl — and shorter than that job's 15-min lookback window, so
// the one skipped run's comments are still picked up by the next one. No data
// loss, half the crawl rate, and a hard ceiling if the sync is broken.
const REPOPULATE_COOLDOWN_KEY = "cooldown:activity:repopulate-active";
const REPOPULATE_COOLDOWN_S = 900;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert UTC date → IST date bucket ("YYYY-MM-DD") and hour (0-23). */
const toISTBucket = (date) => {
  const d = new Date(date);
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const dateBucket = ist.toISOString().slice(0, 10);
  const hourBucket = ist.getUTCHours();
  return { dateBucket, hourBucket };
};

/** Resolve a DevRev created_by object → GST member name (or null). */
const resolveUserName = (createdBy) => {
  if (!createdBy || createdBy.type !== "dev_user") return null;

  // Try display_name through existing GST_NAME_MAP
  if (createdBy.display_name) {
    const resolved = GST_NAME_MAP[createdBy.display_name];
    if (resolved && GST_MEMBERS.has(resolved)) return resolved;
    // Direct check in case display_name is already the short name
    if (GST_MEMBERS.has(createdBy.display_name)) return createdBy.display_name;
  }

  // Try extracting DEVU-XXXX from the full DON id
  const m = createdBy.id?.match(/DEVU-\d+/i);
  if (m && GST_DEVU_MAP[m[0]]) return GST_DEVU_MAP[m[0]];

  return null;
};

/**
 * Look up the resolved owner name for a ticket.
 * Fallback chain: MongoDB (solved tickets) → Redis Hash (O(1) per-ticket) → DevRev API.
 *
 * WHY REDIS HASH INSTEAD OF FULL BLOB:
 * The old approach called redisGet("tickets:active") which parsed the entire ~20MB JSON
 * array into memory, then did a linear .find() scan. For batch syncs processing 500+
 * tickets, that's 500 × 20MB = 10GB of transient allocations. The Redis Hash stores each
 * ticket individually, so HGET retrieves and parses only the ~1KB ticket we need — O(1).
 */
const getTicketOwner = async (ticketId, ticketDisplayId) => {
  // 1. AnalyticsTicket (solved tickets — already in MongoDB)
  if (ticketDisplayId) {
    const doc = await AnalyticsTicket.findOne(
      { ticket_id: ticketDisplayId },
      { owner: 1 },
    ).lean();
    if (doc?.owner) return doc.owner;
  }

  // 2. Redis Hash — O(1) per-ticket lookup (populated by fetchAndCacheTickets)
  if (ticketDisplayId) {
    const cached = await redisHGet("tickets:active:hash", ticketDisplayId);
    if (cached?.owned_by?.[0]?.display_name) {
      return resolveOwnerName(cached.owned_by[0].display_name);
    }
  }

  // 3. DevRev API via devrevApi.js abstraction (DI principle — testable, single retry config)
  try {
    const work = await fetchWorkItem(ticketId);
    const ownerName = work?.owned_by?.[0]?.display_name;
    return ownerName ? resolveOwnerName(ownerName) : null;
  } catch (e) {
    logger.warn({ ticketId, err: e.message }, "Failed to fetch ticket owner");
    return null;
  }
};

/**
 * Get account cohort for a ticket.
 * Same fallback chain as getTicketOwner: MongoDB → Redis Hash → DevRev API.
 */
const getAccountCohort = async (ticketId, ticketDisplayId) => {
  // 1. AnalyticsTicket
  if (ticketDisplayId) {
    const doc = await AnalyticsTicket.findOne(
      { ticket_id: ticketDisplayId },
      { account_cohort: 1 },
    ).lean();
    if (doc?.account_cohort) return doc.account_cohort;
  }

  // 2. Redis Hash — O(1) per-ticket lookup
  if (ticketDisplayId) {
    const cached = await redisHGet("tickets:active:hash", ticketDisplayId);
    if (cached?.custom_fields?.tnt__account_cohort_fy_25) {
      return cached.custom_fields.tnt__account_cohort_fy_25;
    }
  }

  // 3. DevRev API via devrevApi.js abstraction
  try {
    const work = await fetchWorkItem(ticketId);
    return work?.custom_fields?.tnt__account_cohort_fy_25 || null;
  } catch {
    return null;
  }
};

/** Calculate points for a single comment.
 *  Points only for co-op (helping others) AND only when ticket is solved/closed.
 *  Interim comments on active tickets earn 0 — ownership can still change. */
const calculatePoints = (visibility, accountCohort, isCoop, stage) => {
  if (!isCoop) return 0;            // Own tickets = no points
  if (visibility === "internal") return 0;
  // Only award points when the ticket is solved/closed/resolved
  const s = (stage || "").toLowerCase();
  if (!s.includes("solved") && !s.includes("closed") && !s.includes("resolved")) return 0;
  // External / public co-op on a solved ticket
  const cohort = (accountCohort || "").toLowerCase();
  const isKey = cohort.includes("key") || cohort.includes("strategic");
  return isKey ? 2 : 4;
};

// ---------------------------------------------------------------------------
// Core: process a single timeline entry → granular doc + daily rollup
// (Used by webhook flow — single entry at a time)
// ---------------------------------------------------------------------------

/**
 * Process one timeline entry, dedup, score, and upsert into both collections.
 * @param {Object} entry  - Raw timeline entry from DevRev
 * @param {Object} ctx    - Pre-resolved ticket context { ticketId, ticketDisplayId, owner, accountCohort, stage }
 * @returns {Object|null} The created UserActivityEntry, or null if skipped/duplicate.
 */
export const processTimelineEntry = async (entry, ctx = {}) => {
  if (entry.type !== "timeline_comment") return null;

  const userName = resolveUserName(entry.created_by);
  if (!userName) return null; // Not a GST dev_user

  // Dedup by entry_id
  const existing = await UserActivityEntry.findOne({ entry_id: entry.id }, { _id: 1 }).lean();
  if (existing) return null;

  const ticketId = ctx.ticketId || entry.object;
  const ticketDisplayId = ctx.ticketDisplayId || entry.object_display_id;
  const owner = ctx.owner ?? (await getTicketOwner(ticketId, ticketDisplayId));
  const isCoop = !!(owner && owner !== userName);
  const accountCohort = ctx.accountCohort ?? (await getAccountCohort(ticketId, ticketDisplayId));
  const visibility = entry.visibility || "internal";
  const stage = ctx.stage || null;
  const points = calculatePoints(visibility, accountCohort, isCoop, stage);
  const createdDate = new Date(entry.created_date);
  const { dateBucket, hourBucket } = toISTBucket(createdDate);

  // --- Granular entry ---
  const doc = await UserActivityEntry.create({
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

  // --- Atomic daily rollup ---
  await upsertDailyRollup(userName, dateBucket, hourBucket, visibility, points, accountCohort, isCoop, ticketDisplayId || ticketId);

  return doc;
};

// ---------------------------------------------------------------------------
// Shared: atomic daily rollup upsert
// ---------------------------------------------------------------------------

const upsertDailyRollup = async (userName, dateBucket, hourBucket, visibility, points, accountCohort, isCoop, ticketRef) => {
  const isInt = visibility === "internal";
  const cohort = (accountCohort || "").toLowerCase();
  const isKey = cohort.includes("key") || cohort.includes("strategic");

  const updateOps = {
    $inc: {
      internal_count: isInt ? 1 : 0,
      external_count: isInt ? 0 : 1,
      total_points: points,
      [`hourly.${hourBucket}.int`]: isInt ? 1 : 0,
      [`hourly.${hourBucket}.ext`]: isInt ? 0 : 1,
      "point_breakdown.key_ext": (!isInt && isKey) ? points : 0,
      "point_breakdown.non_key_ext": (!isInt && !isKey) ? points : 0,
    },
    $setOnInsert: { user_name: userName, date_bucket: dateBucket },
  };

  // Only count external co-op entries for the co-op ticket list
  if (isCoop && !isInt) {
    updateOps.$addToSet = { coop_tickets: ticketRef };
  }

  await UserActivityDaily.findOneAndUpdate(
    { user_name: userName, date_bucket: dateBucket },
    updateOps,
    { upsert: true },
  );

  // Atomically set coop_count from the actual array length in a single operation.
  // Using a pipeline update ($set with $size) ensures no race condition between
  // reading the array length and writing coop_count — MongoDB evaluates the
  // expression on the current document state atomically.
  if (isCoop && !isInt) {
    await UserActivityDaily.updateOne(
      { user_name: userName, date_bucket: dateBucket },
      [{ $set: { coop_count: { $size: { $ifNull: ["$coop_tickets", []] } } } }],
      // Mongoose 9 requires opting in to aggregation-pipeline updates (array form).
      // Without this the call throws, breaking timeline pagination mid-ticket.
      { updatePipeline: true },
    );
  }
};

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

// ---------------------------------------------------------------------------
// Process a webhook timeline_entry_created event
// ---------------------------------------------------------------------------

export const processWebhookTimelineEntry = async (eventBody) => {
  // DevRev webhook payloads vary — try common paths
  const entry =
    eventBody.payload?.timeline_entry ||
    eventBody.timeline_entry ||
    eventBody.payload;

  if (!entry || entry.type !== "timeline_comment") {
    return null;
  }

  try {
    const result = await processTimelineEntry(entry);
    if (result) {
      logger.info(
        { entry_id: entry.id, user: result.user_name, visibility: result.visibility },
        "Webhook: activity entry processed",
      );
    }
    return result;
  } catch (err) {
    // Duplicate key (race condition) is fine — means already processed
    if (err.code === 11000) return null;
    throw err;
  }
};

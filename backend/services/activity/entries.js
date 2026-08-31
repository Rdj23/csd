/**
 * activity/entries — Recording one comment: the entry document and its daily rollup.
 *
 * Extracted from the 653-line activityService.js; logic unchanged.
 * See activity/index.js for how a comment becomes points.
 */

import { UserActivityDaily, UserActivityEntry } from "../../models/index.js";
import { calculatePoints, getAccountCohort, getTicketOwner, resolveUserName, toISTBucket } from "./resolve.js";

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

export const upsertDailyRollup = async (userName, dateBucket, hourBucket, visibility, points, accountCohort, isCoop, ticketRef) => {
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

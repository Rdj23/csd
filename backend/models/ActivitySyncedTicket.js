/**
 * ActivitySyncedTicket — Which solved tickets have been fully activity-synced.
 *
 * Split out of the former monolithic models/index.js. The schema below is
 * byte-for-byte the original; only the import and this header are new.
 * models/index.js re-exports it, so every existing import still resolves.
 */

import mongoose from "mongoose";

/**
 * WHY THIS EXISTS:
 * Solved tickets don't get new comments. Once we've synced ALL timeline entries
 * for a solved ticket, we never need to sync it again. This collection tracks
 * which tickets are "done" so the backfill cron job can skip them.
 *
 * WITHOUT THIS: Every backfill would re-process ALL solved tickets in the quarter
 * (potentially thousands), even though their comments haven't changed.
 * WITH THIS: Backfill only processes NEW solved tickets since the last run.
 *
 * This is a simple optimization that turns O(all_tickets) into O(new_tickets).
 */
const ActivitySyncedTicketSchema = new mongoose.Schema(
  {
    ticket_display_id: { type: String, unique: true, index: true },  // Which ticket was fully synced
    synced_at: { type: Date, default: Date.now },  // When the sync completed
  },
  { versionKey: false },
);
export const ActivitySyncedTicket = mongoose.model(
  "ActivitySyncedTicket",
  ActivitySyncedTicketSchema,
);

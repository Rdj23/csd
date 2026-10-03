/**
 * SyncMetadata — Sync cursors, timestamps and state.
 *
 * Split out of the former monolithic models/index.js. The schema below is
 * byte-for-byte the original; only the import and this header are new.
 * models/index.js re-exports it, so every existing import still resolves.
 */

import mongoose from "mongoose";

/**
 * WHY THIS EXISTS:
 * Different sync processes need to remember "where they left off":
 * - "activity_last_sync": when the last activity sync ran (ISO timestamp)
 * - Could also store DevRev API pagination cursors for interrupted syncs
 *
 * `value` is Mixed type (can be string, number, object, etc.) because
 * different metadata keys store different shapes of data.
 *
 * This is essentially a simple key-value store in MongoDB.
 */
const SyncMetadataSchema = new mongoose.Schema({
  key: { type: String, unique: true },    // Metadata key (e.g., "activity_last_sync")
  value: mongoose.Schema.Types.Mixed,      // The value (flexible type)
  updated_at: { type: Date, default: Date.now },
});
export const SyncMetadata = mongoose.model("SyncMetadata", SyncMetadataSchema);

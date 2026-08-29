/**
 * UserActivityDaily — Pre-aggregated daily activity rollup per member.
 *
 * Split out of the former monolithic models/index.js. The schema below is
 * byte-for-byte the original; only the import and this header are new.
 * models/index.js re-exports it, so every existing import still resolves.
 */

import mongoose from "mongoose";

/**
 * WHY THIS EXISTS:
 * The Activity dashboard shows "Rohan: 5 internal, 12 external comments on March 15".
 * Instead of counting UserActivityEntry docs on every page load (slow aggregation),
 * we maintain this pre-aggregated rollup that's updated atomically as each entry
 * is processed.
 *
 * THIS IS THE "READ MODEL" in CQRS pattern:
 * - UserActivityEntry = the "write model" (source of truth, one doc per comment)
 * - UserActivityDaily = the "read model" (optimized for dashboard queries)
 *
 * WHY BOTH EXIST (why not just one?):
 * - UserActivityEntry allows drill-down ("show me each individual comment")
 * - UserActivityDaily allows fast aggregation ("show me daily totals")
 * Querying raw entries for daily totals would require MongoDB to scan and count
 * hundreds of documents per user per day. The rollup is a single document read.
 *
 * HOW IT'S UPDATED (upsertDailyRollup in activityService.js):
 * Uses MongoDB $inc (atomic increment) — multiple concurrent webhook handlers
 * can safely update the same document without race conditions.
 * $addToSet for coop_tickets ensures no duplicate ticket IDs.
 */
const UserActivityDailySchema = new mongoose.Schema(
  {
    user_name: { type: String, index: true },     // GST member name
    date_bucket: { type: String, index: true },   // "YYYY-MM-DD" in IST
    internal_count: { type: Number, default: 0 }, // Number of internal (team-only) comments
    external_count: { type: Number, default: 0 }, // Number of external (customer-facing) comments
    total_points: { type: Number, default: 0 },   // Gamification points earned that day

    // hourly breakdown for the activity heatmap chart
    // Shape: { "9": { int: 1, ext: 3 }, "10": { int: 0, ext: 5 }, ... }
    // Key = hour (0-23 IST), Value = internal/external comment counts
    hourly: { type: Object, default: {} },

    // Distinct tickets where this user helped someone else (co-op)
    // Uses $addToSet in upserts to prevent duplicates
    coop_tickets: { type: [String], default: [] },
    coop_count: { type: Number, default: 0 },     // Length of coop_tickets (denormalized for fast queries)

    // Point breakdown by account type
    // WHY TRACKED: The gamification leaderboard shows points split by account tier
    point_breakdown: {
      key_ext: { type: Number, default: 0 },      // Points from key/strategic accounts
      non_key_ext: { type: Number, default: 0 },  // Points from non-key accounts
    },
  },
  { versionKey: false },
);

// UNIQUE compound index: one rollup document per user per day
// WHY UNIQUE: Prevents duplicate rollups if two concurrent syncs process the same user+day
UserActivityDailySchema.index({ user_name: 1, date_bucket: 1 }, { unique: true });
// Single-field index on date_bucket for "show all users' stats for today" queries
UserActivityDailySchema.index({ date_bucket: 1 });
// Index for leaderboard queries that sort by total_points
UserActivityDailySchema.index({ date_bucket: 1, total_points: -1 });

export const UserActivityDaily = mongoose.model(
  "UserActivityDaily",
  UserActivityDailySchema,
);

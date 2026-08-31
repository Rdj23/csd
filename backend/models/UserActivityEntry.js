/**
 * UserActivityEntry — One document per DevRev timeline comment.
 *
 * Split out of the former monolithic models/index.js. The schema below is
 * byte-for-byte the original; only the import and this header are new.
 * models/index.js re-exports it, so every existing import still resolves.
 */

import mongoose from "mongoose";

/**
 * WHY THIS EXISTS:
 * Tracks every individual comment/reply made by GST team members on DevRev tickets.
 * This powers the Activity tab drill-down ("what did Rohan comment on March 15th?")
 * and feeds into gamification point calculations.
 *
 * DATA FLOW:
 * 1. DevRev webhook fires → processWebhookTimelineEntry() creates one doc here
 * 2. Cron job (every 10 min) → syncActivityBatch() bulk-creates docs for any missed comments
 * 3. Daily backfill → catches anything the webhook + cron missed
 *
 * WHY BOTH entry_id AND ticket_display_id:
 * entry_id = unique DevRev timeline entry ID (for deduplication — "did we already process this?")
 * ticket_display_id = the ticket it belongs to (for drill-down — "show all comments on TKT-123")
 *
 * WHY date_bucket AND hour_bucket (not just created_date):
 * Pre-bucketing timestamps into "YYYY-MM-DD" and hour (0-23) at WRITE time means
 * the dashboard can group by day/hour WITHOUT MongoDB doing date math at query time.
 * This is a classic denormalization for read performance.
 *
 * IST vs UTC:
 * Buckets are in IST (+5:30) because the team works in India.
 * A comment at 2026-03-15T23:00:00Z (UTC) = 2026-03-16T04:30:00 IST
 * → date_bucket = "2026-03-16", hour_bucket = 4
 * Without IST conversion, this would show up on March 15th which is wrong for the team.
 */
const UserActivityEntrySchema = new mongoose.Schema(
  {
    entry_id: { type: String, unique: true, index: true },  // DevRev timeline entry ID — DEDUP KEY
    ticket_id: String,            // Full DevRev DON ID (for API calls)
    ticket_display_id: { type: String, index: true },  // Human-readable ticket ID (TKT-xxx)
    user_id: String,              // DevRev created_by.id (who wrote the comment)
    user_name: { type: String, index: true },  // Resolved GST member name
    visibility: { type: String, enum: ["internal", "external", "public"] },
    // WHY visibility matters:
    // "internal" = only team can see (no gamification points)
    // "external"/"public" = customer-facing (eligible for points)
    created_date: { type: Date, index: true },  // When the comment was written
    date_bucket: { type: String, index: true },  // "YYYY-MM-DD" in IST — for daily aggregation
    hour_bucket: Number,          // 0-23 in IST — for hourly activity heatmap
    is_coop: { type: Boolean, default: false },  // true if commenter ≠ ticket owner (helping someone else)
    account_cohort: String,       // Account tier — affects point value
    ticket_stage: String,         // Stage when comment was made — points only awarded on solved tickets
    points: { type: Number, default: 0 },  // Gamification points earned for this comment
  },
  { versionKey: false },
);

// COMPOUND INDEXES for common queries:
UserActivityEntrySchema.index({ user_name: 1, date_bucket: 1 });  // "Show me Rohan's comments on March 15"
UserActivityEntrySchema.index({ date_bucket: 1, visibility: 1 }); // "Show all external comments on March 15"

export const UserActivityEntry = mongoose.model(
  "UserActivityEntry",
  UserActivityEntrySchema,
);

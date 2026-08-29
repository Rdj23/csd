/**
 * Remark — Internal dashboard-only notes on tickets (30-day TTL).
 *
 * Split out of the former monolithic models/index.js. The schema below is
 * byte-for-byte the original; only the import and this header are new.
 * models/index.js re-exports it, so every existing import still resolves.
 */

import mongoose from "mongoose";

/**
 * WHY THIS EXISTS (separate from DevRev comments):
 * DevRev has its own comment system, but sometimes the team wants to leave
 * INTERNAL notes visible only on OUR dashboard — not synced back to DevRev.
 * Think of it as "sticky notes" on tickets that only your team sees.
 *
 * WHY index: true ON ticketId:
 * The dashboard queries remarks by ticketId ("show me all remarks for TKT-123").
 * Without this index, MongoDB would scan ALL remarks to find the ones for TKT-123.
 */
const RemarkSchema = new mongoose.Schema({
  ticketId: { type: String, index: true },  // Which ticket this remark belongs to
  user: String,                              // Who wrote it (email or display name)
  text: String,                              // The remark content
  timestamp: { type: Date, default: Date.now }, // When it was written (auto-set)
});
// Auto-delete remarks older than 30 days — MongoDB's TTL background thread handles this
RemarkSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
export const Remark = mongoose.model("Remark", RemarkSchema);

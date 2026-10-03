/**
 * PrecomputedDashboard — Higher-level dashboard aggregations (48h TTL).
 *
 * Split out of the former monolithic models/index.js. The schema below is
 * byte-for-byte the original; only the import and this header are new.
 * models/index.js re-exports it, so every existing import still resolves.
 */

import mongoose from "mongoose";

/**
 * WHY SEPARATE FROM AnalyticsCache:
 * AnalyticsCache stores quarter-level analytics (one doc per quarter).
 * PrecomputedDashboard stores cross-quarter or dashboard-level data
 * (e.g., "this week's stats", "overall health score").
 *
 * `computing` flag: Prevents two concurrent precompute jobs from stepping
 * on each other. Before starting, the job sets computing=true. If another
 * job sees computing=true, it skips. Think of it as a simple "lock".
 *
 * expireAfterSeconds: 172800 (48 hours):
 * Longer TTL than AnalyticsCache because dashboard-level data changes less
 * frequently and is more expensive to recompute.
 */
const PrecomputedDashboardSchema = new mongoose.Schema({
  cache_type: { type: String, unique: true, index: true },  // e.g., "weekly_stats", "health_score"
  computed_at: { type: Date, default: Date.now },
  data: Object,              // The precomputed result (shape varies by cache_type)
  computing: { type: Boolean, default: false },  // Lock flag to prevent concurrent computation
});
PrecomputedDashboardSchema.index({ computed_at: 1 }, { expireAfterSeconds: 172800 });
export const PrecomputedDashboard = mongoose.model("PrecomputedDashboard", PrecomputedDashboardSchema);

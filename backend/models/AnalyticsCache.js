/**
 * AnalyticsCache — Precomputed dashboard statistics (24h TTL).
 *
 * Split out of the former monolithic models/index.js. The schema below is
 * byte-for-byte the original; only the import and this header are new.
 * models/index.js re-exports it, so every existing import still resolves.
 */

import mongoose from "mongoose";

/**
 * WHY THIS EXISTS:
 * Computing stats (avg RWT, CSAT distribution, leaderboard rankings) from raw
 * AnalyticsTicket data takes 2-5 seconds with aggregation pipelines.
 * We precompute these once (via cron job) and cache the RESULT here.
 * Dashboard reads just fetch one document instead of aggregating thousands.
 *
 * cache_key example: "Q1_26" (quarter identifier)
 * Each quarter has one cached stats document.
 *
 * expireAfterSeconds: 86400 (24 hours):
 * MongoDB TTL index — MongoDB automatically DELETES documents older than 24h.
 * This ensures stale cache is cleaned up even if the cron job that refreshes
 * it fails. The next dashboard load will trigger a fresh computation.
 */
const AnalyticsCacheSchema = new mongoose.Schema({
  cache_key: { type: String, unique: true, index: true },  // e.g., "Q1_26"
  computed_at: { type: Date, default: Date.now },           // When these stats were calculated
  stats: Object,             // Overall metrics: { totalTickets, avgRWT, avgFRT, csatScore, ... }
  trends: Array,             // Weekly/monthly trend data for charts
  leaderboard: Array,        // Ranked list of agents by ticket count/quality
  badTickets: Array,         // Tickets that breached SLA or got bad CSAT
  individualTrends: Object,  // Per-agent trend lines
});
AnalyticsCacheSchema.index({ computed_at: 1 }, { expireAfterSeconds: 86400 });
export const AnalyticsCache = mongoose.model("AnalyticsCache", AnalyticsCacheSchema);

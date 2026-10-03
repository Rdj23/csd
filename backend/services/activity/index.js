/**
 * Activity Intel — turning DevRev comments into per-person daily activity.
 *
 * WHAT THIS POWERS: the Activity tab and the co-op points that feed
 * gamification. Every comment a GST member leaves on a ticket becomes one
 * UserActivityEntry, and those roll up into one UserActivityDaily row per
 * person per IST day.
 *
 * THE PIPELINE:
 *   a timeline entry
 *     -> WHO wrote it, WHICH account it belongs to, HOW MANY points   (resolve)
 *     -> one entry document + its daily rollup                        (entries)
 *   reached either by the batch worker walking solved tickets         (sync)
 *   or by a webhook delivering a single entry live                    (webhook)
 *
 * ── WHERE THE CODE LIVES ────────────────────────────────────────────────
 * In dependency order; each module may only import from those above it.
 *
 *   config.js   the ingest window (Jan 1 2026 IST), concurrency, cooldowns
 *   resolve.js  the interpretation layer — IST bucketing, name resolution,
 *               ticket owner, account cohort, and the POINTS FORMULA
 *   entries.js  writing one entry and updating its daily rollup
 *   sync.js     the batch/backfill worker (the cron body)
 *   webhook.js  the live single-entry path
 *
 * Wrong POINTS is resolve.js. Wrong TOTALS on correct entries is entries.js.
 * A whole day MISSING is sync.js — see docs and the fullBackfill resync, since
 * there is no automatic backfill when the worker is down.
 */

// ── Public surface ───────────────────────────────────────────────────────
// Exactly the 4 symbols services/activityService.js used to export.

export { processTimelineEntry } from "./entries.js";
export { syncTicketActivity, syncActivityBatch } from "./sync.js";
export { processWebhookTimelineEntry } from "./webhook.js";

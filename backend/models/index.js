/**
 * models/index.js — ALL Mongoose schemas and models for the application.
 *
 * WHY EVERYTHING IN ONE FILE:
 * This project has ~9 collections. Keeping them in one file makes it easy
 * to see the full data model at a glance and avoids circular import issues
 * (e.g., activityService needs both UserActivityEntry AND AnalyticsTicket).
 * For larger projects (20+ models), you'd split into separate files.
 *
 * KEY CONCEPT — MONGOOSE SCHEMA vs MODEL:
 * Schema = the "blueprint" (what fields exist, their types, constraints)
 * Model  = the "class" you use to read/write documents (Ticket.find(), Ticket.create())
 * Schema is like a form template. Model is the filled-out form you submit.
 *
 * KEY CONCEPT — INDEXES:
 * Indexes are like a book's table of contents. Without indexes, MongoDB scans
 * EVERY document to find what you need (full collection scan). With indexes,
 * it jumps directly to matching documents. The tradeoff: indexes speed up
 * reads but slow down writes (MongoDB must update the index on every insert/update).
 */

import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════
// 1. REMARKS — Internal notes/comments that team members leave on tickets
// ═══════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════
// 2. VIEWS — Saved filter presets per user
// ═══════════════════════════════════════════════════════════════════════
/**
 * WHY THIS EXISTS:
 * Users frequently look at the same subset of tickets (e.g., "My team, APAC region,
 * high priority"). Instead of re-selecting filters every time, they save a "view".
 *
 * `filters` is type Object (not a strict schema) because the filter shape can evolve
 * (new filter types added on frontend) without requiring a DB migration.
 */
const ViewSchema = new mongoose.Schema({
  userId: { type: String, index: true },    // Who created this view
  name: String,                              // Display name ("My APAC High-Pri")
  filters: Object,                           // The saved filter state (teams, regions, owners, etc.)
  createdAt: { type: Date, default: Date.now },
});
export const View = mongoose.model("View", ViewSchema);

// ═══════════════════════════════════════════════════════════════════════
// 3. ANALYTICS TICKET — The main ticket collection for analytics/reporting
// ═══════════════════════════════════════════════════════════════════════
/**
 * WHY THIS EXISTS (separate from the Redis ticket cache):
 * Redis holds ACTIVE tickets (open/pending) for the live dashboard — fast, volatile.
 * This collection stores SOLVED/CLOSED tickets permanently for analytics:
 * trends, leaderboards, CSAT analysis, NOC reports, etc.
 *
 * DATA FLOW INTO THIS COLLECTION:
 * syncHistoricalToDB() in syncService.js paginates through ALL DevRev tickets,
 * filters for solved/closed ones, and upserts them here using bulkWrite().
 *
 * WHY UPSERT (not insert):
 * A ticket might be synced multiple times (daily cron). Upsert means:
 * "if ticket_id exists → update it, if not → create it".
 * This handles ownership changes, CSAT updates, stage transitions, etc.
 * without creating duplicates.
 */
const AnalyticsTicketSchema = new mongoose.Schema(
  {
    // ── Identity fields ──
    ticket_id: { type: String, unique: true, index: true },  // Display ID like "TKT-1234" — unique key for upserts
    devrev_id: String,        // Full DevRev DON ID (e.g., "don:core:dvrv-us-1:devo/1iVu4ClfVV:ticket/123")
                              // Needed for API calls like timeline-entries.list that require the full DON ID
    display_id: String,       // Same as ticket_id — kept for backwards compatibility with older queries
    title: String,            // Ticket title/subject

    // ── Date fields ──
    created_date: Date,       // When the ticket was created in DevRev
    closed_date: { type: Date, index: true },  // When it was solved/closed — KEY for analytics date range queries
    // WHY closed_date is indexed: Almost every analytics query filters by date range
    // ("show me tickets closed this quarter"). Without this index, every query would be a full scan.

    // ── Ownership & classification ──
    owner: { type: String, index: true },      // Resolved GST member name (e.g., "Rohan Jadhav")
    // WHY owner is indexed: Leaderboard queries group by owner. Index avoids full scan.
    owner_id: String,         // DevRev dev_user ID — used by activity service for co-op detection
                              // (is the commenter the same person as the ticket owner?)
    account_cohort: String,   // Account tier from DevRev custom field: "Key", "Strategic", "Growth", etc.
                              // Used for gamification scoring: key accounts = 2 pts, non-key = 4 pts
    team: String,             // Which support team handles this ticket
    region: String,           // Geographic region (APAC, EMEA, Americas) from DevRev custom field
    priority: String,         // DevRev ticket severity: low / medium / high / blocker

    // ── Migration tracking ──
    is_zendesk: { type: Boolean, index: true },  // Was this ticket imported from Zendesk?
    // WHY tracked: CleverTap migrated from Zendesk to DevRev. Zendesk-imported tickets
    // have different data quality (missing fields, different formats). Analytics can
    // filter them out for cleaner metrics.

    // ── Performance metrics ──
    rwt: Number,              // Resolution Wait Time (business hours) — how long to resolve
    frt: Number,              // First Response Time (hours) — how fast the first reply was
    iterations: Number,       // Back-and-forth count between agent and customer
    csat: { type: Number, default: 0 },  // Customer Satisfaction: 0=not rated, 1=bad (DSAT), 2=good
    frr: { type: Number, default: 0 },   // First Reply Resolution: 1 if solved in single reply, else 0

    account_name: { type: String, index: true },  // Customer/company name

    // ── NOC (Network Operations Center) fields ──
    // WHY SO MANY NOC FIELDS:
    // NOC incidents are high-severity outages that need special tracking.
    // They link tickets to Jira issues, track who reported/confirmed them,
    // and feed into a separate NOC Analytics dashboard section.
    is_noc: { type: Boolean, default: false, index: true },  // Is this ticket linked to a NOC incident?
    noc_issue_id: { type: String, default: null },    // Linked DevRev issue ID (ISS-xxx)
    noc_jira_key: { type: String, default: null },    // Linked Jira ticket key
    noc_rca: { type: String, default: null },          // Root Cause Analysis category
    noc_reported_by: { type: String, default: null },  // Who reported the NOC issue
    noc_assignee: { type: String, default: null },     // Who's assigned to fix it
    noc_confirmation_by: { type: String, default: null }, // Who confirmed it was a real incident
    has_l2_noc_confirmation: { type: Boolean, default: false }, // Did L2 team confirm?
    noc_confirmation_iss_id: { type: String, default: null },  // The confirmation issue ID
    slack_alerted_at: { type: Date, default: null },   // When Slack alert was sent (prevents re-alerting)

    // ── Dependency (linked work) fields ──
    // Persisted at sync time from the same links.list/works.get walk that
    // resolves NOC, so historical tickets keep their dependency info after they
    // age out of the Redis active cache (the live map only covers cached
    // tickets). null has_dependency = "never checked" (pre-backfill rows) —
    // distinct from false ("checked, no links"), so filters/exports can say
    // "Not checked" instead of a false "No".
    has_dependency: { type: Boolean, default: null },
    dependency_issue_ids: { type: [String], default: undefined },  // e.g. ["ISS-133748"]
    dependency_teams: { type: [String], default: undefined },      // classifyLinkedWorkTeam labels, deduped
    dependency_assignees: { type: [String], default: undefined },  // linked-item owners, deduped

    // ── Stage tracking ──
    stage_name: { type: String, index: true },  // Current stage: "solved", "closed", "resolved", etc.
    actual_close_date: Date,  // DevRev's actual_close_date (may differ from closed_date/modified_date)

    // ── Agent (AI) handling ──
    // Captured for tickets closed on/after 2026-03-01 (agent rollout).
    // resolved_by is the canonical classification used by the dashboard-wide
    // "Resolved By" filter — computed at sync time so reads stay simple.
    agent_resolved: { type: Boolean, default: false, index: true },
    agent_response_count: { type: Number, default: 0 },
    agent_resolution_hours: { type: Number, default: null },
    resolved_by: { type: String, enum: ["engineer", "agent"], default: "engineer", index: true },

    // ── Parts View (DevRev part hierarchy) ──
    // WHY THESE LIVE HERE (not a separate tickets collection):
    // analyticstickets already holds every field the Parts View renders. Rather than
    // duplicate ticket data into a parallel collection that could drift, we enrich each
    // ticket in place with its resolved part chain. Tagged by partsService (the daily
    // parts-sync cron); null/empty until a ticket is first resolved.
    //
    // applies_to_part_id — the ONE part the ticket is filed under (any level, often a
    //   deep feature). This is the group-by key for per-part ticket counts.
    // product_id / product_name — the ROOT product after walking the is_part_of chain up.
    // ancestry — ordered DON ids root→leaf (product → … → applies_to_part). Lets the tree
    //   roll a leaf's count up into every ancestor without re-walking links at query time.
    applies_to_part_id: { type: String, default: null, index: true },
    product_id: { type: String, default: null, index: true },
    product_name: { type: String, default: null },
    ancestry: { type: [String], default: [] },
    // subtype — DevRev work subtype used to classify a ticket as a query / bug /
    //   feature. Powers the Parts View classification filter. Stored raw (e.g. "query");
    //   the parts read-path matches it case-insensitively so value variants still group.
    //   null until a sync (or backfillSubtype.js) tags the ticket.
    subtype: { type: String, default: null, index: true },
  },
  {
    versionKey: false,  // Disables __v field. We don't need Mongoose's optimistic locking
                        // because our upserts use $set (last write wins, which is correct for syncs)
  },
);

// ── COMPOUND INDEXES (queries that filter on MULTIPLE fields at once) ──
/**
 * WHY COMPOUND INDEXES:
 * A single-field index on `closed_date` helps "find tickets closed this quarter".
 * But if you then need to GROUP BY owner, MongoDB still scans all matching docs.
 * A compound index { closed_date, owner } lets MongoDB answer BOTH the filter
 * AND the grouping directly from the index — much faster.
 *
 * RULE OF THUMB for compound index order:
 * Put the EQUALITY filter first (is_noc = true), then the RANGE filter (closed_date > X).
 * But here closed_date is the primary range filter for almost all queries,
 * so it comes first to maximize reuse across different query patterns.
 */
AnalyticsTicketSchema.index({ closed_date: 1, owner: 1 });       // Leaderboard: group by owner within date range
AnalyticsTicketSchema.index({ closed_date: 1, is_noc: 1 });      // NOC analytics: filter NOC tickets in date range
AnalyticsTicketSchema.index({ closed_date: 1, is_zendesk: 1 });  // Exclude Zendesk imports from analytics
AnalyticsTicketSchema.index({ owner: 1, closed_date: 1, region: 1 }); // Individual performance drilldown
AnalyticsTicketSchema.index({ closed_date: -1, owner: 1, region: 1 }); // Dashboard filters: date-range + owner/region (desc for newest-first sorts)

/**
 * HOT/WARM/COLD DATA STRATEGY INDEXES:
 *
 * This is an optimization for the Tickets tab (not analytics):
 * - HOT  = active tickets (stage: "open", "pending", etc.) — shown first
 * - WARM = recently solved (last 30 days) — accessible but less urgent
 * - COLD = old solved tickets — only accessed via analytics
 *
 * { stage_name: 1, actual_close_date: -1 }
 *   → "Give me all 'solved' tickets, newest first" — stage filters, then sorts by close date
 *
 * { actual_close_date: -1 }
 *   → "Give me the most recently closed tickets" — pure date-based pagination
 *
 * { created_date: -1, stage_name: 1 }
 *   → "Give me newest tickets, and I'll filter by stage" — creation-date pagination
 *
 * WHY -1 (descending):
 * Users almost always want to see the NEWEST data first. Descending index
 * means MongoDB reads the index forward for "newest first" queries.
 */
AnalyticsTicketSchema.index({ stage_name: 1, actual_close_date: -1 });
AnalyticsTicketSchema.index({ actual_close_date: -1 });
AnalyticsTicketSchema.index({ created_date: -1, stage_name: 1 });

/**
 * "MY VIEWS" INDEXES — cover the dynamic filter + sort combos users create.
 *
 * Views typically filter by (owner, stage_name) or (owner, region) then sort
 * by closed_date or created_date. Without these indexes, MongoDB falls back
 * to an in-memory sort which blocks concurrent queries under high load.
 *
 * { owner: 1, stage_name: 1, closed_date: -1 }
 *   → "Rohan's solved tickets, newest first" — the most common saved view
 *
 * { owner: 1, stage_name: 1, created_date: -1 }
 *   → Same filter, sorted by creation date (age analysis)
 *
 * { closed_date: -1, _id: -1 }
 *   → Cursor-based pagination tiebreaker — the compound sort key used by
 *     getTicketsByRange/getTicketsByDate to avoid O(N) .skip() scans
 */
AnalyticsTicketSchema.index({ owner: 1, stage_name: 1, closed_date: -1 });
AnalyticsTicketSchema.index({ owner: 1, stage_name: 1, created_date: -1 });
AnalyticsTicketSchema.index({ closed_date: -1, _id: -1 });

// Compound index for the "Resolved By" dashboard-wide filter.
// Most analytics queries already filter by closed_date range; adding resolved_by
// to that index lets MongoDB satisfy "engineer-only" or "agent-only" slices
// without an extra in-memory filter pass.
AnalyticsTicketSchema.index({ closed_date: 1, resolved_by: 1 });

// ── PARTS VIEW INDEXES ──
// The parts-tree endpoint groups tickets by applies_to_part_id within a date range,
// then rolls counts up the chain. product_id + ancestry power the per-product subtree
// drilldown (/api/parts/:id/tickets). ancestry is a MULTIKEY index (array field) so
// "every ticket whose chain contains <part DON>" is index-backed, not a collection scan.
AnalyticsTicketSchema.index({ applies_to_part_id: 1, closed_date: -1 });
AnalyticsTicketSchema.index({ product_id: 1, closed_date: -1 });
AnalyticsTicketSchema.index({ ancestry: 1, closed_date: -1 });

export const AnalyticsTicket = mongoose.model(
  "AnalyticsTicket",
  AnalyticsTicketSchema,
);

// ═══════════════════════════════════════════════════════════════════════
// 11. PART — DevRev part hierarchy (Product > Capability > Feature > sub-Feature)
// ═══════════════════════════════════════════════════════════════════════
/**
 * WHY THIS EXISTS:
 * Tickets point to ONE part via applies_to_part (any level). To render DevRev's part
 * tree and roll ticket counts up to the product, we need the hierarchy itself. The
 * public parts.get API does NOT return parent info — only links.list does — so walking
 * the chain is expensive. We resolve each part's ancestry ONCE via links.list and cache
 * it here. The hierarchy rarely changes, so subsequent syncs are almost all cache hits.
 *
 * _id IS the DevRev DON id (e.g. "don:core:dvrv-us-1:devo/1iVu4ClfVV:product/5").
 * Using the DON as the primary key makes upserts naturally idempotent and lets the
 * resolver check "is this part already cached?" with a single findById.
 *
 * ancestry includes SELF as the last element (root product → … → this part), so a
 * feature's ancestry = [product, capability, feature]. A product's ancestry = [product].
 */
const PartSchema = new mongoose.Schema(
  {
    _id: { type: String },              // DevRev DON id — the natural unique key
    display_id: { type: String, index: true }, // PROD-5 / CAPL-30 / FEAT-269
    type: { type: String, index: true },       // "product" | "capability" | "feature"
    name: { type: String },
    parent_id: { type: String, default: null, index: true }, // immediate is_part_of target DON (null for product)
    product_id: { type: String, default: null, index: true }, // root product DON
    product_name: { type: String, default: null },
    ancestry: { type: [String], default: [] },  // ordered DON ids root→leaf, INCLUDING self
    updated_at: { type: Date, default: Date.now },
  },
  // Declaring the `_id` path as String (above) is enough for Mongoose to use the DON
  // as the key — do NOT add `{ _id: false }`, which would instead strip _id entirely.
  { versionKey: false },
);
export const Part = mongoose.model("Part", PartSchema);

// ═══════════════════════════════════════════════════════════════════════
// 4. ANALYTICS CACHE — Precomputed dashboard statistics
// ═══════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════
// 5. PRECOMPUTED DASHBOARD — Higher-level dashboard aggregations
// ═══════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════
// 6. SYNC METADATA — Tracks cursors, timestamps, and sync state
// ═══════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════
// 7. API KEYS — Service-to-service authentication
// ═══════════════════════════════════════════════════════════════════════
/**
 * WHY THIS EXISTS:
 * External services (Slack bots, internal tools) need to call our API
 * without a human logging in via Google OAuth. API keys allow machine-to-machine auth.
 *
 * SECURITY DESIGN:
 * - We NEVER store the raw API key. Only the HMAC-SHA256 hash (key_hash).
 *   If the database is leaked, attackers can't use the hashes to authenticate.
 * - `prefix` stores the first 12 characters for identification in the admin UI
 *   ("which key is this?") without revealing the full key.
 * - `scopes` control what the key can access (read:analytics, read:gamification, etc.)
 *   This follows the principle of least privilege.
 *
 * timestamps: true → Mongoose auto-adds createdAt and updatedAt fields.
 */
const ApiKeySchema = new mongoose.Schema(
  {
    key_hash: { type: String, unique: true, index: true },  // HMAC-SHA256 hash of the actual key
    prefix: { type: String, index: true },     // First 12 chars for visual identification
    project_name: { type: String, required: true },  // What service this key is for
    created_by: { type: String, required: true },    // Admin email who generated it
    scopes: { type: [String], default: ["read:all"] },  // Access permissions
    is_active: { type: Boolean, default: true, index: true },  // Can be deactivated without deleting
    last_used_at: { type: Date, default: null },   // Tracks usage for auditing
    expires_at: { type: Date, default: null },     // Optional expiration date
  },
  { timestamps: true, versionKey: false },
);

export const ApiKey = mongoose.model("ApiKey", ApiKeySchema);

// ═══════════════════════════════════════════════════════════════════════
// 8. USER ACTIVITY ENTRY — Granular: ONE document per comment
// ═══════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════
// 9. ACTIVITY SYNCED TICKET — Tracks which solved tickets have been fully synced
// ═══════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════
// 10. USER ACTIVITY DAILY — Pre-aggregated daily rollup
// ═══════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════
// 11. ATTENTION QUEUE — shift-end backlog queue per member
// ═══════════════════════════════════════════════════════════════════════
/**
 * WHY THIS EXISTS:
 * One document per member per shift-date, created ~30 min before their shift
 * ends by the attention sweep (attentionService.js). Holds the snapshot of
 * tickets that matched the attention rules at build time, plus the clearing/
 * escalation state machine. Ticket STATUS always comes from Redis/DevRev —
 * this collection only persists the queue itself (it must survive restarts
 * and next-day escalation checks).
 *
 * LIFECYCLE:
 *   pending → (member actions tickets, Verify & Clear re-checks DevRev)
 *           → cleared                       … Slack congrats
 *   pending → next shift start −45 min      … Slack escalation to TL, hourly
 *   empty   → nothing matched at build time … Slack "superstar" message
 */
const AttentionItemSchema = new mongoose.Schema(
  {
    display_id: String,           // TKT-xxx
    ticket_id: String,            // full DevRev DON id — needed by RemarkPopover's DevRev comment sync
    title: String,
    account: String,
    severity: String,
    bucket: { type: String, enum: ["open", "pending", "onHold"] },
    rule: String,                 // which attention rule matched (open-aging, …)
    reason: String,               // human-readable, shown in Slack + dashboard
    created_date: Date,
    last_agent_external_ts: Date, // snapshot at build time (fresh values come live)
    last_customer_ts: Date,
    iss_id: String,               // on-hold rule: the linked ISS that anchored the age check
    iss_created_date: Date,
    // "partial" = internal remark added after queue build — being tracked by
    // the member, so it stops alerting (Slack/escalation) but stays visible
    // in the dashboard for managers. Cleared only by real DevRev action.
    status: { type: String, enum: ["pending", "partial", "cleared"], default: "pending" },
    cleared_at: Date,
    partial_at: Date,             // when the tracking remark was first detected
    block_reason: String,         // why the last verify attempt kept it pending
  },
  { _id: false, versionKey: false },
);

const AttentionQueueSchema = new mongoose.Schema(
  {
    member: { type: String, index: true },       // canonical GST name
    member_email: String,
    slack_id: String,                            // "<@Uxxxx>" mention, from roster API
    shift: String,                               // "SHIFT 2"
    shift_date: { type: String, index: true },   // IST "YYYY-MM-DD" the shift belongs to
    shift_end_at: Date,
    next_shift_start_at: Date,                   // first-escalation instant (per-shift ATTENTION_TIMING); null = empty queue / manual test build
    status: { type: String, enum: ["pending", "cleared", "empty"], default: "pending", index: true },
    items: [AttentionItemSchema],
    created_at: { type: Date, default: Date.now },
    cleared_at: Date,
    escalation: {
      alert_count: { type: Number, default: 0 },
      last_alert_at: Date,
    },
  },
  { versionKey: false },
);

// One queue per member per shift-date — makes duplicate builds impossible
// even if two sweeps race (the second insert fails with E11000).
AttentionQueueSchema.index({ member: 1, shift_date: 1 }, { unique: true });

export const AttentionQueue = mongoose.model("AttentionQueue", AttentionQueueSchema);

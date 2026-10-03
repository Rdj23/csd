/**
 * AnalyticsTicket — The main solved/closed ticket collection powering analytics.
 *
 * Split out of the former monolithic models/index.js. The schema below is
 * byte-for-byte the original; only the import and this header are new.
 * models/index.js re-exports it, so every existing import still resolves.
 */

import mongoose from "mongoose";

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

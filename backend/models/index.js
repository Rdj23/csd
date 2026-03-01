import mongoose from "mongoose";

// --- SCHEMAS ---
const RemarkSchema = new mongoose.Schema({
  ticketId: { type: String, index: true },
  user: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
});
export const Remark = mongoose.model("Remark", RemarkSchema);

const ViewSchema = new mongoose.Schema({
  userId: { type: String, index: true },
  name: String,
  filters: Object,
  createdAt: { type: Date, default: Date.now },
});
export const View = mongoose.model("View", ViewSchema);

const AnalyticsTicketSchema = new mongoose.Schema(
  {
    ticket_id: { type: String, unique: true, index: true },
    devrev_id: String, // Full DevRev DON ID (for timeline-entries.list)
    display_id: String,
    title: String,
    created_date: Date,
    closed_date: { type: Date, index: true },
    owner: { type: String, index: true },
    owner_id: String, // DevRev dev_user ID (for co-op detection)
    account_cohort: String, // tnt__account_cohort_fy_25 (for point scoring)
    team: String,
    region: String,
    priority: String,
    is_zendesk: { type: Boolean, index: true },
    rwt: Number,
    frt: Number,
    iterations: Number,
    csat: { type: Number, default: 0 },
    frr: { type: Number, default: 0 },
    account_name: { type: String, index: true },
    // NOC Fields
    is_noc: { type: Boolean, default: false, index: true },
    noc_issue_id: { type: String, default: null },
    noc_jira_key: { type: String, default: null },
    noc_rca: { type: String, default: null },
    noc_reported_by: { type: String, default: null },
    noc_assignee: { type: String, default: null },
    noc_confirmation_by: { type: String, default: null },
    has_l2_noc_confirmation: { type: Boolean, default: false },
    noc_confirmation_iss_id: { type: String, default: null },
    slack_alerted_at: { type: Date, default: null },
    stage_name: { type: String, index: true },
    actual_close_date: Date,
  },
  { versionKey: false },
);

// EXISTING INDEXES
AnalyticsTicketSchema.index({ closed_date: 1, owner: 1 });
AnalyticsTicketSchema.index({ closed_date: 1, is_noc: 1 });
AnalyticsTicketSchema.index({ closed_date: 1, is_zendesk: 1 });
AnalyticsTicketSchema.index({ owner: 1, closed_date: 1, region: 1 });

// INDEXES FOR HOT/WARM/COLD DATA STRATEGY
AnalyticsTicketSchema.index({ stage_name: 1, actual_close_date: -1 });
AnalyticsTicketSchema.index({ actual_close_date: -1 });
AnalyticsTicketSchema.index({ created_date: -1, stage_name: 1 });

export const AnalyticsTicket = mongoose.model(
  "AnalyticsTicket",
  AnalyticsTicketSchema,
);

const AnalyticsCacheSchema = new mongoose.Schema({
  cache_key: { type: String, unique: true, index: true },
  computed_at: { type: Date, default: Date.now },
  stats: Object,
  trends: Array,
  leaderboard: Array,
  badTickets: Array,
  individualTrends: Object,
});
AnalyticsCacheSchema.index({ computed_at: 1 }, { expireAfterSeconds: 86400 }); // Auto-expire after 24h
export const AnalyticsCache = mongoose.model("AnalyticsCache", AnalyticsCacheSchema);

const PrecomputedDashboardSchema = new mongoose.Schema({
  cache_type: { type: String, unique: true, index: true },
  computed_at: { type: Date, default: Date.now },
  data: Object,
  computing: { type: Boolean, default: false },
});
PrecomputedDashboardSchema.index({ computed_at: 1 }, { expireAfterSeconds: 172800 }); // Auto-expire after 48h
export const PrecomputedDashboard = mongoose.model("PrecomputedDashboard", PrecomputedDashboardSchema);

const SyncMetadataSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed,
  updated_at: { type: Date, default: Date.now },
});
export const SyncMetadata = mongoose.model("SyncMetadata", SyncMetadataSchema);

// --- USER ACTIVITY INTELLIGENCE ---

// Granular: one document per timeline comment (for drill-down)
const UserActivityEntrySchema = new mongoose.Schema(
  {
    entry_id: { type: String, unique: true, index: true },
    ticket_id: String, // Full DevRev DON ID
    ticket_display_id: { type: String, index: true },
    user_id: String, // DevRev created_by.id
    user_name: { type: String, index: true },
    visibility: { type: String, enum: ["internal", "external", "public"] },
    created_date: { type: Date, index: true },
    date_bucket: { type: String, index: true }, // "YYYY-MM-DD" IST
    hour_bucket: Number, // 0-23 IST
    is_coop: { type: Boolean, default: false },
    account_cohort: String,
    ticket_stage: String,
    points: { type: Number, default: 0 },
  },
  { versionKey: false },
);

UserActivityEntrySchema.index({ user_name: 1, date_bucket: 1 });
UserActivityEntrySchema.index({ date_bucket: 1, visibility: 1 });

export const UserActivityEntry = mongoose.model(
  "UserActivityEntry",
  UserActivityEntrySchema,
);

// Tracks tickets that have been fully synced (skip on future backfills)
const ActivitySyncedTicketSchema = new mongoose.Schema(
  {
    ticket_display_id: { type: String, unique: true, index: true },
    synced_at: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
export const ActivitySyncedTicket = mongoose.model(
  "ActivitySyncedTicket",
  ActivitySyncedTicketSchema,
);

// Pre-aggregated daily rollup (dashboard reads hit this — no aggregation at query time)
const UserActivityDailySchema = new mongoose.Schema(
  {
    user_name: { type: String, index: true },
    date_bucket: { type: String, index: true }, // "YYYY-MM-DD"
    internal_count: { type: Number, default: 0 },
    external_count: { type: Number, default: 0 },
    total_points: { type: Number, default: 0 },
    hourly: { type: Object, default: {} }, // { "9": { int: 1, ext: 3 }, ... }
    coop_tickets: { type: [String], default: [] }, // Distinct ticket display IDs
    coop_count: { type: Number, default: 0 },
    point_breakdown: {
      key_ext: { type: Number, default: 0 },
      non_key_ext: { type: Number, default: 0 },
    },
  },
  { versionKey: false },
);

UserActivityDailySchema.index({ user_name: 1, date_bucket: 1 }, { unique: true });
UserActivityDailySchema.index({ date_bucket: 1 });

export const UserActivityDaily = mongoose.model(
  "UserActivityDaily",
  UserActivityDailySchema,
);

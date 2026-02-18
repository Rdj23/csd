import mongoose from "mongoose";

// --- SCHEMAS ---
const RemarkSchema = new mongoose.Schema({
  ticketId: String,
  user: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
});
export const Remark = mongoose.model("Remark", RemarkSchema);

const ViewSchema = new mongoose.Schema({
  userId: String,
  name: String,
  filters: Object,
  createdAt: { type: Date, default: Date.now },
});
export const View = mongoose.model("View", ViewSchema);

const AnalyticsTicketSchema = new mongoose.Schema(
  {
    ticket_id: { type: String, unique: true, index: true },
    display_id: String,
    title: String,
    created_date: Date,
    closed_date: { type: Date, index: true },
    owner: { type: String, index: true },
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
export const AnalyticsCache = mongoose.model("AnalyticsCache", AnalyticsCacheSchema);

const PrecomputedDashboardSchema = new mongoose.Schema({
  cache_type: { type: String, unique: true, index: true },
  computed_at: { type: Date, default: Date.now },
  data: Object,
  computing: { type: Boolean, default: false },
});
export const PrecomputedDashboard = mongoose.model("PrecomputedDashboard", PrecomputedDashboardSchema);

const SyncMetadataSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed,
  updated_at: { type: Date, default: Date.now },
});
export const SyncMetadata = mongoose.model("SyncMetadata", SyncMetadataSchema);

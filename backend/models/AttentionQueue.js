/**
 * AttentionQueue — Shift-end backlog queue per member (+ AttentionItem subdoc).
 *
 * Split out of the former monolithic models/index.js. The schema below is
 * byte-for-byte the original; only the import and this header are new.
 * models/index.js re-exports it, so every existing import still resolves.
 */

import mongoose from "mongoose";

/**
 * WHY THIS EXISTS:
 * One document per member per shift-date, created ~45 min before their shift
 * ends by the attention sweep (attentionService.js). Holds the snapshot of
 * tickets that matched the attention rules at build time, plus the clearing/
 * escalation state machine. Ticket STATUS always comes from Redis/DevRev —
 * this collection only persists the queue itself (it must survive restarts
 * and next-day escalation checks). The dashboard always shows the member's
 * LATEST queue (yesterday's until today's build replaces it).
 *
 * LIFECYCLE:
 *   build (shift end −45 min, dashboard only, no Slack)
 *   → shift end −15 min … shift-end Slack summary (congrats / "N tracked" /
 *                         "X open, Y pending, Z on hold — update those")
 *   pending → (member actions tickets, Verify & Clear re-checks DevRev)
 *           → cleared … Slack congrats (skipped if the summary is still ahead)
 *   pending → per-shift escalation instant … Slack escalation to TL, hourly
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
    // Shift-end Slack summary (~15 min before shift end, ATTENTION_TIMING
    // .slackAt) — decoupled from the build (~45 min before). sent_at makes
    // the post once-per-queue across sweep ticks.
    shift_alert_at: Date,
    shift_alert_sent_at: Date,
    // Slack ts of the batched shift-end summary this queue was announced in
    // (returned by the n8n Slack bot) — the next-day "no action" alert
    // replies into this thread. Null on the incoming-webhook fallback.
    slack_thread_ts: String,
    next_shift_start_at: Date,                   // first-escalation instant (per-shift ATTENTION_TIMING); null = no actionable items / manual test build
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

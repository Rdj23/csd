/**
 * attentionService.js — Attention Queue: shift-aware backlog nudges.
 *
 * WHAT THIS DOES:
 * 30 minutes before each GST member's shift ends, build them a queue of
 * tickets that need action (aging open / silent pending / stuck on-hold),
 * post it to Slack + push it to their dashboard. Clearing the queue is
 * VERIFIED against live DevRev data — the only way to silence it is to
 * actually action the tickets. Uncleared queues escalate to the team lead
 * 45 minutes before the member's next shift, then hourly until clear.
 *
 * RULES ("response" = EXTERNAL comment; internal notes never count —
 * verified 2026-08-02 against DevRev timeline data, see
 * scripts/verifyResponseTimestamps.js):
 *   open    — created ≥4 days ago AND no org-side external reply today (IST).
 *             Skipped when a first/second-reminder tag is present (the DevRev
 *             reminder automation owns those tickets end-to-end).
 *   pending — customer silent ≥5 days (tnt__last_revu_message_ts).
 *   onHold  — linked ISS created ≥7 days ago AND no org-side external
 *             message on the main ticket in the last 2 days.
 *
 * TIMESTAMP SOURCES (from the Redis active cache, no Mongo polling):
 *   tnt__last_devu_message_ts — last org-side EXTERNAL message (agent reply
 *     or workflow bot post; internal notes do NOT move it).
 *   tnt__last_revu_message_ts — last customer message.
 */

import axios from "axios";
import { redisGet } from "../config/database.js";
import {
  resolveOwnerName,
  EMAIL_TO_NAME_MAP,
  TEAM_MAPPING,
  GST_MEMBERS,
  SHIFT_HOURS,
  isSolvedStatus,
} from "../config/constants.js";
import { bucketForStage } from "./reconcileService.js";
import { findGSTMember } from "./slackService.js";
import {
  fetchTicketLinks,
  fetchWorkItem,
  fetchWorkItems,
  dependencyCounterpart,
} from "./devrevApi.js";
import { AttentionQueue } from "../models/index.js";
import { publishSocketEvent } from "../lib/pubsub.js";
import logger from "../config/logger.js";

// ── Tunables ─────────────────────────────────────────────────────────────
export const ATTENTION_RULES = {
  OPEN_MIN_AGE_DAYS: 4,
  PENDING_CUSTOMER_SILENCE_DAYS: 5,
  ONHOLD_AGENT_SILENCE_DAYS: 2,
  ONHOLD_ISS_MIN_AGE_DAYS: 7,
};

const QUEUE_WINDOW_MS = 30 * 60 * 1000;      // build window before shift end
const ESCALATE_LEAD_MS = 45 * 60 * 1000;     // before next shift start
const ESCALATE_INTERVAL_MS = 60 * 60 * 1000; // repeat escalation hourly

// Tags the DevRev auto-reminder workflow sets ("First Reminder Sent" /
// "Second Reminder Sent" in DevRev — compared lowercased). A ticket carrying
// one is excluded from open AND pending rules: the automation nudges the
// customer itself and auto-closes after its final check, so alerting the
// agent would just double-nudge. Verified 2026-08-02: 282 of 773 pending GST
// tickets carried these tags.
const REMINDER_TAGS = new Set([
  "first-reminder-sent",
  "second-reminder-sent",
  "first reminder sent",
  "second reminder sent",
]);

// "keep_pending" is a deliberate team marker: leave this ticket pending
// (e.g. customer asked to keep it open). Never alert on those.
const KEEP_PENDING_TAGS = new Set(["keep_pending", "keep pending"]);

const DAY_MS = 24 * 60 * 60 * 1000;
const TICKET_URL = (id) => `https://app.devrev.ai/clevertapsupport/works/${id}`;

// ── IST time helpers ─────────────────────────────────────────────────────
// All shift math is done on epoch ms anchored to IST calendar days, so the
// server's own timezone never matters.

/** "YYYY-MM-DD" for a Date, in IST. */
const istYmd = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

/** Instant for `decimalHours` (7.5 = 07:30 IST) on an IST calendar day. */
const istInstant = (ymd, decimalHours) =>
  new Date(new Date(`${ymd}T00:00:00+05:30`).getTime() + decimalHours * 3600 * 1000);

const istTodayStartMs = () => new Date(`${istYmd()}T00:00:00+05:30`).getTime();

const ms = (v) => (v ? new Date(v).getTime() : null);
const daysAgo = (tsMs, nowMs) => Math.floor((nowMs - tsMs) / DAY_MS);

// ── Ticket field accessors ───────────────────────────────────────────────
const lastAgentExternalMs = (t) => ms(t.custom_fields?.tnt__last_devu_message_ts);
const lastCustomerMs = (t) => ms(t.custom_fields?.tnt__last_revu_message_ts);
const hasTagIn = (t, tagSet) =>
  (t.tags || []).some((tag) =>
    tagSet.has((tag.tag?.name || "").toLowerCase().trim()),
  );
const hasReminderTag = (t) => hasTagIn(t, REMINDER_TAGS);
const hasKeepPendingTag = (t) => hasTagIn(t, KEEP_PENDING_TAGS);

// ── Rule engine ──────────────────────────────────────────────────────────
// Pure per-ticket evaluation. Used by BOTH the queue builder and the
// verify-and-clear path so the two can never disagree (the classic
// "KPI changes but expand shows all" bug class in this codebase).

/**
 * Evaluate one cached/live ticket against the attention rules.
 * @returns {Object|null} { bucket, rule, reason, needsIssCheck } or null.
 * onHold results have needsIssCheck: true — the linked-ISS age condition
 * requires a DevRev links walk that the caller performs (and may reuse a
 * stored ISS date for, on re-verification).
 */
export const evaluateTicket = (t, nowMs = Date.now()) => {
  const stageName = t.stage?.name;
  if (isSolvedStatus(stageName)) return null;
  const bucket = bucketForStage(stageName);
  const createdMs = ms(t.created_date);

  if (bucket === "open") {
    if (hasReminderTag(t)) return null; // DevRev reminder automation owns it
    if (!createdMs || nowMs - createdMs < ATTENTION_RULES.OPEN_MIN_AGE_DAYS * DAY_MS) return null;
    const la = lastAgentExternalMs(t);
    if (la && la >= istTodayStartMs()) return null; // already replied today
    return {
      bucket,
      rule: "open-aging",
      reason: `Open for ${daysAgo(createdMs, nowMs)}d and no reply to the customer today`,
      needsIssCheck: false,
    };
  }

  if (bucket === "pending") {
    // Awaiting customer — the customer went quiet. Nudge or close.
    // Reminder-tagged tickets are the automation's job; keep_pending is a
    // deliberate "leave it open" marker. Neither should page a human.
    if (hasReminderTag(t) || hasKeepPendingTag(t)) return null;
    const lc = lastCustomerMs(t) ?? createdMs;
    if (!lc || nowMs - lc < ATTENTION_RULES.PENDING_CUSTOMER_SILENCE_DAYS * DAY_MS) return null;
    return {
      bucket,
      rule: "pending-silent",
      reason: `Customer silent for ${daysAgo(lc, nowMs)}d — nudge or close`,
      needsIssCheck: false,
    };
  }

  if (bucket === "onHold") {
    // Waiting on CleverTap — even if the linked ISS is being worked, the
    // customer must hear from us every 2 days.
    const la = lastAgentExternalMs(t) ?? createdMs;
    if (!la || nowMs - la < ATTENTION_RULES.ONHOLD_AGENT_SILENCE_DAYS * DAY_MS) return null;
    return {
      bucket,
      rule: "onhold-stale",
      reason: `Customer hasn't heard from us in ${daysAgo(la, nowMs)}d`,
      needsIssCheck: true, // AND: linked ISS must be ≥7d old
    };
  }

  return null; // "other" stages (New, queued, Waiting on CSM…) are out of scope
};

/** Oldest linked work item (ISS/TKT/TASK) for a ticket: { id, created_date } or null. */
const oldestLinkedIss = async (displayId) => {
  // fetchTicketLinks builds the DON URN as ticket/<numeric id> — a "TKT-"
  // prefix produces an invalid URN and DevRev answers 403.
  const links = await fetchTicketLinks(String(displayId).replace(/^TKT-/i, ""));
  const seen = new Set();
  const depIds = [];
  for (const link of links) {
    const c = dependencyCounterpart(link, displayId);
    if (!c || seen.has(c.display_id)) continue;
    seen.add(c.display_id);
    if (/^(ISS|TKT|TASK)-/i.test(c.display_id)) depIds.push(c.display_id);
  }
  if (!depIds.length) return null;
  const works = await fetchWorkItems(depIds);
  let oldest = null;
  for (const w of works.values()) {
    if (!w.created_date) continue;
    if (!oldest || new Date(w.created_date) < new Date(oldest.created_date)) {
      oldest = { id: w.display_id, created_date: w.created_date };
    }
  }
  return oldest;
};

/**
 * Build queue items for a member's active tickets. Cheap cache-only checks
 * run first; the DevRev links walk happens only for on-hold tickets that
 * already passed the 2-day-silence pre-check (typically a handful).
 */
export const buildItems = async (tickets, nowMs = Date.now()) => {
  const items = [];
  for (const t of tickets) {
    const verdict = evaluateTicket(t, nowMs);
    if (!verdict) continue;

    const item = {
      display_id: t.display_id,
      title: t.title,
      account: t.account?.display_name || t.account || null,
      severity: t.severity?.name || t.severity || null,
      bucket: verdict.bucket,
      rule: verdict.rule,
      reason: verdict.reason,
      created_date: t.created_date ? new Date(t.created_date) : null,
      last_agent_external_ts: t.custom_fields?.tnt__last_devu_message_ts || null,
      last_customer_ts: t.custom_fields?.tnt__last_revu_message_ts || null,
      status: "pending",
    };

    if (verdict.needsIssCheck) {
      let iss = null;
      try {
        iss = await oldestLinkedIss(t.display_id);
      } catch (e) {
        logger.warn({ err: e.message, ticket: t.display_id }, "Attention: ISS lookup failed — skipping on-hold ticket");
        continue; // can't prove the AND condition → don't alert
      }
      if (!iss) continue; // on hold with no linked work — AND condition can't hold
      const issAge = daysAgo(ms(iss.created_date), nowMs);
      if (issAge < ATTENTION_RULES.ONHOLD_ISS_MIN_AGE_DAYS) continue;
      item.iss_id = iss.id;
      item.iss_created_date = new Date(iss.created_date);
      item.reason = `${iss.id} open for ${issAge}d — ${verdict.reason.charAt(0).toLowerCase()}${verdict.reason.slice(1)}`;
    }

    items.push(item);
  }
  return items;
};

// ── Roster API client ────────────────────────────────────────────────────
// Reads shift assignments from the GST Hub roster API. Only four fields are
// consumed: email, engineer_name, shift, slack_id. `shift` doubles as an
// off-status ("Week Off", "EL"…) — anything not in SHIFT_HOURS is treated as
// "not working" and skipped, which gives leave-awareness for free.

const extractSlackMention = (raw) => {
  const m = String(raw || "").match(/([UW][A-Z0-9]{6,})/);
  return m ? `<@${m[1]}>` : null;
};

const canonicalMemberName = (row) =>
  EMAIL_TO_NAME_MAP[(row.email || "").toLowerCase()] ||
  resolveOwnerName(row.engineer_name) ||
  (GST_MEMBERS.has(row.engineer_name) ? row.engineer_name : null);

/**
 * Fetch TODAY's roster rows. This is deliberately the only roster API call
 * we make — the endpoint (gst-hub /api/v1/roster/today) serves the current
 * day only, per team decision. Anything about other days (next shift start,
 * overnight boundaries) is derived locally from SHIFT_HOURS. Team-lead
 * resolution never uses this API either — it comes from the TEAMS mapping
 * in constants.js.
 * Returns [] when unavailable.
 */
export const fetchRosterShifts = async () => {
  const base = process.env.ROSTER_API_URL;
  if (!base) {
    logger.warn("ROSTER_API_URL not set — attention sweep has no shift data");
    return [];
  }
  const headers = {};
  if (process.env.ROSTER_API_TOKEN) headers.Authorization = `Bearer ${process.env.ROSTER_API_TOKEN}`;
  if (process.env.ROSTER_API_KEY) headers["x-api-key"] = process.env.ROSTER_API_KEY;

  const res = await axios.get(base, { headers, timeout: 20000 });
  const rows = res.data?.data || res.data || [];
  return rows
    .map((r) => ({
      email: (r.email || "").toLowerCase(),
      name: canonicalMemberName(r),
      shift: (r.shift || "").toUpperCase().trim(),
      slackMention: extractSlackMention(r.slack_id),
    }))
    .filter((r) => r.name); // silently ignore rows we can't map to a GST member
};

// ── Slack ────────────────────────────────────────────────────────────────
// Posts to the dedicated attention webhook (test channel for the pilot).
// Deliberately NOT the NOC/reconcile webhook — different audience.

const attentionWebhook = () => process.env.ATTENTION_SLACK_WEBHOOK_URL;

export const postSlack = async (text) => {
  const url = attentionWebhook();
  if (!url) {
    logger.warn("ATTENTION_SLACK_WEBHOOK_URL not set — skipping Slack post");
    return false;
  }
  try {
    await axios.post(url, { text }, { timeout: 15000 });
    return true;
  } catch (e) {
    logger.error({ err: e.message }, "Attention Slack post failed");
    return false;
  }
};

const BUCKET_LABELS = { open: "🟠 Open", pending: "🟡 Pending", onHold: "🔵 On Hold" };

// Slack shows at most this many tickets per bucket — the full queue lives on
// the dashboard. Keeps day-one messages readable while the backlog is large.
const SLACK_MAX_PER_BUCKET = 10;

export const queueMessage = (queue, mention) => {
  const who = mention || `*${queue.member}*`;
  const lines = [
    `⏰ ${who} — *${queue.items.length} ticket${queue.items.length === 1 ? "" : "s"}* need attention before your shift ends`,
  ];
  for (const bucket of ["open", "pending", "onHold"]) {
    const rows = queue.items.filter((i) => i.bucket === bucket);
    if (!rows.length) continue;
    lines.push(`\n${BUCKET_LABELS[bucket]} (${rows.length})`);
    for (const i of rows.slice(0, SLACK_MAX_PER_BUCKET)) {
      lines.push(`• <${TICKET_URL(i.display_id)}|${i.display_id}> ${i.title ? `_${i.title.slice(0, 70)}_` : ""} — ${i.reason}`);
    }
    if (rows.length > SLACK_MAX_PER_BUCKET) {
      lines.push(`  …and ${rows.length - SLACK_MAX_PER_BUCKET} more on the dashboard`);
    }
  }
  lines.push(`\nAction them, then hit *Verify & Clear* on the dashboard ✅`);
  return lines.join("\n");
};

// ── Queue building ───────────────────────────────────────────────────────

/** Members' active tickets straight from the live Redis cache. */
const activeTicketsByMember = async () => {
  const cached = (await redisGet("tickets:active")) || [];
  const byMember = new Map();
  for (const t of cached) {
    if (isSolvedStatus(t.stage?.name)) continue;
    const owner = resolveOwnerName(t.owned_by?.[0]?.display_name);
    if (!owner) continue;
    if (!byMember.has(owner)) byMember.set(owner, []);
    byMember.get(owner).push(t);
  }
  return byMember;
};

/**
 * Next shift start — derived locally, NOT from the roster API (which serves
 * today only). Assumption: tomorrow at the same shift's start time. If the
 * member is actually off tomorrow, the escalation loop still won't page —
 * it re-checks today's roster at fire time and skips members who aren't on
 * a working shift that day.
 */
const nextShiftStart = (shift, fromMs) => {
  const hours = SHIFT_HOURS[shift];
  if (!hours || shift === "ON CALL") return null;
  const tomorrow = new Date(fromMs + DAY_MS);
  return istInstant(istYmd(tomorrow), hours.start);
};

const buildQueueForMember = async (candidate, ticketsByMember, nowMs) => {
  const tickets = ticketsByMember.get(candidate.name) || [];
  const items = await buildItems(tickets, nowMs);
  const status = items.length ? "pending" : "empty";

  const queue = await AttentionQueue.create({
    member: candidate.name,
    member_email: candidate.email,
    slack_id: candidate.slackMention,
    shift: candidate.shift,
    shift_date: candidate.shiftDate,
    shift_end_at: candidate.endAt,
    next_shift_start_at: items.length ? nextShiftStart(candidate.shift, nowMs) : null,
    status,
    items,
  });

  if (status === "empty") {
    await postSlack(`🌟 Superstar — no tickets in the attention queue today, ${candidate.slackMention || candidate.name}! Enjoy the end of your shift.`);
  } else {
    await postSlack(queueMessage(queue, candidate.slackMention));
  }

  await publishSocketEvent("ATTENTION_QUEUE", {
    email: candidate.email,
    member: candidate.name,
    status,
    count: items.length,
    shiftDate: candidate.shiftDate,
  });

  logger.info({ member: candidate.name, items: items.length, status }, "Attention queue built");
  return queue;
};

// ── Verification ─────────────────────────────────────────────────────────
// An item clears only when live DevRev data shows the required action
// happened. Per rule:
//   open    — org-side external reply landed today, or the ticket left the
//             open bucket (incl. solved).
//   pending — org-side external nudge AFTER the queue was created, customer
//             replied within the window, or ticket left the bucket.
//   onHold  — org-side external message within the 2-day window, or ticket
//             left the bucket.

const itemStillBlocked = (item, fresh, queueCreatedMs, nowMs) => {
  const stageName = fresh.stage?.name;
  if (isSolvedStatus(stageName)) return null;
  const bucket = bucketForStage(stageName);
  if (bucket !== item.bucket) return null; // moved on — whatever they did worked
  const la = lastAgentExternalMs(fresh);
  const lc = lastCustomerMs(fresh);

  if (item.bucket === "open") {
    if (hasReminderTag(fresh)) return null;
    if (la && la >= istTodayStartMs()) return null;
    return "Still no external reply to the customer today";
  }
  if (item.bucket === "pending") {
    if (hasReminderTag(fresh) || hasKeepPendingTag(fresh)) return null; // automation/deliberate hold took over
    if (la && la >= queueCreatedMs) return null; // nudged since queue creation
    if (lc && nowMs - lc < ATTENTION_RULES.PENDING_CUSTOMER_SILENCE_DAYS * DAY_MS) return null;
    return "No nudge sent since this queue was created";
  }
  if (item.bucket === "onHold") {
    if (la && nowMs - la < ATTENTION_RULES.ONHOLD_AGENT_SILENCE_DAYS * DAY_MS) return null;
    return "Customer still hasn't heard from us in the last 2 days";
  }
  return null;
};

/**
 * Re-check every pending item of a queue against live DevRev and clear the
 * ones that were genuinely actioned. Marks the queue cleared (+ Slack) when
 * nothing is left. Returns the updated queue doc, or null if none pending.
 * @param {string} trigger "user" | "escalation"
 */
export const verifyAndClearQueue = async (memberName, trigger = "user") => {
  const queue = await AttentionQueue.findOne({ member: memberName, status: "pending" }).sort({ created_at: -1 });
  if (!queue) return null;

  const nowMs = Date.now();
  const queueCreatedMs = queue.created_at.getTime();

  for (const item of queue.items) {
    if (item.status === "cleared") continue;
    let fresh = null;
    try {
      fresh = await fetchWorkItem(item.display_id);
    } catch (e) {
      logger.warn({ err: e.message, ticket: item.display_id }, "Attention verify: live fetch failed");
    }
    if (!fresh) {
      // Can't verify → keep it pending rather than silently passing it.
      item.block_reason = "Could not verify against DevRev — try again";
      continue;
    }
    const blocked = itemStillBlocked(item, fresh, queueCreatedMs, nowMs);
    if (blocked) {
      item.block_reason = blocked;
    } else {
      item.status = "cleared";
      item.cleared_at = new Date();
      item.block_reason = null;
    }
  }

  const remaining = queue.items.filter((i) => i.status !== "cleared").length;
  if (remaining === 0) {
    queue.status = "cleared";
    queue.cleared_at = new Date();
    await postSlack(
      `✅ ${queue.slack_id || queue.member} cleared their attention queue — *${queue.items.length} ticket${queue.items.length === 1 ? "" : "s"}* actioned. 👏`,
    );
  }
  await queue.save();

  await publishSocketEvent("ATTENTION_QUEUE_UPDATED", {
    email: queue.member_email,
    member: queue.member,
    status: queue.status,
    remaining,
    trigger,
  });
  return queue;
};

// ── Escalation ───────────────────────────────────────────────────────────

const escalationMessage = (queue, tlMention, remaining) => {
  const who = queue.slack_id || `*${queue.member}*`;
  const tl = tlMention ? ` cc ${tlMention}` : "";
  return (
    `🚨 Attention queue from ${queue.shift_date} is still open — ${who} has *${remaining} unactioned ticket${remaining === 1 ? "" : "s"}*${tl}\n` +
    queue.items
      .filter((i) => i.status !== "cleared")
      .map((i) => `• <${TICKET_URL(i.display_id)}|${i.display_id}> — ${i.block_reason || i.reason}`)
      .join("\n") +
    `\nThis alert repeats hourly until the queue is cleared.`
  );
};

const runEscalations = async (rosterRows, nowMs) => {
  const due = await AttentionQueue.find({
    status: "pending",
    next_shift_start_at: { $ne: null, $lte: new Date(nowMs + ESCALATE_LEAD_MS) },
  });

  for (const q of due) {
    const last = q.escalation?.last_alert_at?.getTime() || 0;
    if (nowMs - last < ESCALATE_INTERVAL_MS) continue;

    // Deliberately NO leave-skip here (team decision 2026-08-02): the channel
    // is private and pings are personal, so an open queue keeps alerting even
    // on the member's day off — teammates can action the tickets, and the
    // auto-verify below clears the queue on the next cycle once they do.

    // Auto-verify first — never page a TL over work that was actually done
    // but not clicked through.
    const updated = await verifyAndClearQueue(q.member, "escalation");
    if (!updated || updated.status !== "pending") continue;

    const remaining = updated.items.filter((i) => i.status !== "cleared").length;
    // TL comes from the TEAMS mapping in constants.js (per team decision —
    // never from the roster API). The roster row / Slack map only resolve
    // the TL's mention id.
    const leadName = TEAM_MAPPING[q.member]?.team || null;
    const tlRow = leadName ? rosterRows.find((r) => r.name === leadName) : null;
    const tlMention =
      tlRow?.slackMention || (leadName ? findGSTMember(leadName) : null) || (leadName ? `*${leadName}* (TL)` : null);

    await postSlack(escalationMessage(updated, tlMention, remaining));
    updated.escalation = {
      alert_count: (updated.escalation?.alert_count || 0) + 1,
      last_alert_at: new Date(nowMs),
    };
    await updated.save();
    logger.info({ member: q.member, remaining, alertCount: updated.escalation.alert_count }, "Attention escalation sent");
  }
};

// ── The sweep (repeatable job entry point) ───────────────────────────────

/**
 * Runs every 15 minutes. Builds queues for members whose shift ends within
 * the next 30 minutes (once per member per shift-date — the unique index
 * makes duplicate builds impossible), then processes escalations.
 *
 * @param {Object} opts
 * @param {boolean} opts.force  Build regardless of the 30-min window (testing).
 * @param {string}  opts.member Restrict to one canonical member name (testing).
 */
export const runAttentionSweep = async ({ force = false, member = null } = {}) => {
  const nowMs = Date.now();
  const todayYmd = istYmd();
  const roster = await fetchRosterShifts();

  // Candidate shifts ending today. The roster API serves TODAY only, so the
  // overnight SHIFT 4 is handled from today's row: a member rostered SHIFT 4
  // today gets their queue in the 07:00–07:30 IST window (the morning end of
  // the overnight shift). Known boundary quirk, accepted for v1: on the
  // FIRST day of a shift-4 block the morning window fires before their first
  // night; the morning after the LAST day is missed.
  const candidates = [];
  for (const r of roster) {
    const hours = SHIFT_HOURS[r.shift];
    if (!hours || r.shift === "ON CALL") continue;
    // For overnight SHIFT 4, hours.end (7.5) already lands on this morning.
    candidates.push({ ...r, shiftDate: todayYmd, endAt: istInstant(todayYmd, hours.end) });
  }

  const ticketsByMember = await activeTicketsByMember();
  const built = [];
  for (const c of candidates) {
    if (member && c.name !== member) continue;
    const inWindow = nowMs >= c.endAt.getTime() - QUEUE_WINDOW_MS && nowMs <= c.endAt.getTime();
    if (!force && !inWindow) continue;

    const exists = await AttentionQueue.findOne({ member: c.name, shift_date: c.shiftDate }, { _id: 1 }).lean();
    if (exists) continue;

    try {
      built.push(await buildQueueForMember(c, ticketsByMember, nowMs));
    } catch (e) {
      // Unique-index race between two sweeps is harmless; log everything else.
      if (e.code !== 11000) logger.error({ err: e, member: c.name }, "Attention queue build failed");
    }
  }

  await runEscalations(roster, nowMs);

  logger.info({ candidates: candidates.length, built: built.length }, "Attention sweep done");
  return { built: built.map((q) => ({ member: q.member, status: q.status, items: q.items.length })) };
};

/** Latest queue for a member (any status) — powers the dashboard panel. */
export const getQueueForEmail = async (email) => {
  const member = EMAIL_TO_NAME_MAP[(email || "").toLowerCase()];
  if (!member) return { member: null, queue: null };
  const queue = await AttentionQueue.findOne({ member }).sort({ created_at: -1 }).lean();
  return { member, queue };
};

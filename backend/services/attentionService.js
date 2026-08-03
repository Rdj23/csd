/**
 * attentionService.js — Attention Queue: shift-aware backlog nudges.
 *
 * WHAT THIS DOES:
 * At a fixed per-shift time near the end of each GST member's shift
 * (ATTENTION_TIMING), build them a queue of tickets that need action
 * (aging open / silent pending / stuck on-hold), post it to Slack + push
 * it to their dashboard. Clearing the queue is VERIFIED against live
 * DevRev data — the only way to silence it is to actually action the
 * tickets. Uncleared queues escalate to the team lead at a fixed time
 * after the member's next shift starts, then hourly until clear.
 *
 * RULES ("response" = EXTERNAL comment; internal notes never count —
 * verified 2026-08-02 against DevRev timeline data, see
 * scripts/verifyResponseTimestamps.js):
 *   open    — created ≥4 days ago AND no org-side external reply today (IST).
 *             Skipped when a reminder tag is present (the DevRev reminder
 *             automation owns those tickets end-to-end).
 *   pending — flags only when the DevRev follow-up automation is OFF TRACK.
 *             The automation nudges pending tickets on business days only
 *             (Mon–Fri IST): first follow-up 3 business days after we went
 *             quiet, then 2 business days between reminders, final reminder
 *             last. Its posts are EXTERNAL messages, so a healthy cycle
 *             refreshes tnt__last_devu_message_ts every ≤3 business days on
 *             its own and never flags here. We flag when the next expected
 *             touch is a full business day overdue (never started/stalled),
 *             when the FINAL reminder ran out with no reply (needs a manual
 *             close), or when the customer replied >1 day ago and the ticket
 *             still sits in pending. Reminder tags only pick the threshold
 *             and wording — they never hide a ticket (tags are sticky;
 *             timestamps stay the truth, team decision 2026-08-02).
 *   onHold  — no org-side external message on the main ticket in the last
 *             2 days. Same "our side went quiet" principle: even with
 *             engineering actively working the linked ISS, the customer
 *             must hear from us every 2 days.
 *
 * TIMESTAMP SOURCES (streamed per-page from DevRev at build time, filtered
 * to the due members only — the full active cache is never parsed here):
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
import { streamActiveFromDevRev, trimTicket } from "./syncService.js";
import { findGSTMember } from "./slackService.js";
import { fetchWorkItem } from "./devrevApi.js";
import { AttentionQueue, Remark } from "../models/index.js";
import { publishSocketEvent } from "../lib/pubsub.js";
import logger from "../config/logger.js";

// ── Tunables ─────────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;

export const ATTENTION_RULES = {
  OPEN_MIN_AGE_DAYS: 4,
  ONHOLD_AGENT_SILENCE_DAYS: 2,
  // Pending follow-up cadence in BUSINESS days (the DevRev automation only
  // fires Mon–Fri IST — a follow-up "due" on a weekend legitimately slips
  // to Monday, and business-day counting keeps that from flagging).
  PENDING_FIRST_FOLLOWUP_BD: 3, // pending start → first follow-up due
  PENDING_NEXT_FOLLOWUP_BD: 2,  // gap between subsequent reminders
  PENDING_GRACE_BD: 1,          // flag once overdue by a full business day
  PENDING_FINAL_CLOSE_BD: 2,    // after FINAL reminder → needs a manual close
  PENDING_CUSTOMER_REPLY_GRACE_MS: DAY_MS, // customer spoke last, still pending
};

// Per-shift schedule (IST decimal hours, agreed with Rohan 2026-08-03):
// when the shift-end queue posts, and when the first TL escalation fires.
// Escalation is SAME-day for the overnight SHIFT 4 (queue posts 05:30, the
// member's next shift starts the same evening) and next-day for the rest.
// Deliberately explicit per shift — the offsets are not uniform, don't try
// to derive them from SHIFT_HOURS.
const ATTENTION_TIMING = {
  "SHIFT 1": { queueAt: 16.0,  escalateAt: 8.75,  escalateNextDay: true },  // 4:00 PM → 8:45 AM
  "SHIFT 2": { queueAt: 19.0,  escalateAt: 11.25, escalateNextDay: true },  // 7:00 PM → 11:15 AM
  "SHIFT 3": { queueAt: 21.25, escalateAt: 14.5,  escalateNextDay: true },  // 9:15 PM → 2:30 PM
  "SHIFT 4": { queueAt: 5.5,   escalateAt: 23.25, escalateNextDay: false }, // 5:30 AM → 11:15 PM same day
};

const BUILD_WINDOW_MS = 30 * 60 * 1000;      // late-tick tolerance after queueAt
const ESCALATE_INTERVAL_MS = 60 * 60 * 1000; // repeat escalation hourly

// Tags the DevRev auto-reminder workflow sets (compared lowercased). The
// final tag's exact DevRev name is unconfirmed — match plausible variants.
// OPEN bucket: any reminder tag exempts the ticket (automation owns it,
// original spec). PENDING bucket: tags NEVER gate — they only choose the
// overdue threshold + reason wording, because tags are sticky (they survive
// the conversation resuming; team decision 2026-08-02). Worst case a stale
// tag flags one business day early — it can never hide a silent ticket.
const FIRST_REMINDER_TAGS = new Set(["first-reminder-sent", "first reminder sent"]);
const SECOND_REMINDER_TAGS = new Set(["second-reminder-sent", "second reminder sent"]);
const FINAL_REMINDER_TAGS = new Set([
  "third-reminder-sent", "third reminder sent", "3rd reminder sent",
  "final-reminder-sent", "final reminder sent",
]);
const REMINDER_TAGS = new Set([
  ...FIRST_REMINDER_TAGS, ...SECOND_REMINDER_TAGS, ...FINAL_REMINDER_TAGS,
]);
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

const istWeekday = (tsMs) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(new Date(tsMs));

/**
 * Whole business days (Mon–Fri, IST calendar) elapsed from `fromMs` to
 * `nowMs`. Fri→Mon = 1: the weekend doesn't count, which is what keeps a
 * follow-up that legitimately slips over a weekend from flagging.
 */
const businessDaysSince = (fromMs, nowMs) => {
  let count = 0;
  // Noon-IST anchor so the day-stepping loop can't straddle a midnight edge.
  let d = new Date(`${istYmd(new Date(fromMs))}T12:00:00+05:30`).getTime();
  const endYmd = istYmd(new Date(nowMs));
  while (istYmd(new Date(d)) < endYmd) {
    d += DAY_MS;
    const wd = istWeekday(d);
    if (wd !== "Sat" && wd !== "Sun") count++;
    if (count > 30) break; // ancient ticket — precision past a month is pointless
  }
  return count;
};

// ── Ticket field accessors ───────────────────────────────────────────────
const lastAgentExternalMs = (t) => ms(t.custom_fields?.tnt__last_devu_message_ts);
const lastCustomerMs = (t) => ms(t.custom_fields?.tnt__last_revu_message_ts);
const hasTagIn = (t, tagSet) =>
  (t.tags || []).some((tag) =>
    tagSet.has((tag.tag?.name || "").toLowerCase().trim()),
  );
const hasReminderTag = (t) => hasTagIn(t, REMINDER_TAGS);

/**
 * Shared pending-bucket verdict for BOTH the build and verify paths.
 * Returns a human-readable reason when the ticket needs attention, else
 * null. Any org-side external reply (agent nudge or the automation catching
 * up) refreshes devu_ts and resets every clock here.
 */
const pendingBlockReason = (t, nowMs) => {
  const la = lastAgentExternalMs(t) ?? ms(t.created_date);
  const lc = lastCustomerMs(t);

  // Customer spoke last yet the ticket still sits in pending — the stage was
  // never flipped and nobody replied. Reminder tags belong to a previous
  // cycle here, so they are ignored.
  if (lc && la && lc > la) {
    if (nowMs - lc < ATTENTION_RULES.PENDING_CUSTOMER_REPLY_GRACE_MS) return null;
    return `Customer replied ${daysAgo(lc, nowMs)}d ago and is still waiting on us`;
  }
  if (!la) return null;

  const bd = businessDaysSince(la, nowMs);
  const {
    PENDING_FIRST_FOLLOWUP_BD,
    PENDING_NEXT_FOLLOWUP_BD,
    PENDING_GRACE_BD,
    PENDING_FINAL_CLOSE_BD,
  } = ATTENTION_RULES;

  if (hasTagIn(t, FINAL_REMINDER_TAGS)) {
    if (bd < PENDING_FINAL_CLOSE_BD) return null;
    return `Final reminder sent ${daysAgo(la, nowMs)}d ago with no reply — close the ticket`;
  }
  if (hasTagIn(t, SECOND_REMINDER_TAGS)) {
    if (bd < PENDING_NEXT_FOLLOWUP_BD + PENDING_GRACE_BD) return null;
    return `Second reminder sent ${daysAgo(la, nowMs)}d ago — final follow-up is overdue, automation may be stuck`;
  }
  if (hasTagIn(t, FIRST_REMINDER_TAGS)) {
    if (bd < PENDING_NEXT_FOLLOWUP_BD + PENDING_GRACE_BD) return null;
    return `First reminder sent ${daysAgo(la, nowMs)}d ago — second follow-up is overdue, automation may be stuck`;
  }
  if (bd < PENDING_FIRST_FOLLOWUP_BD + PENDING_GRACE_BD) return null;
  return `Pending ${daysAgo(la, nowMs)}d with no follow-up sent — automation never fired, nudge manually`;
};

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
    // Awaiting customer — flags only when the follow-up automation is off
    // track (never started / stalled / exhausted) or a customer reply was
    // left hanging. Healthy auto-reminders refresh devu_ts on their own and
    // keep the ticket out of the queue. Shared with the verify path.
    const reason = pendingBlockReason(t, nowMs);
    if (!reason) return null;
    return { bucket, rule: "pending-silent", reason, needsIssCheck: false };
  }

  if (bucket === "onHold") {
    // Waiting on CleverTap — even if the linked ISS is being worked, the
    // customer must hear from us every 2 days. Pure silence rule; the linked
    // ISS's age does not matter.
    const la = lastAgentExternalMs(t) ?? createdMs;
    if (!la || nowMs - la < ATTENTION_RULES.ONHOLD_AGENT_SILENCE_DAYS * DAY_MS) return null;
    return {
      bucket,
      rule: "onhold-stale",
      reason: `Customer hasn't heard from us in ${daysAgo(la, nowMs)}d`,
    };
  }

  return null; // "other" stages (New, queued, Waiting on CSM…) are out of scope
};

/**
 * Build queue items for a member's active tickets. Runs entirely off the
 * cached ticket objects — no DevRev calls needed at build time.
 */
export const buildItems = async (tickets, nowMs = Date.now()) => {
  const items = [];
  for (const t of tickets) {
    const verdict = evaluateTicket(t, nowMs);
    if (!verdict) continue;

    const item = {
      display_id: t.display_id,
      ticket_id: t.id || null, // DON id — RemarkPopover needs it for DevRev comment sync
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

    items.push(item);
  }
  // Longest silence first: the ticket whose customer has waited longest for
  // ANY outbound word from us sits on top (per Rohan 2026-08-03).
  items.sort((a, b) => {
    const ka = new Date(a.last_agent_external_ts || a.created_date || 0).getTime();
    const kb = new Date(b.last_agent_external_ts || b.created_date || 0).getTime();
    return ka - kb;
  });
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
      // Roster sometimes suffixes shifts with markers ("Shift 4*") — strip
      // anything after the shift number or the SHIFT_HOURS lookup misses.
      shift: (r.shift || "").toUpperCase().replace(/[^A-Z0-9 ]+/g, "").trim(),
      slackMention: extractSlackMention(r.slack_id),
    }))
    .filter((r) => r.name); // silently ignore rows we can't map to a GST member
};

// ── Slack ────────────────────────────────────────────────────────────────
// Posts to the dedicated attention webhook (test channel for the pilot).
// Deliberately NOT the NOC/reconcile webhook — different audience.

const attentionWebhook = () => process.env.ATTENTION_SLACK_WEBHOOK_URL;

// Mentions only make sense once this runs in the OFFICIAL workspace (the
// roster's slack_ids don't resolve in the test workspace — they render as
// blank). Until then messages use plain bold names. Flip by setting
// ATTENTION_SLACK_MENTIONS=true; slack_id is stored on every queue doc, so
// nothing else needs to change.
const useMentions = () => process.env.ATTENTION_SLACK_MENTIONS === "true";

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

/**
 * Members' active tickets — live from DevRev (streamed, due-members only),
 * Redis cache only as an outage fallback.
 *
 * GUARD (bug 2026-08-02, twice): a sweep with no ticket source would build
 * EMPTY queues ("Superstar!" for someone with 20+ aging tickets) and wedge
 * the member's day. So when BOTH DevRev and the cache are unavailable:
 *   - cron run  → throw (BullMQ retries, and the 30-min build window means
 *     a later 15-min sweep still covers it)
 *   - force run → fall back to the partial sync keys so demos still work
 *   - everything empty → always throw, never build
 */
const activeTicketsByMember = async ({ allowPartial = false, onlyMembers = null } = {}) => {
  // PRIMARY PATH: live page-by-page stream from DevRev, keeping ONLY the due
  // members' tickets (trimmed to the cache shape). The sweep no longer
  // touches the 20-60MB tickets:active blob at all — we already know who is
  // due from the roster, so we never need every ticket at once. This also
  // decouples queue builds from the hourly sync: queue times (16:00, 19:00)
  // sit exactly on the hour, and a full-blob parse stacked on a running sync
  // in the same 512MB process is what OOM-killed shift 1/2 builds.
  try {
    const byMember = new Map();
    await streamActiveFromDevRev(async (works) => {
      for (const t of works) {
        if (isSolvedStatus(t.stage?.name)) continue;
        const owner = resolveOwnerName(t.owned_by?.[0]?.display_name);
        if (!owner) continue;
        if (onlyMembers && !onlyMembers.has(owner)) continue;
        if (!byMember.has(owner)) byMember.set(owner, []);
        byMember.get(owner).push(trimTicket(t));
      }
    });
    return byMember;
  } catch (e) {
    logger.warn({ err: e.message }, "Attention sweep: live DevRev stream failed — falling back to Redis cache");
  }

  // FALLBACK (DevRev unreachable): the old cache path. Parses the full blob,
  // so it only runs on DevRev outages — rare by construction.
  let cached = (await redisGet("tickets:active")) || [];
  if (!cached.length) {
    if (!allowPartial) {
      throw new Error("Attention sweep: DevRev unreachable and tickets:active cache empty — retry later");
    }
    cached = (await redisGet("tickets:syncing")) || (await redisGet("tickets:active:initial")) || [];
    if (!cached.length) {
      throw new Error("Attention sweep: no ticket source available at all — retry later");
    }
    logger.warn({ count: cached.length }, "Attention sweep: using PARTIAL ticket cache (forced run during sync)");
  }
  const byMember = new Map();
  for (const t of cached) {
    if (isSolvedStatus(t.stage?.name)) continue;
    const owner = resolveOwnerName(t.owned_by?.[0]?.display_name);
    if (!owner) continue;
    if (onlyMembers && !onlyMembers.has(owner)) continue;
    if (!byMember.has(owner)) byMember.set(owner, []);
    byMember.get(owner).push(t);
  }
  return byMember;
};

/**
 * First-escalation instant for a queue built today, from ATTENTION_TIMING —
 * derived locally, NOT from the roster API (which serves today only).
 * Same IST day for the overnight SHIFT 4 (queue posts 05:30 and the
 * member's next shift starts the same evening — this fixes the old
 * "tomorrow at shift start" bug that made SHIFT 4 escalations a day late);
 * next day for the day shifts.
 */
const escalationInstant = (shift, fromMs) => {
  const t = ATTENTION_TIMING[shift];
  if (!t) return null; // "MANUAL" test queues get no escalation clock
  const day = t.escalateNextDay ? new Date(fromMs + DAY_MS) : new Date(fromMs);
  return istInstant(istYmd(day), t.escalateAt);
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
    next_shift_start_at: items.length ? escalationInstant(candidate.shift, nowMs) : null,
    status,
    items,
  });

  const mention = useMentions() ? candidate.slackMention : null;
  if (status === "empty") {
    await postSlack(`🌟 Superstar — no tickets in the attention queue today, ${mention || `*${candidate.name}*`}! Enjoy the end of your shift.`);
  } else {
    await postSlack(queueMessage(queue, mention));
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
//   pending — the shared pendingBlockReason rule re-run on fresh data: any
//             org-side external reply (agent nudge or automation catching
//             up) resets the clock, or the ticket left the bucket.
//   onHold  — org-side external message within the 2-day window, or ticket
//             left the bucket.

const itemStillBlocked = (item, fresh, queueCreatedMs, nowMs) => {
  const stageName = fresh.stage?.name;
  if (isSolvedStatus(stageName)) return null;
  const bucket = bucketForStage(stageName);
  if (bucket !== item.bucket) return null; // moved on — whatever they did worked
  const la = lastAgentExternalMs(fresh);

  if (item.bucket === "open") {
    if (hasReminderTag(fresh)) return null;
    if (la && la >= istTodayStartMs()) return null;
    return "Still no external reply to the customer today";
  }
  if (item.bucket === "pending") {
    return pendingBlockReason(fresh, nowMs);
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

  // Partial-verify: an internal dashboard remark added AFTER the queue was
  // built means the member is actively tracking the ticket. Such items stop
  // alerting (Slack / TL escalation) but stay visible for managers — only a
  // real DevRev action fully clears them (per Rohan 2026-08-03).
  const openIds = queue.items.filter((i) => i.status !== "cleared").map((i) => i.display_id);
  let remarkedIds = new Set();
  if (openIds.length) {
    try {
      const remarks = await Remark.find(
        { ticketId: { $in: openIds }, timestamp: { $gt: queue.created_at } },
        { ticketId: 1 },
      ).lean();
      remarkedIds = new Set(remarks.map((r) => r.ticketId));
    } catch (e) {
      logger.warn({ err: e.message }, "Attention verify: remark lookup failed — treating none as tracked");
    }
  }

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
      if (remarkedIds.has(item.display_id)) {
        if (item.status !== "partial") item.partial_at = new Date();
        item.status = "partial";
      } else {
        item.status = "pending"; // remark gone/expired → back to alerting
      }
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
    const who = useMentions() && queue.slack_id ? queue.slack_id : `*${queue.member}*`;
    await postSlack(
      `✅ ${who} cleared their attention queue — *${queue.items.length} ticket${queue.items.length === 1 ? "" : "s"}* actioned. 👏`,
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
  const who = useMentions() && queue.slack_id ? queue.slack_id : `*${queue.member}*`;
  const tl = tlMention ? ` cc ${tlMention}` : "";
  const tracked = queue.items.filter((i) => i.status === "partial").length;
  return (
    `🚨 Attention queue from ${queue.shift_date} is still open — ${who} has *${remaining} unactioned ticket${remaining === 1 ? "" : "s"}*${tl}\n` +
    queue.items
      .filter((i) => i.status === "pending") // partial = being tracked, no page
      .map((i) => `• <${TICKET_URL(i.display_id)}|${i.display_id}> — ${i.block_reason || i.reason}`)
      .join("\n") +
    (tracked ? `\n_+${tracked} more being tracked (remark added) — visible on the dashboard._` : "") +
    `\nThis alert repeats hourly until the queue is cleared.`
  );
};

const runEscalations = async (rosterRows, nowMs) => {
  // next_shift_start_at stores the exact first-escalation instant (per-shift
  // ATTENTION_TIMING) — due the moment it passes, then hourly.
  const due = await AttentionQueue.find({
    status: "pending",
    next_shift_start_at: { $ne: null, $lte: new Date(nowMs) },
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

    // Only truly-unactioned items page the TL — "partial" (remark-tracked)
    // tickets are deliberately excluded from alerting.
    const remaining = updated.items.filter((i) => i.status === "pending").length;
    if (remaining === 0) {
      logger.info({ member: q.member }, "Attention escalation skipped — all remaining items are remark-tracked");
      continue;
    }
    // TL comes from the TEAMS mapping in constants.js (per team decision —
    // never from the roster API). The roster row / Slack map only resolve
    // the TL's mention id.
    const leadName = TEAM_MAPPING[q.member]?.team || null;
    const tlRow = leadName ? rosterRows.find((r) => r.name === leadName) : null;
    const tlMention = !leadName
      ? null
      : useMentions()
        ? tlRow?.slackMention || findGSTMember(leadName) || `*${leadName}* (TL)`
        : `*${leadName}* (TL)`;

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
 * Runs every 15 minutes. Builds queues for members whose per-shift queue
 * time (ATTENTION_TIMING) has arrived — with a 30-min late-tick tolerance,
 * and once per member per shift-date (the unique index makes duplicate
 * builds impossible) — then processes escalations.
 *
 * @param {Object} opts
 * @param {boolean} opts.force  Build regardless of the queue window (testing).
 * @param {string}  opts.member Restrict to one canonical member name (testing).
 */
export const runAttentionSweep = async ({ force = false, member = null } = {}) => {
  const nowMs = Date.now();
  const todayYmd = istYmd();
  const roster = await fetchRosterShifts();

  // Candidate shifts for today, with per-shift queue times from
  // ATTENTION_TIMING. The roster API serves TODAY only, so the overnight
  // SHIFT 4 is handled from today's row: a member rostered SHIFT 4 today
  // gets their queue at 05:30 IST (near the morning end of the overnight
  // shift). Known boundary quirk, accepted for v1: on the FIRST day of a
  // shift-4 block the morning queue fires before their first night; the
  // morning after the LAST day is missed.
  const candidates = [];
  for (const r of roster) {
    const timing = ATTENTION_TIMING[r.shift];
    const hours = SHIFT_HOURS[r.shift];
    if (!timing || !hours) continue; // ON CALL / off statuses / unknown shifts
    candidates.push({
      ...r,
      shiftDate: todayYmd,
      queueAt: istInstant(todayYmd, timing.queueAt),
      endAt: istInstant(todayYmd, hours.end),
    });
  }

  // Force-testing for a member who isn't on a working shift today (demo on a
  // week-off day): synthesize a candidate. shift "MANUAL" has no SHIFT_HOURS
  // entry, so no escalation clock gets set for these test queues.
  if (force && member && !candidates.some((c) => c.name === member)) {
    const row = roster.find((r) => r.name === member);
    const email =
      row?.email ||
      Object.keys(EMAIL_TO_NAME_MAP).find((e) => EMAIL_TO_NAME_MAP[e] === member) ||
      null;
    candidates.push({
      name: member,
      email,
      shift: row?.shift && SHIFT_HOURS[row.shift] ? row.shift : "MANUAL",
      slackMention: row?.slackMention || findGSTMember(member),
      shiftDate: todayYmd,
      queueAt: new Date(nowMs),
      endAt: new Date(nowMs + BUILD_WINDOW_MS),
    });
  }

  // Decide who is actually due BEFORE touching the ticket cache. Parsing the
  // full tickets:active blob is by far the most expensive thing this job does
  // — this process is the API + every worker in 512MB, and recurring parses
  // OOM-killed the Render instance on 2026-08-03. 90+% of sweeps have nobody
  // in a build window and must not load the cache at all (escalations never
  // need it — they verify per-ticket against live DevRev).
  const due = [];
  for (const c of candidates) {
    if (member && c.name !== member) continue;
    const inWindow = nowMs >= c.queueAt.getTime() && nowMs <= c.queueAt.getTime() + BUILD_WINDOW_MS;
    if (!force && !inWindow) continue;

    // force + member = REPLACE any existing queue for today, so repeated
    // test runs actually rebuild (and a queue built against a cold/empty
    // ticket cache doesn't wedge the whole day). Cron runs still build at
    // most once per member per shift-date.
    if (force && member) {
      await AttentionQueue.deleteOne({ member: c.name, shift_date: c.shiftDate });
    } else {
      const exists = await AttentionQueue.findOne({ member: c.name, shift_date: c.shiftDate }, { _id: 1 }).lean();
      if (exists) continue;
    }
    due.push(c);
  }

  const built = [];
  if (due.length) {
    const ticketsByMember = await activeTicketsByMember({
      allowPartial: force,
      onlyMembers: new Set(due.map((c) => c.name)),
    });
    for (const c of due) {
      try {
        built.push(await buildQueueForMember(c, ticketsByMember, nowMs));
      } catch (e) {
        // Unique-index race between two sweeps is harmless; log everything else.
        if (e.code !== 11000) logger.error({ err: e, member: c.name }, "Attention queue build failed");
      }
    }
  }

  await runEscalations(roster, nowMs);

  // Auto-clear: once an hour (the :30-UTC tick — offset from the :00-UTC
  // hourly sync) re-verify every recent pending queue so a ticket the member
  // actioned in DevRev disappears within the hour, no Verify click needed.
  // Per-ticket live lookups only — small queues, no cache, no blob.
  const utcMinute = new Date(nowMs).getUTCMinutes();
  if (utcMinute >= 30 && utcMinute < 45) {
    const openQueues = await AttentionQueue.find(
      { status: "pending", created_at: { $gte: new Date(nowMs - 2 * DAY_MS) } },
      { member: 1 },
    ).lean();
    for (const q of openQueues) {
      try {
        await verifyAndClearQueue(q.member, "auto");
      } catch (e) {
        logger.warn({ err: e.message, member: q.member }, "Attention auto-verify failed");
      }
    }
    if (openQueues.length) logger.info({ queues: openQueues.length }, "Attention auto-verify pass done");
  }

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

/**
 * Latest queue per member (any status), in one round-trip — powers the team
 * panel. Returns entries in the same order as `members`; members with no
 * queue yet come back with queue: null so the panel can still show them.
 */
export const getQueuesForMembers = async (members) => {
  if (!members?.length) return [];
  const docs = await AttentionQueue.aggregate([
    { $match: { member: { $in: members } } },
    { $sort: { created_at: -1 } },
    { $group: { _id: "$member", doc: { $first: "$$ROOT" } } },
  ]);
  const byMember = new Map(docs.map((d) => [d._id, d.doc]));
  return members.map((m) => ({ member: m, queue: byMember.get(m) || null }));
};

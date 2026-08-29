/**
 * attention/alerts — Shift-end summary and the next-day 'no action' escalation.
 *
 * Extracted from the 1426-line attentionService.js; the logic below is
 * unchanged. See attention/index.js for the feature-level documentation
 * of what the Attention Queue does and the rules it enforces.
 */

import logger from "../../config/logger.js";
import { getTeamSlackChannel } from "../../config/constants.js";
import { AttentionQueue } from "../../models/index.js";
import { ATTENTION_TIMING, DAY_MS } from "./config.js";
import { noActionMessage, postAlert, shiftEndSummaryMessage } from "./slack.js";
import { isWeekendIst, istInstant, istYmd } from "./time.js";
import { verifyAndClearQueue } from "./verification.js";

// ── Shift-end Slack summary ──────────────────────────────────────────────

// Post at most this long after the scheduled slackAt. Past it (service was
// down through the whole window) the shift is over — a "before your shift
// ends" ping would land mid-night; the queue still escalates tomorrow.
const ALERT_LATE_TOLERANCE_MS = 2 * 60 * 60 * 1000;

/**
 * Post the shift-end Slack summary for every queue whose slackAt has passed
 * and hasn't been messaged yet — ONE batched message per shift, one line per
 * member. Runs every sweep tick; `shift_alert_sent_at` makes it once-per-
 * queue. The returned Slack ts is stored on every queue in the batch as
 * `slack_thread_ts`, so each member's next-day "no action" alert can reply
 * in this exact thread. Counts reflect live item statuses, so anything
 * actioned or remark-tracked between build (T-45) and now has dropped out.
 */
export const runShiftEndAlerts = async (nowMs) => {
  const due = await AttentionQueue.find({
    shift_alert_at: { $ne: null, $lte: new Date(nowMs) },
    shift_alert_sent_at: null,
  });
  if (!due.length) return;

  // Slack is Mon–Fri only (Rohan 2026-08-09): weekend queues still build for
  // the dashboard, but their shift-end summary is suppressed outright — not
  // deferred, because "before your shift ends" posted on Monday is stale.
  // Marking sent keeps them out of the due-query for the rest of the weekend.
  if (isWeekendIst(nowMs)) {
    for (const q of due) {
      q.shift_alert_sent_at = new Date(nowMs);
      await q.save();
    }
    logger.info({ queues: due.length }, "Attention shift-end summaries suppressed — weekend");
    return;
  }

  // Group by shift (+date, defensive) AND team channel — each team gets its
  // own message in its own channel (Rohan 2026-08-10). A member with no team
  // channel (teamless, or slackChannel unset) is retired like the weekend
  // path — marked sent, never posted — instead of retrying every sweep.
  // A late-recovered old window is skipped, not posted stale.
  const groups = new Map();
  for (const q of due) {
    if (nowMs - q.shift_alert_at.getTime() > ALERT_LATE_TOLERANCE_MS) {
      q.shift_alert_sent_at = new Date(nowMs);
      await q.save();
      logger.warn({ member: q.member, shiftDate: q.shift_date }, "Attention shift-end alert skipped — window long past");
      continue;
    }
    const channel = getTeamSlackChannel(q.member);
    if (!channel) {
      q.shift_alert_sent_at = new Date(nowMs);
      await q.save();
      logger.info({ member: q.member, shiftDate: q.shift_date }, "Attention shift-end alert skipped — member has no team channel");
      continue;
    }
    const key = `${q.shift}|${q.shift_date}|${channel}`;
    if (!groups.has(key)) groups.set(key, { channel, queues: [] });
    groups.get(key).queues.push(q);
  }

  for (const { channel, queues } of groups.values()) {
    try {
      const { ok, ts } = await postAlert({
        kind: "shift_end_summary",
        text: shiftEndSummaryMessage(queues),
        channel,
      });
      if (!ok) continue; // post failed — next sweep tick retries the whole group
      for (const q of queues) {
        q.shift_alert_sent_at = new Date(nowMs);
        q.slack_thread_ts = ts;
        await q.save();
      }
      logger.info(
        { shift: queues[0].shift, channel, members: queues.length, threaded: !!ts },
        "Attention shift-end summary sent",
      );
    } catch (e) {
      logger.error({ err: e, shift: queues[0]?.shift }, "Attention shift-end alert failed");
    }
  }
};

// ── Escalation (next-day "no action" thread reply) ──────────────────────
// Reworked 2026-08-05 (Rohan): at the per-shift escalation instant (e.g.
// 8:45 AM for shift 1 — ~45 min into the member's next shift) re-verify the
// queue against live DevRev; whatever still violates its rule gets posted as
// a minimal "no action" list — bare clickable ticket IDs, stage-wise,
// TRACKED included — as a REPLY IN THE SAME SLACK THREAD as that queue's
// shift-end summary. No TL cc, no reasons (the old verbose TL page).
// ONE-SHOT (Rohan 2026-08-08): fires exactly once per queue — hourly repeats
// read as spam. A successful post nulls next_shift_start_at, permanently
// removing the queue from the due-query; a FAILED post keeps the clock so
// the next 15-min sweep retries until one post lands.

export const runEscalations = async (nowMs) => {
  // next_shift_start_at stores the exact escalation instant (per-shift
  // ATTENTION_TIMING) — due the moment it passes, nulled after the one post.
  const due = await AttentionQueue.find({
    status: "pending",
    next_shift_start_at: { $ne: null, $lte: new Date(nowMs) },
  });

  // Slack is Mon–Fri only (Rohan 2026-08-09). escalationInstant() never
  // schedules onto a weekend anymore, but a clock stamped before that fix —
  // or one that drifted here via retries — must be SLID, not just skipped:
  // a past-due instant left in place would fire at the first sweep after
  // Sunday midnight. Reschedule to the next business day at the queue's own
  // shift escalation time (e.g. Monday 8:45 AM for a SHIFT 1 queue).
  if (isWeekendIst(nowMs)) {
    for (const q of due) {
      const t = ATTENTION_TIMING[q.shift];
      let day = new Date(nowMs + DAY_MS);
      while (isWeekendIst(day.getTime())) day = new Date(day.getTime() + DAY_MS);
      q.next_shift_start_at = t ? istInstant(istYmd(day), t.escalateAt) : null;
      await q.save();
    }
    if (due.length) logger.info({ queues: due.length }, "Attention escalations slid past weekend");
    return;
  }

  // One escalation per MEMBER, driven by their newest pending queue.
  // Older still-pending docs for the same member get their clock nulled —
  // their tickets re-flag into the newest build anyway, and without the
  // null they'd match the due-query on every sweep forever.
  const newestByMember = new Map();
  for (const q of due) {
    const prev = newestByMember.get(q.member);
    if (!prev || q.created_at > prev.created_at) newestByMember.set(q.member, q);
  }
  const superseded = due.filter((q) => newestByMember.get(q.member) !== q);
  if (superseded.length) {
    await AttentionQueue.updateMany(
      { _id: { $in: superseded.map((q) => q._id) } },
      { $set: { next_shift_start_at: null } },
    );
  }

  for (const q of newestByMember.values()) {
    // ONE-SHOT: a queue that already got its follow-up (e.g. under the old
    // hourly behaviour, before its clock was nulled) never fires again.
    if (q.escalation?.alert_count > 0) {
      q.next_shift_start_at = null;
      await q.save();
      continue;
    }

    // Deliberately NO leave-skip here (team decision 2026-08-02): the channel
    // is private and pings are personal, so an open queue still gets its one
    // follow-up on the member's day off — teammates can action the tickets,
    // and the auto-verify below silences it once they do.

    // Auto-verify first — never alert over work that was actually done but
    // not clicked through. This also refreshes which items still violate
    // their rule ("tickets that still satisfy the condition").
    const updated = await verifyAndClearQueue(q.member, "escalation");
    if (!updated || updated.status !== "pending") continue;

    // Actionable items decide WHETHER the alert fires (an all-tracked queue
    // auto-clears in verify and never reaches here) — but the list itself
    // includes tracked items too: still-violating is still-violating.
    const remaining = updated.items.filter((i) => i.status === "pending").length;
    if (remaining === 0) continue;

    // No team channel (teamless member / slackChannel unset) → retire the
    // clock for good; without the null, "failed post keeps the clock" would
    // retry this un-sendable alert every sweep forever (Rohan 2026-08-10).
    const channel = getTeamSlackChannel(updated.member);
    if (!channel) {
      updated.next_shift_start_at = null;
      await updated.save();
      logger.info({ member: updated.member }, "Attention no-action alert skipped — member has no team channel");
      continue;
    }

    const { ok } = await postAlert({
      kind: "no_action_followup",
      text: noActionMessage(updated),
      channel,
      threadTs: updated.slack_thread_ts || null, // no ts (webhook fallback) → plain channel post
    });
    if (!ok) continue; // failed post keeps the clock — next 15-min sweep retries
    updated.escalation = {
      alert_count: (updated.escalation?.alert_count || 0) + 1,
      last_alert_at: new Date(nowMs),
    };
    // The one follow-up has been sent — retire this queue's escalation clock.
    updated.next_shift_start_at = null;
    await updated.save();
    logger.info(
      { member: q.member, remaining, threaded: !!updated.slack_thread_ts },
      "Attention no-action alert sent (one-shot)",
    );
  }
};

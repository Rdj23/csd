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
import { fetchRosterShifts, fetchRosterShiftsForDate } from "./roster.js";
import { noActionMessage, postAlert, shiftEndSummaryMessage } from "./slack.js";
import { isWeekendIst, istInstant, istYmd, istYmdShift, ymdToDMmm } from "./time.js";
import { verifyAndClearQueue } from "./verification.js";

// ── Shift-end Slack summary ──────────────────────────────────────────────

// Post at most this long after the scheduled slackAt. Past it (service was
// down through the whole window) the shift is over — a "before your shift
// ends" ping would land mid-night; the queue still escalates tomorrow.
const ALERT_LATE_TOLERANCE_MS = 2 * 60 * 60 * 1000;

// Same bound for escalation retries. A post that has failed for two hours is
// not going to start working, and a follow-up that lands hours late is noise.
const ESCALATION_LATE_TOLERANCE_MS = 2 * 60 * 60 * 1000;

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
      // CLAIM BEFORE SENDING — see the long note in runEscalations. Same trap:
      // `ok` reports whether n8n answered us, not whether Slack got the
      // message, so retrying on !ok duplicates a summary that in fact landed.
      // Marking sent first makes this at-most-once, and the atomic predicate
      // stops the hybrid topology's two schedulers double-posting a group.
      const claim = await AttentionQueue.updateMany(
        { _id: { $in: queues.map((q) => q._id) }, shift_alert_sent_at: null },
        { $set: { shift_alert_sent_at: new Date(nowMs) } },
      );
      if (!claim.modifiedCount) continue; // another sweep already sent this group

      const { ok, ts } = await postAlert({
        kind: "shift_end_summary",
        text: shiftEndSummaryMessage(queues),
        channel,
      });
      if (!ok) {
        logger.error(
          { shift: queues[0].shift, channel, members: queues.length },
          "Attention shift-end summary could not be delivered — dropped, not retried (see postAlert logs)",
        );
        continue;
      }
      // The thread anchor is only known after a successful post; the next-day
      // follow-up falls back to a plain channel post when it is missing.
      if (ts) {
        await AttentionQueue.updateMany(
          { _id: { $in: queues.map((q) => q._id) } },
          { $set: { slack_thread_ts: ts } },
        );
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

// ── Shift-continuity gate ────────────────────────────────────────────────
// Rohan 2026-08-31, after a rotation Monday: Anurag finished FRIDAY on SHIFT 1
// and started MONDAY on SHIFT 2. His Friday queue had stamped its escalation
// instant at build time from SHIFT 1 (08:45), so the follow-up fired 105 min
// BEFORE he started work — and, because the retirement never landed on the
// document the due-query matched, it re-fired every 15 minutes all morning.
//
// A "no action before your shift ends" nudge only means anything when it lands
// inside the SAME shift the queue was built for. So the roster — not a value
// frozen at build time — now decides whether an escalation fires at all:
//
//   1. the queue is from the day immediately BEFORE the escalation day
//      (the SAME day for the overnight SHIFT 4, whose escalation is same-day);
//   2. the member was genuinely rostered that shift ON the queue's day —
//      not merely assumed, which is what the Week-Off fallback does; and
//   3. they are rostered the SAME shift TODAY.
//
// Anything else retires the clock silently. Nothing is lost: the tickets
// re-flag into the member's next build anyway.
//
// MONDAY NEEDS NO SPECIAL CASE. Yesterday was Sunday, when nobody is rostered
// a real shift, so rule 2 fails for every member and no escalation posts on a
// Monday morning — "Monday just builds the queue", exactly as asked, without
// hardcoding a weekday anywhere.
//
// This supersedes the 2026-08-02 "no leave-skip" decision for escalations
// specifically: a member with no working shift today no longer gets the
// follow-up, because there is no shift for it to land 45 minutes into.

/** The member's rostered shift on a day, or null for off-statuses/unknowns. */
export const rosteredShift = (rows, member) => {
  const shift = rows.find((r) => r.name === member)?.shift || null;
  return shift && ATTENTION_TIMING[shift] ? shift : null;
};

/**
 * Pure continuity decision — kept free of Mongo and HTTP so it can be tested
 * directly (tests/attentionRules.test.js).
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
export const escalationContinuity = ({
  queueShift,
  queueShiftDate,
  todayYmd,
  shiftToday,
  shiftOnQueueDay,
}) => {
  if (!shiftToday) return { ok: false, reason: "not rostered a working shift today" };
  if (shiftToday !== queueShift) {
    return { ok: false, reason: `shift changed (${queueShift} → ${shiftToday})` };
  }
  // SHIFT 4 escalates on the queue's OWN day (escalateNextDay: false) because
  // the overnight shift starts that evening; every day shift escalates the
  // morning after. A queue older than that is stale by definition.
  const expectedQueueDay = ATTENTION_TIMING[queueShift]?.escalateNextDay === false
    ? todayYmd
    : istYmdShift(todayYmd, -1);
  if (queueShiftDate !== expectedQueueDay) {
    return { ok: false, reason: `queue is from ${queueShiftDate}, expected ${expectedQueueDay}` };
  }
  if (shiftOnQueueDay !== queueShift) {
    return { ok: false, reason: `was not rostered ${queueShift} on ${queueShiftDate}` };
  }
  return { ok: true };
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

  if (!newestByMember.size) return;

  // Today's roster drives every continuity decision below; past days are
  // fetched on demand and memoised, so a sweep makes at most two roster calls
  // (both Redis-cached) no matter how many queues are due.
  const todayYmd = istYmd(new Date(nowMs));
  const todayRoster = await fetchRosterShifts();
  const rosterCache = new Map([[todayYmd, todayRoster]]);
  const rosterOn = async (ymd) => {
    if (!rosterCache.has(ymd)) rosterCache.set(ymd, await fetchRosterShiftsForDate(ymdToDMmm(ymd)));
    return rosterCache.get(ymd);
  };

  /** Retire a clock so the due-query stops matching this queue. */
  const retire = async (queue, reason) => {
    queue.next_shift_start_at = null;
    await queue.save();
    logger.info(
      { member: queue.member, shift: queue.shift, shiftDate: queue.shift_date, reason },
      "Attention no-action alert skipped",
    );
  };

  for (const q of newestByMember.values()) {
    // ONE-SHOT: a queue that already got its follow-up (e.g. under the old
    // hourly behaviour, before its clock was nulled) never fires again.
    if (q.escalation?.alert_count > 0) {
      q.next_shift_start_at = null;
      await q.save();
      continue;
    }

    // A post that keeps failing must not retry forever — the summary path has
    // had this bound since day one (ALERT_LATE_TOLERANCE_MS) and the
    // escalation path never did, which is how one undeliverable alert turned
    // into a message every 15 minutes for hours.
    if (nowMs - q.next_shift_start_at.getTime() > ESCALATION_LATE_TOLERANCE_MS) {
      await retire(q, "escalation window long past");
      continue;
    }

    // SHIFT CONTINUITY — see the block comment above. The roster decides;
    // a value frozen at build time does not.
    const verdict = escalationContinuity({
      queueShift: q.shift,
      queueShiftDate: q.shift_date,
      todayYmd,
      shiftToday: rosteredShift(todayRoster, q.member),
      shiftOnQueueDay: rosteredShift(await rosterOn(q.shift_date), q.member),
    });
    if (!verdict.ok) {
      await retire(q, verdict.reason);
      continue;
    }

    // Auto-verify first — never alert over work that was actually done but
    // not clicked through. This also refreshes which items still violate
    // their rule ("tickets that still satisfy the condition").
    // Scoped to THIS queue's _id: verify used to re-query for the member's
    // newest pending queue, so when that was a different document every
    // retirement below landed on the wrong row and `q` re-fired forever.
    const updated = await verifyAndClearQueue(q.member, "escalation", q._id);
    if (!updated || updated.status !== "pending") {
      await retire(q, "queue cleared before escalation");
      continue;
    }

    // Actionable items decide WHETHER the alert fires (an all-tracked queue
    // auto-clears in verify and never reaches here) — but the list itself
    // includes tracked items too: still-violating is still-violating.
    const remaining = updated.items.filter((i) => i.status === "pending").length;
    if (remaining === 0) {
      await retire(updated, "nothing actionable left");
      continue;
    }

    // No team channel (teamless member / slackChannel unset) → retire the
    // clock for good; without the null, "failed post keeps the clock" would
    // retry this un-sendable alert every sweep forever (Rohan 2026-08-10).
    const channel = getTeamSlackChannel(updated.member);
    if (!channel) {
      await retire(updated, "member has no team channel");
      continue;
    }

    // CLAIM BEFORE SENDING — at-most-once (Rohan 2026-08-31).
    //
    // This used to retire the clock only AFTER a successful post, which made
    // the guard depend on `ok`. But `ok` means "our HTTP call to n8n
    // succeeded", NOT "Slack received it": n8n can post the message and still
    // fail to answer us (timeout, a broken Respond-to-Webhook node, a non-2xx
    // from a later node). Every one of those looked like a failure worth
    // retrying while the member was already looking at the message.
    //
    // Retrying an outbound ping is the wrong default here anyway — Rohan
    // 2026-08-08, "hourly repeats read as spam". A missed follow-up costs
    // nothing (the tickets re-flag into the next build); a duplicate one
    // costs trust in the whole channel. So the claim happens FIRST, and a
    // genuinely failed send is logged and dropped rather than retried.
    //
    // The `next_shift_start_at: { $ne: null }` predicate makes the claim
    // atomic: whoever flips it wins, so the two sweep schedulers in the
    // hybrid topology (server.js + worker.js) can never both post.
    const claimed = await AttentionQueue.findOneAndUpdate(
      { _id: updated._id, next_shift_start_at: { $ne: null } },
      {
        $set: { next_shift_start_at: null, "escalation.last_alert_at": new Date(nowMs) },
        $inc: { "escalation.alert_count": 1 },
      },
      { new: true },
    );
    if (!claimed) continue; // another sweep already claimed this escalation

    const { ok } = await postAlert({
      kind: "no_action_followup",
      text: noActionMessage(updated),
      channel,
      threadTs: updated.slack_thread_ts || null, // no ts (webhook fallback) → plain channel post
    });
    if (!ok) {
      logger.error(
        { member: updated.member, shiftDate: updated.shift_date, remaining },
        "Attention no-action alert could not be delivered — dropped, not retried (see postAlert logs)",
      );
      continue;
    }
    logger.info(
      { member: q.member, remaining, threaded: !!updated.slack_thread_ts },
      "Attention no-action alert sent (one-shot)",
    );
  }
};

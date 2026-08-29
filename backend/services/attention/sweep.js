/**
 * attention/sweep — The repeatable job entry point + dashboard queue queries.
 *
 * Extracted from the 1426-line attentionService.js; the logic below is
 * unchanged. See attention/index.js for the feature-level documentation
 * of what the Attention Queue does and the rules it enforces.
 */

import logger from "../../config/logger.js";
import { EMAIL_TO_NAME_MAP, SHIFT_HOURS } from "../../config/constants.js";
import { AttentionQueue } from "../../models/index.js";
import { findGSTMember } from "../slackService.js";
import { runEscalations, runShiftEndAlerts } from "./alerts.js";
import { ATTENTION_TIMING, BUILD_WINDOW_MS, DAY_MS } from "./config.js";
import { activeTicketsByMember, buildQueueForMember } from "./queueBuilder.js";
import { fetchRosterShifts } from "./roster.js";
import { istInstant, istYmd } from "./time.js";
import { verifyAndClearQueue } from "./verification.js";

// ── The sweep (repeatable job entry point) ───────────────────────────────

/**
 * Runs every 15 minutes. Builds queues for members whose per-shift queue
 * time (ATTENTION_TIMING) has arrived — with a 30-min late-tick tolerance,
 * and once per member per shift-date (the unique index makes duplicate
 * builds impossible) — then posts due shift-end Slack summaries, then
 * processes escalations.
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
  // gets their queue at 06:00 IST (near the morning end of the overnight
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
      slackAt: istInstant(todayYmd, timing.slackAt),
      endAt: istInstant(todayYmd, hours.end),
    });
  }

  // EVERY member, EVERY day (Rohan 2026-08-12): the roster used to be the
  // gate — a missing/invalid/off-status row silently dropped the member with
  // no trace (Musaveer built nothing 08-09→08-11 while working; "Data
  // Missing" sheet flakiness has done this before). The roster now only picks
  // the TIMING; membership comes from constants. Members without a valid
  // rostered shift fall back to their most recent queue's shift, else SHIFT 2
  // (mid-day default) — a late message beats a silent skip.
  const rostered = new Set(candidates.map((c) => c.name));
  const unrostered = [...GST_MEMBERS].filter((m) => !rostered.has(m));
  if (unrostered.length) {
    const recent = await AttentionQueue.aggregate([
      { $match: { member: { $in: unrostered }, shift: { $in: Object.keys(ATTENTION_TIMING) } } },
      { $sort: { shift_date: -1 } },
      { $group: { _id: "$member", shift: { $first: "$shift" } } },
    ]);
    const lastShift = new Map(recent.map((r) => [r._id, r.shift]));
    for (const name of unrostered) {
      const shift = lastShift.get(name) || "SHIFT 2";
      const timing = ATTENTION_TIMING[shift];
      const hours = SHIFT_HOURS[shift];
      const row = roster.find((r) => r.name === name);
      candidates.push({
        name,
        email:
          row?.email ||
          Object.keys(EMAIL_TO_NAME_MAP).find((e) => EMAIL_TO_NAME_MAP[e] === name) ||
          null,
        shift,
        slackMention: row?.slackMention || findGSTMember(name),
        shiftDate: todayYmd,
        queueAt: istInstant(todayYmd, timing.queueAt),
        slackAt: istInstant(todayYmd, timing.slackAt),
        endAt: istInstant(todayYmd, hours.end),
      });
    }
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
      slackAt: new Date(nowMs), // test builds: Slack summary posts in the same sweep
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

  await runShiftEndAlerts(nowMs);
  await runEscalations(nowMs);

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
 * LATEST queue per member, in one round-trip — powers the team panel.
 * Deliberately NOT today-scoped (changed 2026-08-05, was istYmd()-only):
 * queues build ~45 min before shift END, so for most of the day a member's
 * newest queue is yesterday's — and Rohan wants a list on screen ALL the
 * time to work from, replaced in place when the new build lands. The old
 * today-scoping made every shift-1/2/3 member read "No queue yet" until
 * late in their shift (only the 06:00-built SHIFT 4 queues showed).
 * The 7-day lookback keeps long-leave members from surfacing an ancient
 * queue as if it were current (the Nikita-bug concern) — the card shows
 * the queue's shift_date either way.
 */
const RAIL_LOOKBACK_DAYS = 7;
export const getQueuesForMembers = async (members) => {
  if (!members?.length) return [];
  const cutoffYmd = istYmd(new Date(Date.now() - RAIL_LOOKBACK_DAYS * DAY_MS));
  const docs = await AttentionQueue.aggregate([
    // shift_date is "YYYY-MM-DD" — lexicographic $gte is date order.
    { $match: { member: { $in: members }, shift_date: { $gte: cutoffYmd } } },
    { $sort: { shift_date: -1, created_at: -1 } },
    { $group: { _id: "$member", doc: { $first: "$$ROOT" } } },
  ]);
  const byMember = new Map(docs.map((d) => [d._id, d.doc]));
  return members.map((m) => ({ member: m, queue: byMember.get(m) || null }));
};

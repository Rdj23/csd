/**
 * Characterization test for the attention rule engine.
 *
 * WHY THIS EXISTS: evaluateTicket() decides whether a ticket nudges a member
 * at shift end. It is pure (ticket + now -> verdict), which makes it the one
 * place we can lock behaviour down exactly. This test was written while
 * splitting the 1426-line attentionService.js into services/attention/*: the
 * same 4000 generated tickets produced identical verdicts before and after,
 * and this file keeps that guarantee for the next refactor.
 *
 * It asserts SHAPE and DISTRIBUTION, not hand-written expectations — the rules
 * are documented in services/attention/index.js and encoded in config.js. If a
 * rule changes deliberately, the counts below change and you update them in
 * the same commit as the rule.
 */
import { describe, it, expect } from "vitest";
import { evaluateTicket } from "../services/attention/index.js";
import { escalationContinuity } from "../services/attention/alerts.js";

// Deterministic generator — no Math.random, so the corpus is reproducible.
const makeCorpus = (now) => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const DAY = 864e5;
  const stages = [
    "Waiting on Assignee", "Awaiting Customer Reply", "Waiting on CleverTap",
    "Work in Progress", "queued", "resolved", "New", "Waiting on CSM",
  ];
  const tagSets = [[], ["first-reminder-sent"], ["second-reminder-sent"],
                   ["final-reminder-sent"], ["escalated"]];
  return Array.from({ length: 4000 }, (_, i) => ({
    id: `don:core:x:ticket/${i}`,
    display_id: `TKT-${i}`,
    stage: { name: pick(stages) },
    created_date: new Date(now - Math.floor(rnd() * 30) * DAY).toISOString(),
    tags: pick(tagSets).map((t) => ({ tag: { name: t } })),
    custom_fields: {
      tnt__last_devu_message_ts:
        rnd() > 0.2 ? new Date(now - Math.floor(rnd() * 20) * DAY).toISOString() : null,
      tnt__last_revu_message_ts:
        rnd() > 0.3 ? new Date(now - Math.floor(rnd() * 20) * DAY).toISOString() : null,
    },
    owned_by: [{ display_name: "Rohan" }],
  }));
};

const NOW = new Date("2026-08-29T12:00:00+05:30").getTime();

describe("attention rule engine — evaluateTicket", () => {
  const corpus = makeCorpus(NOW);
  const verdicts = corpus.map((t) => evaluateTicket(t, NOW));

  it("never throws on any ticket shape in the corpus", () => {
    expect(verdicts).toHaveLength(4000);
  });

  it("only ever emits the three dashboard buckets", () => {
    const buckets = new Set(verdicts.filter(Boolean).map((v) => v.bucket));
    expect([...buckets].sort()).toEqual(["onHold", "open", "pending"]);
  });

  it("every verdict carries a bucket, a rule id and a human reason", () => {
    for (const v of verdicts.filter(Boolean)) {
      expect(v.bucket).toBeTruthy();
      expect(v.rule).toMatch(/^(open-aging|pending-silent|onhold-stale)$/);
      expect(typeof v.reason).toBe("string");
      expect(v.reason.length).toBeGreaterThan(0);
    }
  });

  it("produces the locked-in bucket distribution", () => {
    const dist = { open: 0, pending: 0, onHold: 0, null: 0 };
    for (const v of verdicts) dist[v ? v.bucket : "null"]++;
    // Locked in when services/attention/* was split out of attentionService.js.
    expect(dist).toEqual({ open: 166, pending: 379, onHold: 458, null: 2997 });
  });

  it("solved tickets are always out of scope", () => {
    const solved = { ...corpus[0], stage: { name: "resolved" } };
    expect(evaluateTicket(solved, NOW)).toBeNull();
  });

  it("a reminder tag exempts an OPEN ticket but never a PENDING one", () => {
    const old = new Date(NOW - 10 * 864e5).toISOString();
    const base = { created_date: old, custom_fields: {}, owned_by: [] };
    const tagged = { ...base, tags: [{ tag: { name: "first-reminder-sent" } }] };

    expect(evaluateTicket({ ...tagged, stage: { name: "Waiting on Assignee" } }, NOW)).toBeNull();
    expect(evaluateTicket({ ...tagged, stage: { name: "Awaiting Customer Reply" } }, NOW)).not.toBeNull();
  });
});

/**
 * Shift-continuity gate for the "no action" escalation (Rohan 2026-08-31).
 *
 * The follow-up may only fire when it lands inside the SAME shift the queue
 * was built for. Rotation Monday broke that assumption: a Friday SHIFT 1 queue
 * escalated at 08:45 on a Monday the member worked SHIFT 2.
 *
 * These are pure — no roster HTTP, no Mongo — because escalationContinuity()
 * takes the two roster answers as inputs rather than fetching them.
 */
describe("escalation shift continuity", () => {
  const MON = "2026-08-31";
  const SUN = "2026-08-30";
  const FRI = "2026-08-28";

  const verdict = (o) => escalationContinuity({ todayYmd: MON, ...o });

  it("fires when yesterday's shift is the same shift as today", () => {
    // Tuesday-shaped case: queue from the immediately preceding day, and the
    // member is genuinely on that same shift on both days.
    expect(
      escalationContinuity({
        queueShift: "SHIFT 2", queueShiftDate: SUN, todayYmd: MON,
        shiftToday: "SHIFT 2", shiftOnQueueDay: "SHIFT 2",
      }),
    ).toEqual({ ok: true });
  });

  it("stays silent when the member rotated to a different shift", () => {
    // The exact Anurag case: finished Friday on SHIFT 1, started on SHIFT 2.
    const v = verdict({
      queueShift: "SHIFT 1", queueShiftDate: SUN,
      shiftToday: "SHIFT 2", shiftOnQueueDay: "SHIFT 1",
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("SHIFT 1 → SHIFT 2");
  });

  it("stays silent on a Monday morning with no weekday special case", () => {
    // Nobody is rostered a real shift on Sunday, so the queue the Week-Off
    // fallback built with an inherited shift can never escalate — which is
    // what makes "Monday only builds the queue" fall out on its own.
    const v = verdict({
      queueShift: "SHIFT 1", queueShiftDate: SUN,
      shiftToday: "SHIFT 1", shiftOnQueueDay: null,
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("was not rostered");
  });

  it("stays silent when the member is not working today", () => {
    const v = verdict({
      queueShift: "SHIFT 2", queueShiftDate: SUN,
      shiftToday: null, shiftOnQueueDay: "SHIFT 2",
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("not rostered a working shift today");
  });

  it("stays silent for a stale queue older than the preceding day", () => {
    // Friday's queue must not escalate on Monday even if the shift matches:
    // three days of stale clocks all landing on one instant is what produced
    // the 15-minute repeat.
    const v = verdict({
      queueShift: "SHIFT 1", queueShiftDate: FRI,
      shiftToday: "SHIFT 1", shiftOnQueueDay: "SHIFT 1",
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain(`queue is from ${FRI}`);
  });

  it("escalates SHIFT 4 on its OWN day, not the day after", () => {
    // The overnight shift escalates same-day (escalateNextDay: false) because
    // the member's next night starts that evening.
    expect(
      escalationContinuity({
        queueShift: "SHIFT 4", queueShiftDate: MON, todayYmd: MON,
        shiftToday: "SHIFT 4", shiftOnQueueDay: "SHIFT 4",
      }),
    ).toEqual({ ok: true });

    expect(
      escalationContinuity({
        queueShift: "SHIFT 4", queueShiftDate: SUN, todayYmd: MON,
        shiftToday: "SHIFT 4", shiftOnQueueDay: "SHIFT 4",
      }).ok,
    ).toBe(false);
  });
});

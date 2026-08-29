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

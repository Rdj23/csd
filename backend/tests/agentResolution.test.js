/**
 * Sanity tests for the new "Resolved By" filter and agent classification logic.
 * Exercises the pure functions in isolation — no DB / network needed.
 */
import { describe, it, expect } from "vitest";
import { applyResolvedByFilter } from "../utils/queryBuilders.js";
import { AnalyticsTicket } from "../models/index.js";
import { classifyResolution } from "../services/syncService.js";

describe("applyResolvedByFilter", () => {
  it("is a no-op when both options are passed", () => {
    const match = { closed_date: { $gte: new Date() } };
    applyResolvedByFilter(match, "engineer,agent");
    expect(match.resolved_by).toBeUndefined();
  });

  it("is a no-op when nothing is passed", () => {
    const match = {};
    applyResolvedByFilter(match, undefined);
    applyResolvedByFilter(match, null);
    applyResolvedByFilter(match, "");
    expect(match.resolved_by).toBeUndefined();
  });

  it("narrows to engineer when only engineer is selected", () => {
    const match = {};
    applyResolvedByFilter(match, "engineer");
    expect(match.resolved_by).toBe("engineer");
  });

  it("narrows to agent when only agent is selected", () => {
    const match = {};
    applyResolvedByFilter(match, "agent");
    expect(match.resolved_by).toBe("agent");
  });

  it("trims whitespace and ignores empty entries", () => {
    const match = {};
    applyResolvedByFilter(match, " agent , ");
    expect(match.resolved_by).toBe("agent");
  });
});

describe("AnalyticsTicket schema — agent fields", () => {
  it("accepts the new agent fields with correct types", () => {
    const doc = new AnalyticsTicket({
      ticket_id: "TKT-9999",
      owner: "Unassigned",
      resolved_by: "agent",
      agent_resolved: true,
      agent_response_count: 7,
      agent_resolution_hours: 12.5,
    });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
    expect(doc.resolved_by).toBe("agent");
    expect(doc.agent_resolved).toBe(true);
    expect(doc.agent_response_count).toBe(7);
    expect(doc.agent_resolution_hours).toBe(12.5);
  });

  it("rejects an invalid resolved_by enum value", () => {
    const doc = new AnalyticsTicket({
      ticket_id: "TKT-9998",
      resolved_by: "alien",
    });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err.errors.resolved_by).toBeDefined();
  });

  it("defaults resolved_by to engineer when omitted", () => {
    const doc = new AnalyticsTicket({ ticket_id: "TKT-9997" });
    expect(doc.resolved_by).toBe("engineer");
    expect(doc.agent_resolved).toBe(false);
    expect(doc.agent_response_count).toBe(0);
    expect(doc.agent_resolution_hours).toBeNull();
  });
});

describe("classifyResolution (sync-time decision)", () => {
  const PRE_AGENT = new Date("2026-02-15");
  const POST_AGENT = new Date("2026-04-01");
  const tWithFlags = (agent, eng) => ({
    custom_fields: {
      tnt__agent_resolved: agent,
      tnt__support_engineer_handled: eng,
    },
  });
  const tWithFlag = (resolved) => tWithFlags(resolved, false);

  it("GST owner + agent flag false → engineer, owner preserved", () => {
    const r = classifyResolution(tWithFlag(false), POST_AGENT, "Rohan");
    expect(r).toEqual({ resolvedBy: "engineer", finalOwner: "Rohan", agentResolved: false });
  });

  it("GST owner + agent flag true + engineer flag false → agent, owner preserved", () => {
    const r = classifyResolution(tWithFlags(true, false), POST_AGENT, "Rohan");
    expect(r).toEqual({ resolvedBy: "agent", finalOwner: "Rohan", agentResolved: true });
  });

  it("GST owner + agent flag true + engineer flag true → engineer (engineer co-handled overrides agent)", () => {
    const r = classifyResolution(tWithFlags(true, true), POST_AGENT, "Rohan");
    expect(r).toEqual({ resolvedBy: "engineer", finalOwner: "Rohan", agentResolved: false });
  });

  it("GST owner + agent flag false + engineer flag true → engineer", () => {
    const r = classifyResolution(tWithFlags(false, true), POST_AGENT, "Rohan");
    expect(r).toEqual({ resolvedBy: "engineer", finalOwner: "Rohan", agentResolved: false });
  });

  it("unassigned + post-agent + flag false → agent, owner = Unassigned", () => {
    const r = classifyResolution(tWithFlag(false), POST_AGENT, null);
    expect(r).toEqual({ resolvedBy: "agent", finalOwner: "Unassigned", agentResolved: false });
  });

  it("unassigned + post-agent + agent flag true (no engineer) → agent, owner = Unassigned", () => {
    const r = classifyResolution(tWithFlags(true, false), POST_AGENT, null);
    expect(r).toEqual({ resolvedBy: "agent", finalOwner: "Unassigned", agentResolved: true });
  });

  it("unassigned + pre-agent → SKIP (legacy hygiene)", () => {
    const r = classifyResolution(tWithFlag(false), PRE_AGENT, null);
    expect(r).toEqual({ resolvedBy: null, finalOwner: null, agentResolved: false });
  });

  it("missing custom_fields gracefully → not agent-resolved", () => {
    const r = classifyResolution({}, POST_AGENT, "Rohan");
    expect(r.resolvedBy).toBe("engineer");
    expect(r.agentResolved).toBe(false);
  });
});

describe("schema indexes — resolved_by", () => {
  it("registers the compound { closed_date, resolved_by } index", () => {
    const indexes = AnalyticsTicket.schema.indexes();
    const found = indexes.find(([keys]) =>
      keys.closed_date === 1 && keys.resolved_by === 1
    );
    expect(found).toBeDefined();
  });
});

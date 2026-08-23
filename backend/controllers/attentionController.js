/**
 * attentionController.js — Attention Queue endpoints.
 *
 * VISIBILITY MODEL (extended 2026-08-03, was strictly per-user):
 *   - Every GST member sees their own queue AND their teammates' queues
 *     (same TEAMS block in constants.js). Teamless members see only
 *     themselves.
 *   - Supervisors (ATTENTION_SUPERVISOR_EMAILS, default Anmol + Mashnu —
 *     non-GST managers) see every GST member's queue.
 *   - Verify-clear accepts an optional target member, permission-checked
 *     against the same visibility set. Verification is evidence-based (it
 *     only clears tickets DevRev confirms were actioned), so letting a
 *     teammate/lead trigger it is safe — it can never wrongly clear.
 *   - All other logins get { visible: false } and the frontend hides the bell.
 */

import { EMAIL_TO_NAME_MAP, TEAM_MAPPING } from "../config/constants.js";
import {
  getQueueForEmail,
  getQueuesForMembers,
  verifyAndClearQueue,
  runAttentionSweep,
} from "../services/attentionService.js";
import { getAttentionQueue } from "../lib/queues.js";
import { ok, fail, notFound, serverError } from "../utils/response.js";
import logger from "../config/logger.js";

const SUPERVISOR_EMAILS = (
  process.env.ATTENTION_SUPERVISOR_EMAILS ||
  "anmol.sawhney@clevertap.com,mashnu@clevertap.com,rohan.jadhav@clevertap.com"
)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Canonical member → email, and the full canonical roster in TEAMS order.
// EMAIL_TO_NAME_MAP values are canonical names (one per email), unlike
// TEAM_MAPPING keys which also carry rosterName/alias variants.
const NAME_TO_EMAIL = {};
const ALL_MEMBERS = [];
for (const [email, name] of Object.entries(EMAIL_TO_NAME_MAP)) {
  if (!NAME_TO_EMAIL[name]) {
    NAME_TO_EMAIL[name] = email;
    ALL_MEMBERS.push(name);
  }
}

/**
 * Members the logged-in email may view: { scope, member, members } or null.
 * scope: "all" (supervisor) | "team" | "self" (teamless GST member).
 */
export const resolveVisibility = (email) => {
  const lower = (email || "").toLowerCase();
  const member = EMAIL_TO_NAME_MAP[lower] || null;
  if (SUPERVISOR_EMAILS.includes(lower)) {
    return { scope: "all", member, members: ALL_MEMBERS };
  }
  if (!member) return null;
  const team = TEAM_MAPPING[member];
  if (!team) return { scope: "self", member, members: [member] };
  return { scope: "team", member, members: team.members };
};

/** GET /api/attention/queue — the logged-in member's latest queue. */
export const getMyQueue = async (req, res) => {
  try {
    const { member, queue } = await getQueueForEmail(req.user?.email);
    if (!member) return ok(res, { isGstMember: false, queue: null });
    ok(res, { isGstMember: true, member, queue });
  } catch (e) {
    logger.error({ err: e }, "Attention getMyQueue error");
    serverError(res, e.message);
  }
};

/**
 * GET /api/attention/team-queues — latest queue for every member the viewer
 * may see (self + teammates, or all of GST for supervisors). Powers the
 * member rail in the Attention Queue modal.
 */
export const getTeamQueues = async (req, res) => {
  try {
    const vis = resolveVisibility(req.user?.email);
    if (!vis) return ok(res, { visible: false, viewer: null, members: [] });
    const entries = await getQueuesForMembers(vis.members);
    const members = entries.map(({ member, queue }) => ({
      member,
      email: NAME_TO_EMAIL[member] || null,
      team: TEAM_MAPPING[member]?.team || null,
      isSelf: member === vis.member,
      queue,
    }));
    ok(res, {
      visible: true,
      viewer: { member: vis.member, scope: vis.scope },
      members,
    });
  } catch (e) {
    logger.error({ err: e }, "Attention getTeamQueues error");
    serverError(res, e.message);
  }
};

/**
 * POST /api/attention/verify-clear — re-check a pending queue against live
 * DevRev; items clear only when the required action verifiably happened.
 * Body: { member? } — defaults to the logged-in member; another member is
 * allowed only when they're in the viewer's visibility set.
 */
export const verifyClear = async (req, res) => {
  try {
    const vis = resolveVisibility(req.user?.email);
    if (!vis) return notFound(res, "Not a GST member");
    const target = req.body?.member || vis.member;
    if (!target) return notFound(res, "No member to verify");
    if (!vis.members.includes(target)) {
      return fail(res, 403, "You can only verify queues of members visible to you");
    }
    const queue = await verifyAndClearQueue(target, "user");
    if (!queue) return ok(res, { queue: null, message: "No pending queue" });
    ok(res, { queue });
  } catch (e) {
    logger.error({ err: e }, "Attention verifyClear error");
    serverError(res, e.message);
  }
};

/**
 * POST /api/attention/run — admin/manual sweep trigger, mainly for testing.
 * Body: { force?: boolean, member?: string }
 *   force  — build queues regardless of the per-shift queue window
 *   member — restrict to one canonical GST name (e.g. "Rohan")
 * Dispatches via BullMQ when available (mirrors the cron path exactly);
 * falls back to a direct run so it also works without Redis.
 */
export const runSweep = async (req, res) => {
  try {
    const { force = false, member = null } = req.body || {};
    const queue = getAttentionQueue();
    if (queue) {
      await queue.add("sweep", { force, member }, { jobId: `manual-sweep-${Date.now()}` });
      return ok(res, { dispatched: true, force, member });
    }
    const result = await runAttentionSweep({ force, member });
    ok(res, { dispatched: false, ...result });
  } catch (e) {
    logger.error({ err: e }, "Attention runSweep error");
    serverError(res, e.message);
  }
};

/**
 * attentionController.js — Attention Queue endpoints.
 *
 * VISIBILITY MODEL: strictly per-user (like gamification my-stats). The
 * member is always resolved from the JWT email — there is no way to fetch
 * or clear someone else's queue through these endpoints. Non-GST logins
 * (emails not in EMAIL_TO_NAME_MAP) get an empty response, and the frontend
 * hides the bell for them.
 */

import { EMAIL_TO_NAME_MAP } from "../config/constants.js";
import {
  getQueueForEmail,
  verifyAndClearQueue,
  runAttentionSweep,
} from "../services/attentionService.js";
import { getAttentionQueue } from "../lib/queues.js";
import { ok, notFound, serverError } from "../utils/response.js";
import logger from "../config/logger.js";

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
 * POST /api/attention/verify-clear — re-check the logged-in member's pending
 * queue against live DevRev; items clear only when the required action
 * verifiably happened (external reply / nudge / stage change). When the last
 * item clears, the queue completes and the Slack congrats fires.
 */
export const verifyClear = async (req, res) => {
  try {
    const member = EMAIL_TO_NAME_MAP[(req.user?.email || "").toLowerCase()];
    if (!member) return notFound(res, "Not a GST member");
    const queue = await verifyAndClearQueue(member, "user");
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
 *   force  — build queues regardless of the 30-min shift-end window
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

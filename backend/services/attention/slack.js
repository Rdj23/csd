/**
 * attention/slack — Slack delivery (via n8n) and the message wording.
 *
 * Extracted from the 1426-line attentionService.js; the logic below is
 * unchanged. See attention/index.js for the feature-level documentation
 * of what the Attention Queue does and the rules it enforces.
 */

import axios from "axios";
import logger from "../../config/logger.js";
import { findGSTMember } from "../slackService.js";
import { TICKET_URL } from "./config.js";

// ── Slack (via n8n) ──────────────────────────────────────────────────────
// ALL attention alerts route through one n8n webhook (Rohan 2026-08-05):
// n8n posts with a real Slack bot, which is what gives us THREADS — the
// next-day "no action" alert must reply under the shift-end summary, and
// incoming webhooks can't do that (no thread_ts, no ts back).
// TEAM CHANNELS (Rohan 2026-08-10): alerts post to each member's TEAM
// channel — the backend resolves it from TEAMS[].slackChannel in constants.js
// and sends it as `channel`; the n8n Slack node just uses that field.
// No channel (teamless member, or slackChannel left "") → the alert is
// SKIPPED, not sent anywhere. Contract (see docs/ATTENTION_N8N_SETUP.md):
//   POST ATTENTION_N8N_WEBHOOK_URL
//     { kind, text, channel, thread_ts }   kind: shift_end_summary | no_action_followup | queue_cleared
//   ← { ts: "<slack message ts>" }   (the summary's ts anchors the thread)
// Fallback: plain incoming webhook (ATTENTION_SLACK_WEBHOOK_URL) — posts
// fine but to its own fixed channel only, can't thread, returns no ts.

const attentionWebhook = () => process.env.ATTENTION_SLACK_WEBHOOK_URL;

// Mentions are ON by default (official workspace, Rohan 2026-08-08). Set
// ATTENTION_SLACK_MENTIONS=false only in a test workspace, where the
// roster's slack_ids don't resolve and would render as blank.
const useMentions = () => process.env.ATTENTION_SLACK_MENTIONS !== "false";

// Who a message addresses: the roster slack_id stored on the queue doc at
// build time, else the GST_SLACK_MEMBER_IDS constants map (covers queues
// built before the roster carried a slack_id), else the plain bold name —
// an alert must never go out addressed to nobody.
export const memberMention = (queue) =>
  (useMentions() && (queue.slack_id || findGSTMember(queue.member))) || `*${queue.member}*`;

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

/**
 * The single exit point for every attention alert. Sends through n8n when
 * ATTENTION_N8N_WEBHOOK_URL is set; otherwise the plain incoming webhook.
 * `channel` is the member's team channel (TEAMS[].slackChannel) — callers
 * must resolve it and skip the alert entirely when it's null; postAlert
 * itself refuses to guess and drops the post with a warn instead.
 * @returns {{ok: boolean, ts: string|null}} ts = Slack message ts from n8n
 *   (null on the webhook fallback — thread replies then post to the channel).
 */
export const postAlert = async ({ kind, text, channel = null, threadTs = null }) => {
  if (!channel) {
    logger.warn({ kind }, "Attention alert dropped — no team channel resolved");
    return { ok: false, ts: null };
  }
  const n8n = process.env.ATTENTION_N8N_WEBHOOK_URL;
  if (n8n) {
    try {
      const res = await axios.post(
        n8n,
        { kind, text, channel, thread_ts: threadTs || null },
        { timeout: 20000 },
      );
      return { ok: true, ts: res.data?.ts || res.data?.message_ts || null };
    } catch (e) {
      logger.error({ err: e.message, kind }, "Attention n8n post failed — falling back to incoming webhook");
    }
  }
  return { ok: await postSlack(text), ts: null };
};

const BUCKET_LABELS = { open: "Open", pending: "Pending", onHold: "On Hold" };
const BUCKET_WORDS = { open: "open", pending: "pending", onHold: "on hold" };

/**
 * One bullet of the shift-end summary. Counts only, NO ticket metadata —
 * the full list lives on the dashboard (Rohan 2026-08-05). Variants:
 *   nothing at all        → congratulations
 *   only tracked items    → "N being tracked — action them tomorrow"
 *   actionable items left → "you have X open, Y pending, Z on hold — update those"
 */
export const memberSummaryLine = (queue, mention = null) => {
  const who = mention || memberMention(queue);
  const items = queue.items || [];
  const actionable = items.filter((i) => i.status === "pending");
  const tracked = items.filter((i) => i.status === "partial").length;

  if (!actionable.length && !tracked) {
    return `• 🎉 ${who} — congratulations, no tickets to be worked on!`;
  }
  if (!actionable.length) {
    return `• 👏 ${who} — nothing to action, but *${tracked} ticket${tracked === 1 ? " is" : "s are"} being tracked* — make sure to action them tomorrow when you start your shift.`;
  }
  const counts = ["open", "pending", "onHold"]
    .map((b) => ({ b, n: actionable.filter((i) => i.bucket === b).length }))
    .filter((c) => c.n)
    .map((c) => `*${c.n} ${BUCKET_WORDS[c.b]}*`);
  return (
    `• ⏰ Hey ${who} — you have ${counts.join(", ")} case${actionable.length === 1 ? "" : "s"} to work on. Please update those.` +
    (tracked ? ` _(+${tracked} tracked)_` : "")
  );
};

/**
 * The batched shift-end message: one Slack post per shift trigger, one line
 * per member ("if 4 users, a 4-point list"). Its Slack ts anchors the thread
 * the next-day "no action" alerts reply into.
 */
export const shiftEndSummaryMessage = (queues) => {
  const [q] = queues;
  return [
    `📋 *Shift-end check — ${q.shift}${q.shift_date ? ` · ${q.shift_date}` : ""}*`,
    ...queues.map((queue) => memberSummaryLine(queue)),
  ].join("\n");
};

/**
 * Next-day "no action" thread reply: bare clickable ticket IDs, stage-wise,
 * nothing else. Includes TRACKED items — a remark snoozes same-day alerts,
 * but a ticket still violating its rule the next morning gets listed anyway
 * (Rohan 2026-08-03/05).
 */
export const noActionMessage = (queue) => {
  const who = memberMention(queue);
  const rows = queue.items.filter((i) => i.status === "pending" || i.status === "partial");
  const lines = [`${who} — *no action* on the tickets below, please update them:`];
  for (const bucket of ["open", "pending", "onHold"]) {
    const ids = rows
      .filter((i) => i.bucket === bucket)
      .map((i) => `<${TICKET_URL(i.display_id)}|${i.display_id}>`);
    if (ids.length) lines.push(`•  *${BUCKET_LABELS[bucket]} (${ids.length}):*  ${ids.join(", ")}`);
  }
  return lines.join("\n");
};

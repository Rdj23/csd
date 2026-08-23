/**
 * webhookController.js — The "front door" for all DevRev events.
 *
 * WHY THIS FILE EXISTS:
 * DevRev sends HTTP POST requests here whenever a ticket is created/updated/deleted,
 * or when a timeline entry (comment) is added, or when our AI agent responds.
 * Instead of doing heavy processing inline (which would block the HTTP response
 * and risk timeouts), we ENQUEUE work into BullMQ and respond "OK" immediately.
 *
 * DATA FLOW:
 *   DevRev event → POST /webhooks/devrev
 *     → webhookVerify middleware checks HMAC signature (security layer)
 *       → this controller receives the verified event
 *         → enqueues a BullMQ job (or falls back to direct processing)
 *           → responds "OK" within milliseconds
 */

import { getTicketSyncQueue } from "../lib/queues.js";
import { fetchAndCacheTickets } from "../services/syncService.js";
import { processWebhookTimelineEntry } from "../services/activityService.js";
import { storeAgentResponse } from "../services/agentService.js";
import logger from "../config/logger.js";

/**
 * debounceTimer — in-memory fallback timer for when BullMQ/Redis is down.
 *
 * WHY A MODULE-LEVEL VARIABLE:
 * If Redis is unavailable, multiple rapid webhook calls would each trigger
 * a full DevRev API sync. This timer ensures we wait 5s after the LAST
 * webhook before syncing — so 10 rapid events = 1 sync, not 10.
 * Module-level because it must persist across multiple function calls.
 */
let debounceTimer = null;

/**
 * WEBHOOK_SYNC_DELAY_MS — the batch window for webhook-triggered syncs.
 *
 * WHY 30s (was 5s): every completed sync broadcasts to ALL connected browsers,
 * and any data change makes each visible client download the update. During
 * busy hours DevRev fires webhooks near-continuously, so a 5s window meant a
 * sync (and a fleet-wide refresh) every few seconds — the main driver of the
 * Render bandwidth blowout. 30s caps this at 2 syncs/minute worst case; the
 * dashboard tolerates 30s of staleness invisibly (the hourly cron remains the
 * safety net).
 */
const WEBHOOK_SYNC_DELAY_MS = Number(process.env.WEBHOOK_SYNC_DELAY_MS) || 30000;

export const handleDevRevWebhook = (req, res) => {
  const event = req.body;

  // DEBUG: Log every incoming webhook to see what DevRev is sending
  logger.info(
    { type: event.type, keys: Object.keys(event), path: req.path },
    "🔍 DEBUG: Webhook received — raw event keys"
  );

  /**
   * WEBHOOK VERIFICATION HANDSHAKE
   *
   * WHY: When you first register a webhook URL with DevRev (via setup_webhook.js),
   * DevRev sends a "challenge" to prove YOUR server actually owns that URL.
   * You must echo back the challenge string. DevRev sends this in two possible
   * formats depending on the webhook version — we handle both.
   *
   * This is a one-time handshake, but DevRev can re-verify at any time,
   * so we always keep this check active.
   */
  if (event.type === "webhook_verify")
    return res.json({ challenge: event.challenge });
  if (event.verify?.challenge)
    return res.json({ challenge: event.verify.challenge });

  // ─────────────────────────────────────────────────────────────────
  // SECTION 1: TICKET EVENTS (work_created, work_updated, work_deleted)
  // ─────────────────────────────────────────────────────────────────
  /**
   * WHY WE CHECK event.type:
   * DevRev sends ALL event types to the same webhook URL. We need to
   * branch on event.type to decide what to do with each one.
   *
   * WHY WE USE A QUEUE INSTEAD OF PROCESSING DIRECTLY:
   * 1. DEDUPLICATION — jobId: "webhook-sync" means if 50 ticket updates arrive
   *    in 5 seconds, BullMQ creates only ONE job (same jobId = same job).
   *    Without this, we'd call DevRev API 50 times for the same data.
   *
   * 2. DELAY — delay: 5000 (5 seconds) acts as a "batch window". We wait
   *    5s after the first event hoping more events arrive, then process
   *    them all in one sync. This is BullMQ's built-in debouncing.
   *
   * 3. RETRY — If the sync fails (DevRev API down, network issue), BullMQ
   *    automatically retries 3 times with exponential backoff (5s, 10s, 20s).
   *    An inline sync would just fail and lose the data.
   *
   * WHY source: "webhook":
   * The syncService needs to know WHO triggered the sync — webhook vs cron vs manual.
   * This affects logging and potentially which tickets to fetch.
   */
  if (["work_created", "work_updated", "work_deleted"].includes(event.type)) {
    const queue = getTicketSyncQueue();
    if (queue) {
      queue.add("sync-active", { source: "webhook" }, {
        /**
         * jobId: "webhook-sync" — THIS IS THE KEY TO DEDUPLICATION.
         * BullMQ won't create a new job if one with this ID already exists
         * and hasn't been processed yet. So 100 rapid webhooks = 1 job.
         */
        jobId: "webhook-sync",
        /**
         * delay — Wait for the batch window before the job becomes "ready".
         * During this window, if more webhooks arrive, they'll try to add
         * a job with the same ID — BullMQ will silently ignore them.
         * After the window, the single job runs and fetches ALL latest data.
         */
        delay: WEBHOOK_SYNC_DELAY_MS,
        /**
         * removeOnComplete/removeOnFail: true — CRITICAL with a fixed jobId.
         * BullMQ dedupes against jobs in ANY state, including completed/failed
         * ones still sitting in Redis. The queue default keeps the last 5
         * completed jobs, so a finished "webhook-sync" job would block every
         * future webhook add forever — live ticket states silently stopped
         * updating. Deleting the job the moment it finishes frees the id, so
         * dedupe only applies during the 5s batch window (as intended).
         */
        removeOnComplete: true,
        removeOnFail: true,
      }).catch((err) => {
        /**
         * WHY CATCH + FALLBACK:
         * If Redis is down, queue.add() will throw. We don't want to
         * lose the webhook data, so we fall back to direct processing
         * with our own debounce logic (directDebouncedSync).
         */
        logger.warn({ err }, "BullMQ webhook dispatch failed, using direct sync");
        directDebouncedSync();
      });
    } else {
      /**
       * WHY THE ELSE:
       * If queues haven't been initialized (e.g., Redis URL not configured,
       * running in a minimal/test mode), fall back to direct sync.
       * The system degrades gracefully instead of silently dropping events.
       */
      directDebouncedSync();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // SECTION 2: AI AGENT RESPONSES
  // ─────────────────────────────────────────────────────────────────
  /**
   * WHY THIS SECTION EXISTS:
   * We have a DevRev AI Agent (configured via DEVREV_AGENT_DON) that can
   * answer questions about tickets. When you ask it a question, DevRev
   * processes it ASYNCHRONOUSLY and sends the response back via webhook.
   *
   * WHY event.ai_agent_response || event.payload?.ai_agent_response:
   * DevRev's webhook payload format varies — sometimes the agent response
   * is at the top level, sometimes nested inside a "payload" wrapper.
   * We check both to be defensive against API format changes.
   *
   * WHY WE DON'T QUEUE THIS:
   * Agent responses are small, infrequent, and time-sensitive (user is waiting).
   * storeAgentResponse() is a quick DB write — no need for the queue overhead.
   */
  const ar = event.ai_agent_response || event.payload?.ai_agent_response;
  logger.info({ hasAr: !!ar, eventType: event.type, eventKeys: Object.keys(event) }, "🔍 DEBUG: Agent response check");
  if (ar) {
    logger.info({ ar_full: JSON.stringify(ar).substring(0, 500) }, "🔍 DEBUG: Full agent response payload");
    logger.info({ agent_response: ar.agent_response, session_object: ar.session_object }, "AI agent webhook payload received");
    if (ar.agent_response === "message" || ar.agent_response === "error") {
      const type = ar.agent_response === "message" ? "message" : "error";
      /**
       * WHY THE TERNARY FOR text:
       * Success: DevRev puts the reply in ar.message
       * Error: DevRev puts error details in ar.error.error (nested object)
       * We normalize both into a simple string for storage.
       */
      const text = type === "message" ? ar.message : (ar.error?.error || "Unknown agent error");
      /**
       * session_object is DevRev's correlation ID — it ties this response
       * back to the original question so the frontend can match them.
       */
      storeAgentResponse(ar.session_object, type, text);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // SECTION 3: TIMELINE ENTRIES (comments on tickets)
  // ─────────────────────────────────────────────────────────────────
  /**
   * WHY THIS SECTION EXISTS:
   * This powers the "Activity Intelligence" feature — tracking who comments
   * on which tickets, when, and whether it's internal vs external.
   * Used for gamification points and activity analytics.
   *
   * WHY FIRE-AND-FORGET (no await, just .catch):
   * We want to respond "OK" to DevRev immediately. processWebhookTimelineEntry
   * does DB work that might take 100-500ms. Since we've already captured the
   * event data in `event`, we can safely process it in the background.
   * If it fails, we log the error — the cron job (every 10 min) will catch
   * any missed entries as a safety net.
   *
   * WHY NOT QUEUED:
   * Unlike ticket syncs (where we batch many events into one sync),
   * each timeline entry is processed individually and quickly.
   * The cron safety net makes a queue unnecessary here.
   */
  if (["timeline_entry_created", "timeline_entry_updated"].includes(event.type)) {
    processWebhookTimelineEntry(event).catch((err) =>
      logger.error({ err: err.message, type: event.type }, "Activity webhook processing failed"),
    );
  }

  /**
   * WHY res.send("OK") IS OUTSIDE ALL THE IF BLOCKS:
   * We ALWAYS respond "OK" regardless of event type. Even if we receive
   * an event type we don't handle (e.g., "part_created"), we acknowledge it.
   * If we returned 4xx/5xx, DevRev would retry the webhook — creating
   * unnecessary load for events we intentionally don't process.
   */
  res.send("OK");
};

/**
 * directDebouncedSync — Manual debounce fallback when BullMQ is unavailable.
 *
 * WHY THIS EXISTS:
 * BullMQ gives us deduplication + delay for free (via jobId + delay).
 * But if Redis is down, we need our own equivalent. This is a simple
 * setTimeout-based debounce: each call resets the 5-second timer.
 * Only when webhooks STOP arriving for 5 seconds does the sync actually run.
 *
 * HOW IT WORKS:
 *   Webhook 1 arrives → sets timer for 5s
 *   Webhook 2 arrives 1s later → clears old timer, sets new 5s timer
 *   Webhook 3 arrives 2s later → clears old timer, sets new 5s timer
 *   ... 5 seconds of silence ...
 *   → fetchAndCacheTickets("webhook") finally runs ONCE
 *
 * LIMITATION:
 * This lives in memory — if the server restarts, the timer is lost.
 * BullMQ persists jobs in Redis, so they survive restarts. This is
 * exactly why BullMQ is the primary path and this is only a fallback.
 */
function directDebouncedSync() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    fetchAndCacheTickets("webhook").catch((e) =>
      logger.error({ err: e }, "Direct webhook sync failed"),
    );
  }, WEBHOOK_SYNC_DELAY_MS);
}

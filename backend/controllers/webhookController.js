import { getTicketSyncQueue } from "../lib/queues.js";
import { fetchAndCacheTickets } from "../services/syncService.js";
import { processWebhookTimelineEntry } from "../services/activityService.js";
import { storeAgentResponse } from "../services/agentService.js";
import logger from "../config/logger.js";

let debounceTimer = null;

export const handleDevRevWebhook = (req, res) => {
  const event = req.body;
  // Handle both verify formats DevRev may send
  if (event.type === "webhook_verify")
    return res.json({ challenge: event.challenge });
  if (event.verify?.challenge)
    return res.json({ challenge: event.verify.challenge });

  // --- Ticket events (existing) ---
  if (["work_created", "work_updated", "work_deleted"].includes(event.type)) {
    const queue = getTicketSyncQueue();
    if (queue) {
      queue.add("sync-active", { source: "webhook" }, {
        jobId: "webhook-sync",
        delay: 5000,
      }).catch((err) => {
        logger.warn({ err }, "BullMQ webhook dispatch failed, using direct sync");
        directDebouncedSync();
      });
    } else {
      directDebouncedSync();
    }
  }

  // --- AI Agent response (from DevRev agent async API webhook) ---
  // Response can be at event.ai_agent_response (direct) or event.payload.ai_agent_response (wrapped)
  const ar = event.ai_agent_response || event.payload?.ai_agent_response;
  if (ar && (ar.agent_response === "message" || ar.agent_response === "error")) {
    const type = ar.agent_response === "message" ? "message" : "error";
    const text = type === "message" ? ar.message : (ar.error?.error || "Unknown agent error");
    storeAgentResponse(ar.session_object, type, text);
    logger.info({ session: ar.session_object, type }, "AI agent webhook received");
  }

  // --- Timeline entry events (activity intelligence) ---
  if (["timeline_entry_created", "timeline_entry_updated"].includes(event.type)) {
    // Fire-and-forget: process async, respond immediately
    processWebhookTimelineEntry(event).catch((err) =>
      logger.error({ err: err.message, type: event.type }, "Activity webhook processing failed"),
    );
  }

  res.send("OK");
};

// Fallback debounce when Redis/BullMQ is unavailable
function directDebouncedSync() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    fetchAndCacheTickets("webhook").catch((e) =>
      logger.error({ err: e }, "Direct webhook sync failed"),
    );
  }, 5000);
}

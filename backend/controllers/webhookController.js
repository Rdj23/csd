import { getTicketSyncQueue } from "../lib/queues.js";
import { fetchAndCacheTickets } from "../services/syncService.js";
import { processWebhookTimelineEntry } from "../services/activityService.js";
import logger from "../config/logger.js";

let debounceTimer = null;

export const handleDevRevWebhook = (req, res) => {
  const event = req.body;
  if (event.type === "webhook_verify")
    return res.json({ challenge: event.challenge });

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

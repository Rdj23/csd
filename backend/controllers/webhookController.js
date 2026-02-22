import { getTicketSyncQueue } from "../lib/queues.js";
import { fetchAndCacheTickets } from "../services/syncService.js";
import logger from "../config/logger.js";

let debounceTimer = null;

export const handleDevRevWebhook = (req, res) => {
  const event = req.body;
  if (event.type === "webhook_verify")
    return res.json({ challenge: event.challenge });
  if (["work_created", "work_updated", "work_deleted"].includes(event.type)) {
    const queue = getTicketSyncQueue();
    if (queue) {
      // Try BullMQ dedup via jobId + delay
      queue.add("sync-active", { source: "webhook" }, {
        jobId: "webhook-sync",
        delay: 5000,
      }).catch((err) => {
        // BullMQ failed (Redis down) — fall back to debounced direct call
        logger.warn({ err }, "BullMQ webhook dispatch failed, using direct sync");
        directDebouncedSync();
      });
    } else {
      directDebouncedSync();
    }
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

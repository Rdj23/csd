import { getTicketSyncQueue } from "../lib/queues.js";
import { fetchAndCacheTickets } from "../services/syncService.js";

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
        console.warn(`⚠️ BullMQ webhook dispatch failed (${err.message}), using direct sync`);
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
      console.error("Direct webhook sync failed:", e.message),
    );
  }, 5000);
}

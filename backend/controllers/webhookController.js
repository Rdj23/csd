import { getTicketSyncQueue } from "../lib/queues.js";

export const handleDevRevWebhook = (req, res) => {
  const event = req.body;
  if (event.type === "webhook_verify")
    return res.json({ challenge: event.challenge });
  if (["work_created", "work_updated", "work_deleted"].includes(event.type)) {
    const queue = getTicketSyncQueue();
    if (queue) {
      // BullMQ dedup via jobId + delay replaces the old setTimeout debounce
      queue.add("sync-active", { source: "webhook" }, {
        jobId: "webhook-sync",
        delay: 5000,
      }).catch((err) => console.error("Failed to dispatch webhook sync:", err.message));
    }
  }
  res.send("OK");
};

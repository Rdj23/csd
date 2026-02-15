import { fetchAndCacheTickets, clearSyncTimeout, setSyncTimeout } from "../services/syncService.js";

// io instance is set from server.js
let _io = null;
export const setIO = (io) => { _io = io; };

export const handleDevRevWebhook = (req, res) => {
  const event = req.body;
  if (event.type === "webhook_verify")
    return res.json({ challenge: event.challenge });
  if (["work_created", "work_updated", "work_deleted"].includes(event.type)) {
    clearSyncTimeout();
    setSyncTimeout(setTimeout(() => fetchAndCacheTickets("webhook", _io), 5000));
  }
  res.send("OK");
};

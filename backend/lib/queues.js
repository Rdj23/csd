import { Queue } from "bullmq";

let ticketSyncQueue, historicalSyncQueue, analyticsQueue, timelineQueue, rosterQueue;

export const initQueues = (connection) => {
  const opts = { connection };

  ticketSyncQueue = new Queue("ticket-sync", {
    ...opts,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    },
  });

  historicalSyncQueue = new Queue("historical-sync", {
    ...opts,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 30000 },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
    },
  });

  analyticsQueue = new Queue("analytics", {
    ...opts,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 15000 },
      removeOnComplete: { count: 20 },
      removeOnFail: { count: 20 },
    },
  });

  timelineQueue = new Queue("timeline", {
    ...opts,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });

  rosterQueue = new Queue("roster", {
    ...opts,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 10000 },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    },
  });
};

export const getTicketSyncQueue = () => ticketSyncQueue;
export const getHistoricalSyncQueue = () => historicalSyncQueue;
export const getAnalyticsQueue = () => analyticsQueue;
export const getTimelineQueue = () => timelineQueue;
export const getRosterQueue = () => rosterQueue;
export const getAllQueues = () => {
  const map = {};
  if (ticketSyncQueue) map["ticket-sync"] = ticketSyncQueue;
  if (historicalSyncQueue) map["historical-sync"] = historicalSyncQueue;
  if (analyticsQueue) map["analytics"] = analyticsQueue;
  if (timelineQueue) map["timeline"] = timelineQueue;
  if (rosterQueue) map["roster"] = rosterQueue;
  return map;
};

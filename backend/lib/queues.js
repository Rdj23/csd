import { Queue } from "bullmq";

let ticketSyncQueue, historicalSyncQueue, analyticsQueue, timelineQueue, rosterQueue;

export const initQueues = (connection) => {
  const opts = { connection };

  ticketSyncQueue = new Queue("ticket-sync", {
    ...opts,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 10 },
    },
  });

  historicalSyncQueue = new Queue("historical-sync", {
    ...opts,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 30000 },
      removeOnComplete: { count: 3 },
      removeOnFail: { count: 5 },
    },
  });

  analyticsQueue = new Queue("analytics", {
    ...opts,
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: "exponential", delay: 15000 },
      removeOnComplete: { count: 3 },
      removeOnFail: { count: 5 },
    },
  });

  timelineQueue = new Queue("timeline", {
    ...opts,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 5000 },
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 10 },
    },
  });

  rosterQueue = new Queue("roster", {
    ...opts,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 10000 },
      removeOnComplete: { count: 3 },
      removeOnFail: { count: 5 },
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

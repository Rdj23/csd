import { Queue } from "bullmq";

let ticketSyncQueue, historicalSyncQueue, analyticsQueue, rosterQueue, activitySyncQueue;

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

  rosterQueue = new Queue("roster", {
    ...opts,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 10000 },
      removeOnComplete: { count: 3 },
      removeOnFail: { count: 5 },
    },
  });

  activitySyncQueue = new Queue("activity-sync", {
    ...opts,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30000 },
      removeOnComplete: { count: 3 },
      removeOnFail: { count: 5 },
    },
  });
};

export const getTicketSyncQueue = () => ticketSyncQueue;
export const getHistoricalSyncQueue = () => historicalSyncQueue;
export const getAnalyticsQueue = () => analyticsQueue;
export const getRosterQueue = () => rosterQueue;
export const getActivitySyncQueue = () => activitySyncQueue;
export const getAllQueues = () => {
  const map = {};
  if (ticketSyncQueue) map["ticket-sync"] = ticketSyncQueue;
  if (historicalSyncQueue) map["historical-sync"] = historicalSyncQueue;
  if (analyticsQueue) map["analytics"] = analyticsQueue;
  if (rosterQueue) map["roster"] = rosterQueue;
  if (activitySyncQueue) map["activity-sync"] = activitySyncQueue;
  return map;
};

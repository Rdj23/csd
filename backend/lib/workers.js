import { Worker } from "bullmq";
import { fetchAndCacheTickets, syncHistoricalToDB } from "../services/syncService.js";
import { precomputeAnalytics } from "../services/analyticsService.js";
import { syncRoster } from "../services/rosterService.js";
import { syncActivityBatch } from "../services/activityService.js";
import { publishRosterUpdated } from "./pubsub.js";
import logger from "../config/logger.js";

export const registerAllWorkers = (connection) => {
  const opts = { connection };

  const ticketSyncWorker = new Worker(
    "ticket-sync",
    async (job) => {
      logger.info({ source: job.data.source }, "[ticket-sync] Processing");
      await fetchAndCacheTickets(job.data.source);
    },
    { ...opts, concurrency: 1, lockDuration: 300000 },
  );

  const historicalSyncWorker = new Worker(
    "historical-sync",
    async (job) => {
      logger.info({ jobName: job.name }, "[historical-sync] Processing");
      if (job.name === "full-sync") {
        await syncHistoricalToDB(true);
      } else {
        await syncHistoricalToDB(false);
      }
      if (global.gc) global.gc();
    },
    { ...opts, concurrency: 1, lockDuration: 600000 },
  );

  const analyticsWorker = new Worker(
    "analytics",
    async (job) => {
      logger.info({ quarter: job.data.quarter }, "[analytics] Processing");
      await precomputeAnalytics(job.data.quarter);
      if (global.gc) global.gc();
    },
    { ...opts, concurrency: 1, lockDuration: 300000 },
  );

  const rosterWorker = new Worker(
    "roster",
    async () => {
      logger.info("[roster] Syncing roster from Google Sheets");
      await syncRoster();
      await publishRosterUpdated();
    },
    { ...opts, concurrency: 1, lockDuration: 120000 },
  );

  const activitySyncWorker = new Worker(
    "activity-sync",
    async (job) => {
      logger.info({ jobName: job.name, data: job.data }, "[activity-sync] Processing");
      if (job.name === "backfill") {
        await syncActivityBatch({ fullBackfill: true, quarter: job.data.quarter || "Q1_26" });
      } else {
        // Daily incremental — sync last 24h of modified tickets
        await syncActivityBatch({ since: job.data.since });
      }
      if (global.gc) global.gc();
    },
    { ...opts, concurrency: 1, lockDuration: 600000 },
  );

  const allWorkers = [ticketSyncWorker, historicalSyncWorker, analyticsWorker, rosterWorker, activitySyncWorker];

  allWorkers.forEach((w) => {
    w.on("completed", (job) => logger.info({ worker: w.name, jobName: job.name }, "Job completed"));
    w.on("failed", (job, err) => logger.error({ worker: w.name, jobName: job?.name, err }, "Job failed"));
    w.on("error", (err) => logger.error({ worker: w.name, err }, "Worker error"));
  });

  return allWorkers;
};

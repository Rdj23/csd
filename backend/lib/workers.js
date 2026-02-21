import { Worker } from "bullmq";
import { fetchAndCacheTickets, syncHistoricalToDB } from "../services/syncService.js";
import { precomputeAnalytics } from "../services/analyticsService.js";
import { enrichTimelineReplies, fetchMissingTimelinesForWorker } from "../services/timelineService.js";
import { syncRoster } from "../services/rosterService.js";
import { getTimelineQueue } from "./queues.js";
import { publishRosterUpdated } from "./pubsub.js";
import logger from "../config/logger.js";

export const registerAllWorkers = (connection) => {
  const opts = { connection };

  const ticketSyncWorker = new Worker(
    "ticket-sync",
    async (job) => {
      logger.info({ source: job.data.source }, "[ticket-sync] Processing");
      await fetchAndCacheTickets(job.data.source);
      // Chain: enrich timeline after sync
      const tlQueue = getTimelineQueue();
      if (tlQueue) {
        await tlQueue.add("enrich-all", {}, { jobId: `enrich-after-sync-${Date.now()}` });
      }
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

  const timelineWorker = new Worker(
    "timeline",
    async (job) => {
      if (job.name === "enrich-all") {
        logger.info("[timeline] Enriching all active tickets");
        await enrichTimelineReplies();
      } else if (job.name === "fetch-missing") {
        logger.info({ count: job.data.ticketIds?.length }, "[timeline] Fetching missing timelines");
        await fetchMissingTimelinesForWorker(job.data.ticketIds);
      }
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

  const allWorkers = [ticketSyncWorker, historicalSyncWorker, analyticsWorker, timelineWorker, rosterWorker];

  allWorkers.forEach((w) => {
    w.on("completed", (job) => logger.info({ worker: w.name, jobName: job.name }, "Job completed"));
    w.on("failed", (job, err) => logger.error({ worker: w.name, jobName: job?.name, err }, "Job failed"));
    w.on("error", (err) => logger.error({ worker: w.name, err }, "Worker error"));
  });

  return allWorkers;
};

import { Worker } from "bullmq";
import { fetchAndCacheTickets, syncHistoricalToDB } from "../services/syncService.js";
import { precomputeAnalytics } from "../services/analyticsService.js";
import { enrichTimelineReplies, fetchMissingTimelinesForWorker } from "../services/timelineService.js";
import { syncRoster } from "../services/rosterService.js";
import { getTimelineQueue } from "./queues.js";
import { publishRosterUpdated } from "./pubsub.js";

export const registerAllWorkers = (connection) => {
  const opts = { connection };

  const ticketSyncWorker = new Worker(
    "ticket-sync",
    async (job) => {
      console.log(`[ticket-sync] Processing: source=${job.data.source}`);
      await fetchAndCacheTickets(job.data.source);
      // Chain: enrich timeline after sync
      const tlQueue = getTimelineQueue();
      if (tlQueue) {
        await tlQueue.add("enrich-all", {}, { jobId: `enrich-after-sync-${Date.now()}` });
      }
    },
    { ...opts, concurrency: 1 },
  );

  const historicalSyncWorker = new Worker(
    "historical-sync",
    async (job) => {
      console.log(`[historical-sync] Processing: ${job.name}`);
      if (job.name === "full-sync") {
        await syncHistoricalToDB(true);
      } else {
        // delta-sync or single-ticket
        await syncHistoricalToDB(false);
      }
      if (global.gc) global.gc();
    },
    { ...opts, concurrency: 1, lockDuration: 600000 },
  );

  const analyticsWorker = new Worker(
    "analytics",
    async (job) => {
      console.log(`[analytics] Processing: quarter=${job.data.quarter}`);
      await precomputeAnalytics(job.data.quarter);
      if (global.gc) global.gc();
    },
    { ...opts, concurrency: 1 },
  );

  const timelineWorker = new Worker(
    "timeline",
    async (job) => {
      if (job.name === "enrich-all") {
        console.log("[timeline] Enriching all active tickets...");
        await enrichTimelineReplies();
      } else if (job.name === "fetch-missing") {
        console.log(`[timeline] Fetching ${job.data.ticketIds?.length} missing timelines`);
        await fetchMissingTimelinesForWorker(job.data.ticketIds);
      }
    },
    { ...opts, concurrency: 1 },
  );

  const rosterWorker = new Worker(
    "roster",
    async () => {
      console.log("[roster] Syncing roster from Google Sheets...");
      await syncRoster();
      await publishRosterUpdated();
    },
    { ...opts, concurrency: 1 },
  );

  const allWorkers = [ticketSyncWorker, historicalSyncWorker, analyticsWorker, timelineWorker, rosterWorker];

  allWorkers.forEach((w) => {
    w.on("completed", (job) => console.log(`[${w.name}] Job ${job.name} completed`));
    w.on("failed", (job, err) => console.error(`[${w.name}] Job ${job?.name} failed:`, err.message));
    w.on("error", (err) => console.error(`[${w.name}] Worker error:`, err.message));
  });

  return allWorkers;
};

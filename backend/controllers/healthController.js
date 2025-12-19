import mongoose from "mongoose";
import { getRedis } from "../config/database.js";
import { getServerReady } from "../middleware/server.js";
import { getAllQueues } from "../lib/queues.js";

// PRODUCTION MONITORING: Track server health and usage
const serverMetrics = {
  startTime: Date.now(),
  requests: 0,
  coldStarts: 0,
  lastRequest: null,
};

export const healthCheck = async (req, res) => {
  serverMetrics.requests++;
  serverMetrics.lastRequest = Date.now();

  // Detect cold start (server started < 30s ago)
  const isColdStart = process.uptime() < 30;
  if (isColdStart && serverMetrics.requests === 1) {
    serverMetrics.coldStarts++;
  }

  const redis = getRedis();
  const mongoStatus =
    mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  const redisStatus = redis?.status || "disconnected";

  // BullMQ queue status
  let queues = {};
  let cronJobs = [];
  try {
    const allQueues = getAllQueues();
    for (const [name, queue] of Object.entries(allQueues)) {
      if (queue) {
        const counts = await queue.getJobCounts("active", "waiting", "delayed", "failed");
        queues[name] = counts;

        // Show registered repeatable (cron) jobs
        const repeatables = await queue.getRepeatableJobs();
        for (const r of repeatables) {
          cronJobs.push({
            queue: name,
            name: r.name,
            pattern: r.pattern,
            next: r.next ? new Date(r.next).toISOString() : null,
          });
        }
      }
    }
  } catch {
    queues = { error: "Unable to fetch queue status" };
  }

  res.json({
    status: getServerReady() ? "ok" : "starting",
    server: {
      uptime: process.uptime(),
      startedAt: new Date(serverMetrics.startTime).toISOString(),
      isColdStart,
      isReady: getServerReady(),
    },
    services: {
      mongodb: mongoStatus,
      redis: redisStatus,
    },
    queues,
    cronJobs,
    metrics: {
      totalRequests: serverMetrics.requests,
      coldStarts: serverMetrics.coldStarts,
      lastRequest: serverMetrics.lastRequest
        ? new Date(serverMetrics.lastRequest).toISOString()
        : null,
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + " MB",
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + " MB",
    },
  });
};

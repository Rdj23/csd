/**
 * Shared BullMQ Redis connection.
 *
 * Deliberately SEPARATE from the client in config/redis.js — see the comment
 * below for the connection-count arithmetic that forces it.
 *
 * Sibling modules: config/redis.js, config/mongo.js, lib/cache.js.
 */

import Redis from "ioredis";
import logger from "./logger.js";

// ── Shared BullMQ connection ─────────────────────────────────────────────
// This function used to return a plain CONFIG OBJECT. BullMQ treats that as
// "make your own connection", so every Queue and every Worker opened its own:
//
//   1 app + 2 pubsub + 7 queues + 7 workers × 2  =  ~24 connections
//
// Render's free Key Value tier allows 50. At 24 for one process, a split
// api + worker topology needed ~47/50 and was effectively blocked — which is
// why everything runs hybrid on a single instance today.
//
// Passing a shared IORedis INSTANCE instead makes BullMQ reuse it for all
// non-blocking commands. Queues stop opening connections entirely; Workers
// still call .duplicate() for their blocking BRPOPLPUSH connection, which is
// required and correct. New math:
//
//   1 app + 2 pubsub + 1 shared + 7 worker-blocking  =  ~11 connections
//
// BullMQ marks an injected instance as `shared` and will NOT quit it on
// Worker.close()/Queue.close(), so lifecycle stays owned by closeBullMQConnection()
// below. Note this is deliberately SEPARATE from the main `redis` client: the
// app client uses maxRetriesPerRequest: 3, and BullMQ requires null.
let bullmqRedis = null;

export const getBullMQConnection = () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  if (bullmqRedis) return bullmqRedis;
  try {
    bullmqRedis = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required by BullMQ — must never be a number
      enableReadyCheck: false, // BullMQ manages readiness itself
      connectTimeout: 10000,
      retryStrategy: (times) => Math.min(times * 2000, 30000),
    });
    bullmqRedis.on("error", (err) => {
      if (!err.message.includes("ECONNRESET")) logger.error({ err }, "BullMQ Redis error");
    });
    bullmqRedis.on("ready", () => logger.info("BullMQ Redis connection ready (shared across all queues)"));
    return bullmqRedis;
  } catch (err) {
    logger.error({ err }, "BullMQ Redis init failed");
    return null;
  }
};

/** Close the shared BullMQ connection. Call AFTER all workers/queues close. */
export const closeBullMQConnection = async () => {
  if (!bullmqRedis) return;
  try {
    await bullmqRedis.quit();
  } catch {
    bullmqRedis.disconnect();
  }
  bullmqRedis = null;
};

/**
 * Redis client lifecycle — connect, expose, report readiness.
 *
 * This module owns the single `redis` client instance. Nothing else may hold
 * it; consumers call getRedis() so there is exactly one place that decides
 * whether a client exists and is usable.
 *
 * The CACHE API (redisGet / redisSet / locks / TTLs) deliberately lives in
 * lib/cache.js instead — that is what application code calls. This file is
 * infrastructure and should only change when connection behaviour changes.
 *
 * Sibling modules: config/mongo.js, config/bullmq.js, lib/cache.js.
 */

import Redis from "ioredis";
import logger from "./logger.js";

let redis = null;

export const getRedis = () => redis;

export const isRedisReady = () => redis && redis.status === "ready";

// --- REDIS CONNECTION ---
export const initRedis = async () => {
  const REDIS_URL = process.env.REDIS_URL;

  // Skip Redis if no URL provided (local dev without Redis)
  if (!REDIS_URL) {
    logger.warn("No REDIS_URL - running without Redis cache");
    return;
  }

  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 10000,
      lazyConnect: true,
      // Reconnect with backoff, but give up after 30 retries (~6 min) to prevent
      // hanging requests from accumulating in memory when Redis is truly down.
      retryStrategy(times) {
        if (times > 30) {
          logger.error({ attempt: times }, "Redis reconnect giving up after 30 retries");
          return null; // Stop retrying — operations will fail gracefully
        }
        const delay = Math.min(times * 2000, 30000);
        if (times % 10 === 0) {
          logger.info({ attempt: times, nextRetryMs: delay }, "Redis reconnecting");
        }
        return delay;
      },
      reconnectOnError(err) {
        // Reconnect on connection reset errors
        const targetErrors = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"];
        return targetErrors.some((e) => err.message.includes(e));
      },
    });

    redis.on("connect", () => logger.info("Redis connected"));
    redis.on("ready", async () => {
      logger.info("Redis ready");
      // Set eviction policy so Redis drops old cache keys instead of refusing all writes (OOM)
      try {
        await redis.config("SET", "maxmemory-policy", "allkeys-lru");
        logger.info("Redis maxmemory-policy set to allkeys-lru");
      } catch {
        // Managed Redis (like Render) may not allow CONFIG SET — that's fine
        logger.info("Could not set maxmemory-policy (managed Redis)");
      }
    });
    redis.on("close", () => logger.warn("Redis connection closed — will reconnect"));
    redis.on("error", (err) => {
      // Only log non-repetitive errors (suppress flood during reconnection)
      if (!err.message.includes("ECONNRESET")) {
        logger.error({ err }, "Redis error");
      }
    });

    // Connect in background - don't block server startup
    redis.connect().catch((err) => {
      logger.error({ err }, "Redis init failed");
      logger.warn("Will keep retrying via retryStrategy");
    });
  } catch (err) {
    logger.error({ err }, "Redis init failed");
    logger.warn("Continuing without Redis cache");
    redis = null;
  }
};

// --- REDIS URL EXPORT (for BullMQ and Pub/Sub connections) ---
export const getRedisUrl = () => process.env.REDIS_URL || null;

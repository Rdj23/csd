import mongoose from "mongoose";
import Redis from "ioredis";
import logger from "./logger.js";

// --- REDIS CACHE HELPERS ---
export const CACHE_TTL = {
  ANALYTICS: 900, // 15 minutes
  TICKETS: 300, // 5 minutes
  LEADERBOARD: 1800, // 30 minutes
  DRILLDOWN: 300, // 5 minutes
};

let redis = null;

export const getRedis = () => redis;

export const isRedisReady = () => redis && redis.status === "ready";

export const redisGet = async (key) => {
  if (!isRedisReady()) return null;
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    logger.error({ err: e, key }, "Redis GET error");
    return null;
  }
};

export const redisSet = async (key, data, ttl = 1800) => {
  if (!isRedisReady()) return false;
  try {
    await redis.setex(key, ttl, JSON.stringify(data));
    return true;
  } catch (e) {
    logger.error({ err: e, key }, "Redis SET error");
    return false;
  }
};

export const redisDelete = async (pattern) => {
  if (!isRedisReady()) return;
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.info({ count: keys.length, pattern }, "Cleared cache keys");
    }
  } catch (e) {
    logger.error({ err: e, pattern }, "Redis DEL error");
  }
};

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
      // Never give up — keep reconnecting forever with backoff
      retryStrategy(times) {
        const delay = Math.min(times * 2000, 30000); // max 30s between retries
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

/**
 * Parse REDIS_URL into a BullMQ-compatible connection object.
 * BullMQ requires maxRetriesPerRequest: null.
 */
export const getBullMQConnection = () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  try {
    const parsed = new URL(redisUrl);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 6379,
      password: parsed.password || undefined,
      username: parsed.username || "default",
      tls: parsed.protocol === "rediss:" ? {} : undefined,
      maxRetriesPerRequest: null, // Required by BullMQ
    };
  } catch {
    return null;
  }
};

// --- MONGODB CONNECTION ---
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

export const connectMongoDB = async () => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 30000,
        retryWrites: true,
      });
      logger.info("MongoDB connected");
      return;
    } catch (err) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s, 16s
      logger.error(
        { err, attempt, maxRetries: MAX_RETRIES, nextRetryMs: delay },
        "MongoDB connection failed",
      );
      if (attempt === MAX_RETRIES) {
        logger.fatal("MongoDB connection failed after all retries");
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};

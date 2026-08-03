import crypto from "crypto";
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

/**
 * Return the raw JSON string from Redis WITHOUT parsing.
 * Used by cache-hit paths that pipe directly to res.end() to avoid
 * an unnecessary JSON.parse → JSON.stringify round-trip.
 */
export const redisGetRaw = async (key) => {
  if (!isRedisReady()) return null;
  try {
    return await redis.get(key);
  } catch (e) {
    logger.error({ err: e, key }, "Redis GET (raw) error");
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

// ── REDIS HASH HELPERS ──────────────────────────────────────────────────
// Used for per-item lookups (e.g., individual ticket by display_id) where
// parsing the entire collection blob would be wasteful. Redis Hashes store
// field→value pairs under a single key, so HGET is O(1) per lookup.

/**
 * Get a single field from a Redis Hash, JSON-parsed.
 * Returns null if Redis is down, the hash doesn't exist, or the field is missing.
 */
export const redisHGet = async (key, field) => {
  if (!isRedisReady()) return null;
  try {
    const data = await redis.hget(key, field);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    logger.error({ err: e, key, field }, "Redis HGET error");
    return null;
  }
};

/**
 * Set multiple fields in a Redis Hash from a Map or Object.
 * Each value is JSON-serialized. Sets TTL on the hash key after writing.
 *
 * WHY A PIPELINE:
 * HSET with 3000 fields in one call works, but pipeline lets Redis batch
 * the TTL command atomically. For 3000 tickets this takes ~5ms vs ~50ms
 * for individual HSET calls.
 */
export const redisHSetBatch = async (key, entries, ttl = 1800) => {
  if (!isRedisReady()) return false;
  try {
    // Chunked pipelines: one pipeline holding every stringified ticket
    // buffered ~a full cache blob in process memory at once — a real
    // problem on the 512MB API+worker instance. Each chunk's strings are
    // GC-able as soon as its exec() resolves.
    const CHUNK = 200;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const pipeline = redis.pipeline();
      for (const [field, value] of entries.slice(i, i + CHUNK)) {
        pipeline.hset(key, field, JSON.stringify(value));
      }
      if (i + CHUNK >= entries.length) pipeline.expire(key, ttl);
      await pipeline.exec();
    }
    return true;
  } catch (e) {
    logger.error({ err: e, key }, "Redis HSET batch error");
    return false;
  }
};

/**
 * Set a key from an ALREADY-stringified JSON payload. Use when the caller
 * needs the JSON string anyway (size checks) — avoids redisSet's second
 * full JSON.stringify of a multi-MB object.
 */
export const redisSetRaw = async (key, json, ttl = 1800) => {
  if (!isRedisReady()) return false;
  try {
    await redis.setex(key, ttl, json);
    return true;
  } catch (e) {
    logger.error({ err: e, key }, "Redis SET (raw) error");
    return false;
  }
};

/**
 * Acquire a Redis lock to prevent cache stampede (thundering herd).
 *
 * Returns a unique token (string) if the lock was acquired, or null if
 * another worker holds it. Pass the token to redisUnlock() so that only
 * the lock owner can release it — preventing the classic race where a
 * slow worker deletes a *different* worker's lock after TTL expiry.
 *
 * When Redis is unavailable the function returns "no-redis" (truthy) so
 * callers that do `if (!token)` still proceed correctly.
 */
export const redisLock = async (key, ttlSeconds = 30) => {
  if (!isRedisReady()) return "no-redis";
  try {
    const token = crypto.randomUUID();
    const result = await redis.set(key, token, "EX", ttlSeconds, "NX");
    return result === "OK" ? token : null;
  } catch (e) {
    logger.error({ err: e, key }, "Redis LOCK error");
    return "no-redis"; // On error, allow computation
  }
};

/**
 * Release a Redis lock **only if the caller still owns it**.
 *
 * Uses a Lua script executed atomically on the Redis server:
 *   GET key → compare with token → DEL only if they match.
 * This prevents Worker A from accidentally deleting Worker B's lock
 * after Worker A's TTL expired and Worker B re-acquired the key.
 */
const UNLOCK_LUA = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

export const redisUnlock = async (key, token) => {
  if (!isRedisReady() || !token || token === "no-redis") return;
  try {
    await redis.eval(UNLOCK_LUA, 1, key, token);
  } catch (e) {
    logger.error({ err: e, key }, "Redis UNLOCK error");
  }
};

export const redisDelete = async (pattern) => {
  if (!isRedisReady()) return;
  try {
    // Use SCAN instead of KEYS to avoid blocking Redis under load.
    // KEYS iterates ALL keys in one blocking call — with 100 users and thousands
    // of cache keys, this can block Redis for 100ms+, stalling all other requests.
    // SCAN iterates in small batches (default 10), yielding between batches.
    let cursor = "0";
    let totalDeleted = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
        totalDeleted += keys.length;
      }
    } while (cursor !== "0");
    if (totalDeleted > 0) {
      logger.info({ count: totalDeleted, pattern }, "Cleared cache keys");
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
        maxPoolSize: 50,      // 70 concurrent users need ~50 connections (was 20 — caused queuing)
        minPoolSize: 10,      // Keep 10 warm connections ready for instant use
        maxIdleTimeMS: 30000, // Close idle connections after 30s to free up Atlas connection slots
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

/**
 * Cache API — the redis* helpers application code actually calls.
 *
 * WHY THIS IS NOT config/redis.js: that module owns the CLIENT (connect,
 * readiness, shutdown). This one owns the CACHE CONTRACT — key TTLs, the
 * get/set/batch/hash/lock helpers, and the invalidation patterns. Changing a
 * TTL or adding a helper should never mean touching connection code.
 *
 * EVERY HELPER IS BEST-EFFORT. Each one guards on isRedisReady() and swallows
 * its own errors, returning a miss-shaped fallback (null / empty Map / false).
 * A cache failure must never fail the request that produced the data.
 *
 * The client is bound per-call via getRedis() rather than held at module
 * scope, so this file never caches a stale or pre-connection client.
 */

import crypto from "crypto";
import logger from "../config/logger.js";
import { getRedis, isRedisReady } from "../config/redis.js";

// --- REDIS CACHE HELPERS ---
export const CACHE_TTL = {
  ANALYTICS: 900, // 15 minutes
  TICKETS: 300, // 5 minutes
  LEADERBOARD: 1800, // 30 minutes
  DRILLDOWN: 300, // 5 minutes

  // Live active-ticket cache (tickets:active + :gz + :sig + :etag + :hash).
  //
  // MUST comfortably exceed the sync cron interval. At the old 300s these keys
  // expired ~5 min after every sync and only stayed warm because webhook
  // traffic happened to rewrite them — so any quiet spell (nights, weekends,
  // a missed webhook) left the cache absent, which is what drove the
  // "tickets:active missing — repopulating" path in activityService and the
  // cold-start fetch in ticketController.
  //
  // With the cron at 4h a 5-min TTL would mean the cache is genuinely gone for
  // most of every interval. 6h gives a full cycle of margin: a sync always
  // lands before expiry, so the cache is continuously warm and webhooks only
  // make it fresher. Affordable now that it holds active tickets only (~1MB,
  // down from 9.23MB) against the 25MB Valkey cap.
  ACTIVE_TICKETS: 6 * 3600, // 6 hours
};

export const redisGet = async (key) => {
  if (!isRedisReady()) return null;
  const redis = getRedis();
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
  const redis = getRedis();
  try {
    return await redis.get(key);
  } catch (e) {
    logger.error({ err: e, key }, "Redis GET (raw) error");
    return null;
  }
};

/**
 * Batch GET + JSON.parse for many keys in ONE round trip (MGET).
 * Returns a Map of key → parsed value, containing ONLY the keys that hit.
 *
 * Doing this as N sequential redisGet() calls would be N round trips; on a
 * batch of 50 ticket ids that is the difference between ~1ms and ~50ms of
 * pure latency before any work starts.
 */
export const redisMGet = async (keys) => {
  const out = new Map();
  if (!isRedisReady() || !keys.length) return out;
  const redis = getRedis();
  try {
    const values = await redis.mget(keys);
    keys.forEach((key, i) => {
      const raw = values[i];
      if (raw == null) return;
      try {
        out.set(key, JSON.parse(raw));
      } catch {
        // Corrupt entry — treat as a miss so the caller recomputes it.
      }
    });
  } catch (e) {
    logger.error({ err: e, count: keys.length }, "Redis MGET error");
  }
  return out;
};

/**
 * Batch SETEX via a pipeline. `entries` = [[key, value, ttlSeconds], ...].
 * Values are JSON-serialized. Best-effort: a cache write failure must never
 * fail the request that produced the data.
 */
export const redisMSet = async (entries, defaultTtl = 1800) => {
  if (!isRedisReady() || !entries.length) return false;
  const redis = getRedis();
  try {
    const pipeline = redis.pipeline();
    for (const [key, value, ttl] of entries) {
      pipeline.setex(key, ttl || defaultTtl, JSON.stringify(value));
    }
    await pipeline.exec();
    return true;
  } catch (e) {
    logger.error({ err: e, count: entries.length }, "Redis MSET error");
    return false;
  }
};

export const redisSet = async (key, data, ttl = 1800) => {
  if (!isRedisReady()) return false;
  const redis = getRedis();
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
  const redis = getRedis();
  try {
    const data = await redis.hget(key, field);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    logger.error({ err: e, key, field }, "Redis HGET error");
    return null;
  }
};

/**
 * Batch HGET (HMGET) — many fields of ONE hash in a single round trip.
 * Returns a Map of field → parsed value, containing only the fields that hit.
 */
export const redisHMGet = async (key, fields) => {
  const out = new Map();
  if (!isRedisReady() || !fields.length) return out;
  const redis = getRedis();
  try {
    const values = await redis.hmget(key, ...fields);
    fields.forEach((field, i) => {
      const raw = values[i];
      if (raw == null) return;
      try {
        out.set(field, JSON.parse(raw));
      } catch {
        // Corrupt field — treat as a miss.
      }
    });
  } catch (e) {
    logger.error({ err: e, key, count: fields.length }, "Redis HMGET error");
  }
  return out;
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
  const redis = getRedis();
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
  const redis = getRedis();
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
  const redis = getRedis();
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
  const redis = getRedis();
  try {
    await redis.eval(UNLOCK_LUA, 1, key, token);
  } catch (e) {
    logger.error({ err: e, key }, "Redis UNLOCK error");
  }
};

export const redisDelete = async (pattern) => {
  if (!isRedisReady()) return;
  const redis = getRedis();
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

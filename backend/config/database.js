import mongoose from "mongoose";
import Redis from "ioredis";

// --- REDIS CACHE HELPERS ---
export const CACHE_TTL = {
  ANALYTICS: 1800, // 30 minutes
  TICKETS: 300, // 5 minutes
  LEADERBOARD: 3600, // 1 hour
  DRILLDOWN: 600, // 10 minutes
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
    console.error("Redis GET error:", e.message);
    return null;
  }
};

export const redisSet = async (key, data, ttl = 1800) => {
  if (!isRedisReady()) return false;
  try {
    await redis.setex(key, ttl, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error("Redis SET error:", e.message);
    return false;
  }
};

export const redisDelete = async (pattern) => {
  if (!isRedisReady()) return;
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`🗑️ Cleared ${keys.length} cache keys: ${pattern}`);
    }
  } catch (e) {
    console.error("Redis DEL error:", e.message);
  }
};

// --- REDIS CONNECTION ---
export const initRedis = async () => {
  const REDIS_URL = process.env.REDIS_URL;

  // Skip Redis if no URL provided (local dev without Redis)
  if (!REDIS_URL) {
    console.log("⚠️ No REDIS_URL - running without Redis cache");
    return;
  }

  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 10000,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 10) {
          console.error("🔴 Redis: giving up after 10 retries");
          return null; // stop retrying
        }
        const delay = Math.min(times * 1000, 15000);
        console.log(`🔄 Redis: reconnecting in ${delay}ms (attempt ${times})`);
        return delay;
      },
    });

    redis.on("connect", () => console.log("🟢 Redis Connected"));
    redis.on("ready", () => console.log("🟢 Redis Ready"));
    redis.on("close", () => console.log("🔴 Redis Connection Closed"));
    redis.on("error", (err) => {
      console.error("Redis Error:", err.message);
      // ioredis will auto-retry via retryStrategy — don't disconnect here
    });

    // Connect in background - don't block server startup
    redis.connect().catch((err) => {
      console.error("Redis Init Failed:", err.message);
      console.log("⚠️ Will keep retrying via retryStrategy");
    });
  } catch (err) {
    console.error("Redis Init Failed:", err.message);
    console.log("⚠️ Continuing without Redis cache");
    redis = null;
  }
};

// --- MONGODB CONNECTION ---
// Returns a promise; resolves when connected (or failed)
export const connectMongoDB = () => {
  return mongoose
    .connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 30000,
    })
    .then(() => {
      console.log("🍃 MongoDB Connected");
    })
    .catch((err) => {
      console.error("❌ MongoDB Error:", err);
    });
};

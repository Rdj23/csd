import { getRedis, redisDelete } from "../config/database.js";

export const getCacheStatus = async (req, res) => {
  const redis = getRedis();
  let redisKeys = [];

  if (redis) {
    try {
      redisKeys = await redis.keys("*");
    } catch (e) {
      redisKeys = ["Error: " + e.message];
    }
  }

  res.json({
    redis: {
      status: redis?.status || "disconnected",
      keys: redisKeys.length,
      keyList: redisKeys.slice(0, 20),
    },
    memory: process.memoryUsage(),
  });
};

export const clearCache = async (req, res) => {
  await redisDelete("*");
  res.json({ success: true, message: "Redis cache cleared" });
};

import { getRedis, redisDelete } from "../config/database.js";
import { ok } from "../utils/response.js";

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

  ok(res, {
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
  ok(res, { message: "Redis cache cleared" });
};

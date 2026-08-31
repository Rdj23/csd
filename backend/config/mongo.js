/**
 * MongoDB connection.
 *
 * Split out of the former config/database.js, which held Mongo, Redis, the
 * Redis cache API and the BullMQ connection in one 444-line file. Connection
 * settings for one database should not require scrolling past another's.
 *
 * Sibling modules: config/redis.js (Redis client), config/bullmq.js (queue
 * connection), lib/cache.js (the redisGet/redisSet cache API).
 */

import mongoose from "mongoose";
import logger from "./logger.js";

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

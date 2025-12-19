import express from "express";
import jwt from "jsonwebtoken";
import { mountRoutes } from "../routes/index.js";
import {
  coopHeaders,
  corsMiddleware,
  helmetMiddleware,
  compressionMiddleware,
  jsonParser,
  urlencodedParser,
} from "../middleware/server.js";
import { verifyToken, requireAdmin } from "../middleware/auth.js";

const TEST_SECRET = process.env.JWT_SECRET || "test-secret-for-vitest";

/**
 * Creates a lightweight Express app with all middleware and routes mounted.
 * Does NOT connect to MongoDB, Redis, or BullMQ — those are handled by mocks/stubs.
 */
export function createTestApp() {
  const app = express();
  app.set("trust proxy", 1);

  app.use(coopHeaders);
  app.use(helmetMiddleware);
  app.use(corsMiddleware);
  app.use(compressionMiddleware);
  app.use(jsonParser);
  app.use(urlencodedParser);

  // Auth middleware (skip rate limiters in tests)
  app.use("/api", verifyToken);
  app.use("/api/admin", requireAdmin);

  mountRoutes(app);

  return app;
}

/**
 * Sign a test JWT for a given email.
 */
export function getAuthToken(email = "testuser@clevertap.com") {
  return jwt.sign(
    { email, name: "Test User" },
    TEST_SECRET,
    { expiresIn: "1h" },
  );
}

/**
 * Sign a test JWT for the admin email.
 */
export function getAdminToken() {
  return getAuthToken("rohan.jadhav@clevertap.com");
}

/**
 * Sign a test JWT for a non-CleverTap email (should be rejected).
 */
export function getNonCTToken() {
  return jwt.sign(
    { email: "attacker@gmail.com", name: "Attacker" },
    TEST_SECRET,
    { expiresIn: "1h" },
  );
}

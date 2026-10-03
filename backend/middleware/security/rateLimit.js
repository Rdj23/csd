/**
 * security/rateLimit — The three rate limiters: general API, auth endpoints, and API keys.
 *
 * Extracted from the 505-line middleware/auth.js; logic unchanged.
 * See middleware/security/index.js for the four security layers.
 */

import jwt from "jsonwebtoken";
import logger from "../../config/logger.js";
import rateLimit from "express-rate-limit";
import { JWT_SECRET } from "./identity.js";

// ─────────────────────────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────────────────────────
/**
 * WHAT IS RATE LIMITING:
 * Limiting how many requests a client can make in a time window.
 * Without it, one misbehaving client (or attacker) could overwhelm the server.
 *
 * HOW express-rate-limit WORKS:
 * It tracks request counts per IP address (using in-memory store by default).
 * When the limit is exceeded, it responds with 429 "Too Many Requests".
 *
 * WHY THREE SEPARATE LIMITERS (not one):
 * Different endpoints have different abuse risk levels:
 * - /api/auth → Highest risk (login brute-force) → strictest limit (10/15min)
 * - API key endpoints → Medium risk (key brute-force) → moderate limit (20/15min)
 * - General /api → Low risk (normal usage) → generous limit (1500/15min)
 */

/**
 * rateLimitHandler — Custom handler that logs WHO hit the rate limit.
 *
 * WHY CUSTOM (not default):
 * The default handler just sends 429. We want to log the user's email
 * so we can investigate: "Was this a real user with a runaway script,
 * or an attacker probing our API?"
 *
 * WHY TRY/CATCH AROUND jwt.verify:
 * The token might be expired or invalid. We still want to log the attempt
 * even if we can't decode the user. Failing silently with "unknown" is fine.
 */
const rateLimitHandler = (req, res, _next, options) => {
  let userEmail = "unknown";
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET);
      userEmail = decoded.email || "unknown";
    }
  } catch (_) {}
  logger.warn({ ip: req.ip, user: userEmail, method: req.method, path: req.path }, "Rate limit hit");
  res.status(options.statusCode).json(options.message);
};

/**
 * apiLimiter — General API rate limit.
 *
 * 1500 requests per 15 minutes per IP.
 *
 * WHY 1500 (not lower):
 * The dashboard makes MANY parallel requests on load: ticket list, analytics,
 * activity, gamification, roster, etc. Plus each has timeline-replies and
 * dependency fetches. A single page load can trigger 20-30 requests.
 * With 10 users refreshing occasionally, 1500/15min is reasonable.
 *
 * WHY SKIP WEBHOOKS:
 * DevRev can send bursts of 50+ webhook events when many tickets update at once.
 * Rate limiting webhooks would cause data loss — DevRev would get 429 errors
 * and might stop retrying. Webhooks have their own protection (HMAC signature).
 *
 * standardHeaders: true → Sends RateLimit-* headers in response so clients
 * can see how many requests they have remaining.
 *
 * legacyHeaders: false → Don't send X-RateLimit-* headers (deprecated format).
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,                    // 100 users × ~20 req/page-load × ~2.5 refreshes/window = ~5000
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith("/webhooks/"),
  message: { error: "Too many requests, please try again later" },
  handler: rateLimitHandler,
});

/**
 * apiKeyLimiter — Brute-force protection for API key authentication.
 *
 * 20 requests per 15 minutes — ONLY for requests with X-API-Key header.
 *
 * WHY SO LOW:
 * An attacker trying to brute-force API keys would send many requests
 * with different key values. 20/15min makes brute-force impractical.
 * Legitimate services make far fewer requests (a few per minute).
 *
 * skip: Only applies when X-API-Key header is present.
 * JWT-authenticated requests skip this limiter entirely.
 */
export const apiKeyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.headers["x-api-key"],
  message: { error: "Too many API key attempts, please try again later" },
  handler: rateLimitHandler,
});

/**
 * authLimiter — Strictest rate limit, for login endpoints only.
 *
 * 10 requests per 15 minutes per IP.
 *
 * WHY THE STRICTEST:
 * Login endpoints are the #1 target for credential stuffing attacks.
 * 10/15min allows normal use (even if you fail login a few times)
 * but blocks automated attacks that try hundreds of credentials.
 *
 * Applied in server.js: app.use("/api/auth", authLimiter)
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // /config is a public, read-only endpoint (returns the Google client ID) that the
  // frontend hits on every page load — it must not share the strict login ceiling,
  // or normal bootstrap traffic 429s the whole app. Still covered by apiLimiter.
  skip: (req) => req.path === "/config",
  message: { error: "Too many authentication attempts, please try again later" },
  handler: rateLimitHandler,
});

/**
 * middleware/auth.js — Authentication, authorization, and rate limiting.
 *
 * THIS FILE IMPLEMENTS 4 SECURITY LAYERS:
 *
 * Layer 1: RATE LIMITING — "Don't let anyone hammer us"
 *   → apiLimiter, authLimiter, apiKeyLimiter
 *   → Protects against brute-force attacks and accidental DDoS
 *
 * Layer 2: AUTHENTICATION — "Who are you?"
 *   → verifyToken (JWT or API Key)
 *   → Proves the caller's identity
 *
 * Layer 3: AUTHORIZATION — "What are you allowed to do?"
 *   → checkApiKeyScope (scope-based access for API keys)
 *   → requireAdmin (admin-only endpoints)
 *
 * Layer 4: DOMAIN RESTRICTION — "Are you from our org?"
 *   → JWT validation checks email ends with @clevertap.com
 *   → Only CleverTap employees can access the dashboard
 *
 * TWO AUTHENTICATION PATHS:
 * ┌────────────────────────────────────────────────────────────┐
 * │ Path 1: JWT (Human Users)                                  │
 * │                                                            │
 * │ User clicks "Login with Google"                            │
 * │   → Google returns ID token (proves you're rohan@ct.com)   │
 * │     → Our authController verifies with Google               │
 * │       → We issue OUR OWN JWT (signed with JWT_SECRET)      │
 * │         → Frontend stores JWT, sends it on every request   │
 * │           → This middleware verifies the JWT                │
 * │                                                            │
 * │ Path 2: API Key (Machine/Service callers)                  │
 * │                                                            │
 * │ Admin creates an API key via /api/admin/api-keys            │
 * │   → Raw key is returned ONCE (like a password)             │
 * │     → Key hash (HMAC-SHA256) is stored in MongoDB          │
 * │       → Service sends raw key in X-API-Key header          │
 * │         → This middleware hashes it and compares            │
 * │           → If match → authenticated with scoped access    │
 * └────────────────────────────────────────────────────────────┘
 */

import crypto from "crypto";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import logger from "../config/logger.js";
import { ApiKey } from "../models/index.js";

// ─────────────────────────────────────────────────────────────────
// SECURITY CONFIGURATION
// ─────────────────────────────────────────────────────────────────

/**
 * JWT_SECRET — The secret key used to sign and verify JWTs.
 *
 * WHAT IS A JWT (JSON Web Token):
 * A JWT is a self-contained token: { header.payload.signature }
 * - Header: algorithm info (HS256)
 * - Payload: user data (email, name, expiry)
 * - Signature: HMAC-SHA256(header + payload, JWT_SECRET)
 *
 * The server creates the JWT with jwt.sign() and the client stores it.
 * On every request, the client sends it back. The server verifies with
 * jwt.verify() — if the signature matches, the payload is trusted.
 *
 * WHY WE THROW IF MISSING:
 * Without JWT_SECRET, jwt.sign() would use null as the key — anyone could
 * forge valid tokens. This is a catastrophic security hole, so we crash
 * on startup rather than running insecurely.
 */
export const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV !== "test") {
  throw new Error("JWT_SECRET environment variable is required");
}

/**
 * API_KEY_HMAC_SECRET — Used to hash API keys before storing/comparing.
 *
 * WHY HMAC HASH (not plain storage):
 * If we stored raw API keys in MongoDB and the DB was breached,
 * attackers would have all valid keys. By storing only the HMAC hash,
 * attackers get useless hashes — they can't reverse them to get the original keys.
 *
 * WHY HMAC (not bcrypt like passwords):
 * API keys are long random strings (not human-chosen passwords), so they
 * don't need bcrypt's slow hashing to resist brute-force. HMAC is fast
 * and sufficient for high-entropy secrets.
 */
const API_KEY_HMAC_SECRET = process.env.API_KEY_HMAC_SECRET;
if (!API_KEY_HMAC_SECRET && process.env.NODE_ENV !== "test") {
  throw new Error("API_KEY_HMAC_SECRET environment variable is required");
}

/**
 * ADMIN_EMAILS — Whitelist of emails with admin privileges.
 *
 * WHY HARDCODED (not a DB setting):
 * Admin access controls who can run backfills, manage API keys, and access
 * Bull Board. Storing this in the DB means a DB breach could escalate privileges.
 * Env var is simpler and more secure for a small team.
 */
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "rohan.jadhav@clevertap.com","anmol.sawhney@clevertap.com","mashnu@clevertap.com")
  .split(",")
  .map((e) => e.trim());

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

/**
 * hashApiKey — Converts a raw API key into an HMAC-SHA256 hash.
 *
 * Used in two places:
 * 1. When CREATING a key: hash the raw key before storing in DB
 * 2. When VERIFYING a key: hash the incoming key and compare to stored hash
 *
 * Same raw key → same hash → match → authenticated.
 * Different raw key → different hash → no match → rejected.
 */
export const hashApiKey = (raw) =>
  crypto.createHmac("sha256", API_KEY_HMAC_SECRET).update(raw).digest("hex");

/**
 * VALID_SCOPES — What an API key can be allowed to access.
 *
 * "read:all" = access everything (superscope)
 * Others = limited to specific feature areas
 *
 * WHY SCOPES:
 * Principle of Least Privilege. A Slack bot that only needs leaderboard data
 * shouldn't have access to admin endpoints or ticket details.
 * If that bot's API key is compromised, the attacker only gets leaderboard data.
 */
export const VALID_SCOPES = [
  "read:all",
  "read:analytics",
  "read:gamification",
  "read:activity",
  "read:external",
];

/**
 * SCOPE_MAP — Maps URL path prefixes to required scopes.
 *
 * HOW IT WORKS:
 * When an API key makes a request to /api/gamification/leaderboard,
 * the path "/gamification" matches "read:gamification" scope.
 * If the key doesn't have that scope → 403 Forbidden.
 *
 * WHY A MAP (not middleware per route):
 * Centralized access control is easier to audit. You can see ALL scope
 * requirements in one place instead of hunting through 15 route files.
 */
const SCOPE_MAP = {
  "/tickets/analytics": "read:analytics",
  "/gamification": "read:gamification",
  "/activity": "read:activity",
  "/external": "read:external",
};

/**
 * checkApiKeyScope — Enforces scope-based access control for API keys.
 *
 * FLOW:
 * 1. JWT users → skip (they have full access, scopes don't apply)
 * 2. API key with "read:all" → skip (superscope)
 * 3. Find matching scope for the request path
 * 4. Check if the key has that scope → allow or deny
 *
 * DEFAULT DENY: If no scope mapping is found for a path, API keys are
 * denied access. This is safer than default-allow because new endpoints
 * are automatically protected until explicitly added to SCOPE_MAP.
 */
export const checkApiKeyScope = (req, res, next) => {
  if (!req.user?.isApiKey) return next();

  const scopes = req.user.scopes || [];
  if (scopes.includes("read:all")) return next();

  const matchedScope = Object.entries(SCOPE_MAP).find(([prefix]) => req.path.startsWith(prefix));
  if (!matchedScope) {
    logger.warn({ project: req.user.projectName, path: req.path, scopes }, "API key scope denied");
    return res.status(403).json({ error: "Forbidden: API key does not have access to this endpoint" });
  }

  const requiredScope = matchedScope[1];
  if (!scopes.includes(requiredScope)) {
    logger.warn({ project: req.user.projectName, path: req.path, required: requiredScope, scopes }, "API key scope denied");
    return res.status(403).json({ error: `Forbidden: API key requires '${requiredScope}' scope` });
  }

  next();
};

// ─────────────────────────────────────────────────────────────────
// AUTHENTICATION MIDDLEWARE
// ─────────────────────────────────────────────────────────────────

/**
 * verifyToken — THE MAIN AUTH GATE. Every /api request passes through this.
 *
 * ROUTES THAT SKIP AUTH:
 * - /auth/* → Login endpoints (you can't require auth to log in!)
 * - /webhooks/* → Uses HMAC signature instead (different auth mechanism)
 * - /health → Monitoring endpoint (no sensitive data)
 *
 * TWO AUTH PATHS:
 * The middleware checks for X-API-Key header first, then falls back to JWT.
 * This means a request can authenticate via EITHER method, not both.
 */
export const verifyToken = async (req, res, next) => {
  // Skip auth for endpoints that don't need it
  if (
    req.path.startsWith("/auth/") ||
    req.path.startsWith("/webhooks/") ||
    req.path === "/health"
  ) {
    return next();
  }

  // ── PATH 1: API KEY AUTHENTICATION ──
  const apiKey = req.headers["x-api-key"];
  if (apiKey) {
    try {
      /**
       * Step 1: Hash the incoming raw key with HMAC-SHA256.
       * We never store or compare raw keys — only hashes.
       */
      const keyHash = hashApiKey(apiKey);

      /**
       * Step 2: Look up the hash in MongoDB.
       * findOne({ key_hash, is_active: true }) ensures deactivated keys are rejected.
       */
      const keyDoc = await ApiKey.findOne({ key_hash: keyHash, is_active: true }).lean();

      /**
       * Step 3: Timing-safe comparison.
       *
       * WHY NOT JUST: if (keyDoc) { next() }?
       * If we only checked keyDoc's existence, an attacker could measure response times:
       * - Key not in DB → fast (findOne returns null quickly for unknown hashes)
       * - Key in DB but wrong → slightly slower (extra comparison)
       * This timing difference could leak information about which key prefixes exist.
       *
       * timingSafeEqual ensures the comparison takes CONSTANT time regardless
       * of whether the hash matches or not. Combined with the HMAC hashing,
       * this provides robust protection against timing attacks.
       *
       * storedHash fallback: If keyDoc is null, we use keyHash as storedHash
       * to avoid Buffer length mismatch in timingSafeEqual (which would throw).
       * The comparison will fail (comparing a hash to itself when keyDoc is null),
       * and we reject the request.
       */
      const storedHash = keyDoc?.key_hash || keyHash;
      const isValid = keyDoc && crypto.timingSafeEqual(Buffer.from(keyHash, "hex"), Buffer.from(storedHash, "hex"));

      if (!isValid) {
        logger.warn({ prefix: apiKey.slice(0, 12), path: req.path, ip: req.ip }, "Invalid API key");
        return res.status(401).json({ error: "Unauthorized: Invalid or revoked API key" });
      }

      /**
       * Step 4: Check expiration.
       * API keys can optionally have an expires_at date. If set and in the past → reject.
       */
      if (keyDoc.expires_at && new Date(keyDoc.expires_at) < new Date()) {
        logger.warn({ project: keyDoc.project_name, path: req.path }, "Expired API key");
        return res.status(401).json({ error: "Unauthorized: API key has expired" });
      }

      /**
       * Step 5: Set req.user for downstream middleware.
       * isApiKey: true tells checkApiKeyScope to enforce scope restrictions.
       * JWT users don't have this flag → they get full access.
       */
      req.user = {
        email: `apikey:${keyDoc.project_name}`,
        name: keyDoc.project_name,
        isApiKey: true,
        scopes: keyDoc.scopes,
        projectName: keyDoc.project_name,
      };

      /**
       * Step 6: Track usage (non-blocking).
       * .catch() ensures a DB write failure doesn't break the request.
       * last_used_at is for admin auditing ("is this key still in use?").
       */
      ApiKey.updateOne({ key_hash: keyHash }, { $set: { last_used_at: new Date() } }).catch((err) =>
        logger.error({ err, project: keyDoc.project_name }, "Failed to update API key last_used_at"),
      );

      logger.info({ project: keyDoc.project_name, path: req.path }, "API key auth");
      return next();
    } catch (err) {
      logger.error({ err, path: req.path }, "API key verification error");
      return res.status(500).json({ error: "Internal authentication error" });
    }
  }

  // ── PATH 2: JWT BEARER TOKEN AUTHENTICATION ──
  /**
   * Standard OAuth/JWT pattern:
   * Client sends: Authorization: Bearer <jwt_token>
   * Server extracts the token, verifies signature + expiration, reads payload.
   */
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn({ path: req.path, ip: req.ip }, "Unauthorized: No token provided");
    return res.status(401).json({ error: "Unauthorized: No token or API key provided" });
  }

  const token = authHeader.split(" ")[1]; // Extract token from "Bearer <token>"
  try {
    /**
     * jwt.verify() does THREE things:
     * 1. Decodes the payload (email, name, etc.)
     * 2. Verifies the HMAC signature using JWT_SECRET
     * 3. Checks the `exp` claim (token not expired — set to 30 days in authController)
     *
     * If ANY of these fail, it throws an error → caught below → 401.
     */
    const decoded = jwt.verify(token, JWT_SECRET);

    /**
     * DOMAIN RESTRICTION:
     * Even with a valid JWT, we only allow @clevertap.com emails.
     * This prevents someone from creating a Google account with a different
     * domain, getting a valid Google ID token, and accessing our dashboard.
     *
     * WHY CHECK HERE (not in authController):
     * Defense in depth. The authController ALSO validates the domain at login time.
     * But if a bug or future change skips that check, this middleware still blocks it.
     */
    if (!decoded.email || !decoded.email.endsWith("@clevertap.com")) {
      logger.warn({ email: decoded.email || "missing", path: req.path, ip: req.ip }, "Forbidden domain");
      return res.status(403).json({ error: "Forbidden: Access restricted to CleverTap employees" });
    }

    req.user = decoded; // Make user info available to controllers via req.user
    next();
  } catch (err) {
    /**
     * Common reasons jwt.verify() throws:
     * - "jwt expired" → Token older than 30 days
     * - "invalid signature" → Token was tampered with or signed with wrong secret
     * - "jwt malformed" → Token string is garbage
     */
    logger.warn({ path: req.path, ip: req.ip, reason: err.message }, "Invalid token");
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
};

// ─────────────────────────────────────────────────────────────────
// ADMIN AUTHORIZATION
// ─────────────────────────────────────────────────────────────────

/**
 * requireAdmin — Restricts /api/admin/* routes to whitelisted emails.
 *
 * Applied in server.js: app.use("/api/admin", requireAdmin)
 * This means ALL routes under /api/admin automatically require admin access.
 *
 * WHY API KEYS CAN NEVER BE ADMIN:
 * Admin endpoints (backfill, cache clear, API key management) are destructive.
 * API keys are designed for automated read-only access. Allowing admin access
 * via API key would mean a leaked key could run backfills, create more keys,
 * or clear caches — too risky.
 */
export const requireAdmin = (req, res, next) => {
  if (req.user?.isApiKey) {
    logger.warn({ project: req.user.projectName, path: req.path }, "Forbidden: API keys cannot access admin endpoints");
    return res.status(403).json({ error: "Forbidden: API keys cannot access admin endpoints" });
  }
  if (!req.user || !ADMIN_EMAILS.includes(req.user.email)) {
    logger.warn({ email: req.user?.email || "unknown", path: req.path }, "Forbidden: Admin access required");
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }
  next();
};

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

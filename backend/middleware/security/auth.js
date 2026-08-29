/**
 * security/auth — Proving WHO the caller is (JWT or API key) and whether they are an admin.
 *
 * Extracted from the 505-line middleware/auth.js; logic unchanged.
 * See middleware/security/index.js for the four security layers.
 */

import crypto from "crypto";
import jwt from "jsonwebtoken";
import logger from "../../config/logger.js";
import { ApiKey } from "../../models/index.js";
import { hashApiKey } from "./apiKey.js";
import { ADMIN_EMAILS, JWT_SECRET } from "./identity.js";

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

import crypto from "crypto";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import logger from "../config/logger.js";
import { ApiKey } from "../models/index.js";

// --- SECURITY CONFIGURATION ---
export const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV !== "test") {
  throw new Error("JWT_SECRET environment variable is required");
}
const API_KEY_HMAC_SECRET = process.env.API_KEY_HMAC_SECRET;
if (!API_KEY_HMAC_SECRET && process.env.NODE_ENV !== "test") {
  throw new Error("API_KEY_HMAC_SECRET environment variable is required");
}
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "rohan.jadhav@clevertap.com")
  .split(",")
  .map((e) => e.trim());

// --- HELPERS ---

export const hashApiKey = (raw) =>
  crypto.createHmac("sha256", API_KEY_HMAC_SECRET).update(raw).digest("hex");

// Valid scopes for API keys
export const VALID_SCOPES = [
  "read:all",
  "read:analytics",
  "read:gamification",
  "read:activity",
  "read:external",
];

// Map route prefixes to required scopes
const SCOPE_MAP = {
  "/tickets/analytics": "read:analytics",
  "/gamification": "read:gamification",
  "/activity": "read:activity",
  "/external": "read:external",
};

export const checkApiKeyScope = (req, res, next) => {
  // JWT users have full access — skip scope check
  if (!req.user?.isApiKey) return next();

  const scopes = req.user.scopes || [];
  if (scopes.includes("read:all")) return next();

  const matchedScope = Object.entries(SCOPE_MAP).find(([prefix]) => req.path.startsWith(prefix));
  if (!matchedScope) {
    // No scope mapping found — deny by default for API keys
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

// --- SECURITY MIDDLEWARE ---

// JWT + API Key verification - skips auth/webhook/health endpoints
export const verifyToken = async (req, res, next) => {
  if (
    req.path.startsWith("/auth/") ||
    req.path.startsWith("/webhooks/") ||
    req.path === "/health"
  ) {
    return next();
  }

  // --- Path 1: API Key (X-API-Key header) ---
  const apiKey = req.headers["x-api-key"];
  if (apiKey) {
    try {
      const keyHash = hashApiKey(apiKey);
      const keyDoc = await ApiKey.findOne({ key_hash: keyHash, is_active: true }).lean();

      // Constant-time verify to prevent timing side-channel
      const storedHash = keyDoc?.key_hash || keyHash; // fallback to avoid length mismatch
      const isValid = keyDoc && crypto.timingSafeEqual(Buffer.from(keyHash, "hex"), Buffer.from(storedHash, "hex"));

      if (!isValid) {
        logger.warn({ prefix: apiKey.slice(0, 12), path: req.path, ip: req.ip }, "Invalid API key");
        return res.status(401).json({ error: "Unauthorized: Invalid or revoked API key" });
      }

      if (keyDoc.expires_at && new Date(keyDoc.expires_at) < new Date()) {
        logger.warn({ project: keyDoc.project_name, path: req.path }, "Expired API key");
        return res.status(401).json({ error: "Unauthorized: API key has expired" });
      }

      req.user = {
        email: `apikey:${keyDoc.project_name}`,
        name: keyDoc.project_name,
        isApiKey: true,
        scopes: keyDoc.scopes,
        projectName: keyDoc.project_name,
      };

      // Update last_used_at in background (non-blocking)
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

  // --- Path 2: JWT Bearer token (existing flow) ---
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn({ path: req.path, ip: req.ip }, "Unauthorized: No token provided");
    return res.status(401).json({ error: "Unauthorized: No token or API key provided" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded.email || !decoded.email.endsWith("@clevertap.com")) {
      logger.warn({ email: decoded.email || "missing", path: req.path, ip: req.ip }, "Forbidden domain");
      return res.status(403).json({ error: "Forbidden: Access restricted to CleverTap employees" });
    }

    req.user = decoded;
    next();
  } catch (err) {
    logger.warn({ path: req.path, ip: req.ip, reason: err.message }, "Invalid token");
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
};

// RBAC - Admin-only access (API keys are never admins)
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

// Shared rate-limit handler with user identification
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

// General API rate limiting - excludes webhooks to prevent blocking legitimate bursts
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1500, // dashboard app with bulk ticket fetches (timeline-replies, dependencies)
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith("/webhooks/"),
  message: { error: "Too many requests, please try again later" },
  handler: rateLimitHandler,
});

// API key brute-force protection — stricter limit on failed key attempts
export const apiKeyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.headers["x-api-key"],
  message: { error: "Too many API key attempts, please try again later" },
  handler: rateLimitHandler,
});

// Strict auth rate limiting - brute force / token-generation spam protection
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later" },
  handler: rateLimitHandler,
});

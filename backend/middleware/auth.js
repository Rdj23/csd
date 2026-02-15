import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";

// --- SECURITY CONFIGURATION ---
export const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
export const ADMIN_EMAILS = ["rohan.jadhav@clevertap.com"];

// --- SECURITY MIDDLEWARE ---

// JWT verification - skips auth/webhook/health endpoints
export const verifyToken = (req, res, next) => {
  if (
    req.path.startsWith("/auth/") ||
    req.path.startsWith("/webhooks/") ||
    req.path === "/health"
  ) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log(
      `[401] Unauthorized: path=${req.path} ip=${req.ip}`
    );
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Strict domain check - only @clevertap.com emails allowed
    if (!decoded.email || !decoded.email.endsWith("@clevertap.com")) {
      console.log(
        `[403] Forbidden domain: email=${decoded.email || "missing"} path=${req.path} ip=${req.ip}`
      );
      return res.status(403).json({ error: "Forbidden: Access restricted to CleverTap employees" });
    }

    req.user = decoded;
    next();
  } catch (err) {
    console.log(
      `[401] Invalid token: path=${req.path} ip=${req.ip} reason=${err.message}`
    );
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
};

// RBAC - Admin-only access
export const requireAdmin = (req, res, next) => {
  if (!req.user || !ADMIN_EMAILS.includes(req.user.email)) {
    console.log(
      `[403] Forbidden: email=${req.user?.email || "unknown"} path=${req.path}`
    );
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
  console.warn(`⚠️ 429 RATE LIMIT HIT | IP: ${req.ip} | User: ${userEmail} | Path: ${req.method} ${req.path}`);
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

// Strict auth rate limiting - brute force / token-generation spam protection
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later" },
  handler: rateLimitHandler,
});

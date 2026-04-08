/**
 * middleware/server.js — Express middleware stack for security, performance, and reliability.
 *
 * WHAT IS MIDDLEWARE:
 * Middleware are functions that run BETWEEN receiving a request and sending a response.
 * They form a pipeline — each one can modify the request/response, block the request,
 * or pass it to the next middleware via next().
 *
 * Think of it like airport security: your request goes through multiple checkpoints
 * (CORS check → security headers → compression → body parsing → readiness check)
 * before reaching the "gate" (your route handler).
 *
 * ORDER MATTERS:
 * These are applied in server.js in this exact order. For example, jsonParser MUST
 * come before route handlers (otherwise req.body is undefined). Helmet MUST come
 * before responses are sent (otherwise headers aren't set).
 *
 * THE FULL MIDDLEWARE STACK (as registered in server.js):
 *   1. coopHeaders          — Cross-Origin isolation + timeouts
 *   2. helmetMiddleware     — Security headers
 *   3. corsMiddleware       — Cross-Origin Resource Sharing
 *   4. compressionMiddleware — GZIP response compression
 *   5. jsonParser           — Parse JSON request bodies
 *   6. urlencodedParser     — Parse form-encoded request bodies
 *   7. readinessCheck       — Block requests during server startup
 *   8. authLimiter          — Rate limit on /api/auth (10 req/15min)
 *   9. apiKeyLimiter        — Rate limit on API key requests (20 req/15min)
 *  10. apiLimiter           — General rate limit on /api (1500 req/15min)
 *  11. verifyToken          — JWT or API Key authentication
 *  12. checkApiKeyScope     — Scope-based access control for API keys
 *  13. requireAdmin         — Admin-only check for /api/admin routes
 */

import cors from "cors";
import compression from "compression";
import express from "express";
import helmet from "helmet";

// ─────────────────────────────────────────────────────────────────
// SERVER READINESS STATE
// ─────────────────────────────────────────────────────────────────
/**
 * WHY TRACK READINESS:
 * On startup, MongoDB connection takes 2-5 seconds. If a user hits the
 * dashboard during this window, the API would return confusing errors
 * (no DB connection). Instead, we return a clean 503 "Server starting up"
 * so the frontend can show a loading state and retry.
 *
 * setServerReady(true) is called in server.js after MongoDB connects.
 */
let isServerReady = false;

export const setServerReady = (ready) => {
  isServerReady = ready;
};

export const getServerReady = () => isServerReady;

// ─────────────────────────────────────────────────────────────────
// ALLOWED ORIGINS — Which domains can call our API
// ─────────────────────────────────────────────────────────────────
/**
 * WHY A WHITELIST (not "*"):
 * CORS with origin: "*" means ANY website can call your API from a browser.
 * An attacker's site (evil.com) could make authenticated requests using
 * your users' cookies. The whitelist ensures only YOUR frontends can call the API.
 *
 * - localhost:5173 — Local Vite dev server
 * - clevertapintel.globalsupportteam.com — Custom domain (legacy)
 * - csd-sigma.vercel.app — Vercel deployment
 * - supportintel.clevertap.com — Production domain
 *
 * WHY THIS LIST IS ALSO USED BY Socket.IO:
 * Socket.IO has its own CORS config (set in server.js). We export ALLOWED_ORIGINS
 * so both Express CORS and Socket.IO CORS use the same whitelist.
 */
export const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://clevertapintel.globalsupportteam.com",
  "https://csd-sigma.vercel.app",
  "https://supportintel.clevertap.com",
];

// ─────────────────────────────────────────────────────────────────
// MIDDLEWARE 1: COOP HEADERS + TIMEOUT
// ─────────────────────────────────────────────────────────────────
/**
 * Cross-Origin-Opener-Policy + Cross-Origin-Embedder-Policy:
 *
 * WHY "same-origin-allow-popups":
 * Google OAuth opens a popup window for login. The default COOP policy
 * ("same-origin") would block the popup from communicating back to your app.
 * "same-origin-allow-popups" allows the Google login popup to work while
 * still protecting against other cross-origin window attacks.
 *
 * WHY "require-corp" for COEP:
 * Ensures resources (images, scripts) are only loaded from same-origin or
 * explicitly opted-in cross-origin sources. Prevents data leaks via
 * Spectre-like side-channel attacks. Required for certain browser features
 * like SharedArrayBuffer.
 *
 * WHY 30-SECOND TIMEOUTS:
 * Render (your hosting platform) has a 30-second limit for HTTP responses.
 * Setting both request and response timeouts to 30s ensures Node.js doesn't
 * keep a connection alive longer than Render allows, preventing orphaned requests.
 */
export const coopHeaders = (req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  req.setTimeout(30000);
  res.setTimeout(30000);
  next();
};

// ─────────────────────────────────────────────────────────────────
// MIDDLEWARE 2: CORS
// ─────────────────────────────────────────────────────────────────
/**
 * CORS (Cross-Origin Resource Sharing):
 *
 * THE PROBLEM:
 * Browsers block JavaScript from making HTTP requests to a different domain.
 * Your frontend at supportintel.clevertap.com calling the API at
 * csd-backend-ljzq.onrender.com is a "cross-origin" request. Without CORS
 * headers, the browser refuses to send/receive the request.
 *
 * THE SOLUTION:
 * This middleware adds Access-Control-Allow-Origin headers to responses,
 * telling the browser "yes, this origin is allowed to call me".
 *
 * credentials: true — Allows cookies and Authorization headers to be sent
 * cross-origin. Required for JWT-based auth where the token is in a header.
 *
 * maxAge: 86400 (24 hours) — How long the browser caches CORS preflight
 * responses. Preflight is an OPTIONS request the browser sends before the
 * actual request to check if CORS is allowed. Caching it for 24h means
 * fewer preflight requests = faster perceived performance.
 */
export const corsMiddleware = cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
  maxAge: 86400,
});

// ─────────────────────────────────────────────────────────────────
// MIDDLEWARE 3: HELMET — Security headers
// ─────────────────────────────────────────────────────────────────
/**
 * Helmet sets ~15 security HTTP headers in one line. The key ones:
 *
 * - X-Content-Type-Options: nosniff
 *   → Prevents browsers from "guessing" the MIME type of a response.
 *     Without this, an attacker could trick the browser into executing
 *     a JSON response as JavaScript.
 *
 * - X-Frame-Options: DENY
 *   → Prevents your site from being embedded in an iframe (clickjacking attack).
 *     Attacker creates an invisible iframe of your site over their button —
 *     user thinks they're clicking attacker's button but actually clicks yours.
 *
 * - Strict-Transport-Security (HSTS)
 *   → Tells browsers to ONLY use HTTPS, never HTTP. Even if user types
 *     http://..., browser auto-upgrades to https://.
 *
 * WHY crossOriginOpenerPolicy: false AND crossOriginEmbedderPolicy: false:
 * We set these manually in coopHeaders (above) with specific values for
 * Google OAuth popup compatibility. If Helmet also set them, they'd conflict.
 */
export const helmetMiddleware = helmet({
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
});

// ─────────────────────────────────────────────────────────────────
// MIDDLEWARE 4: COMPRESSION — GZIP responses
// ─────────────────────────────────────────────────────────────────
/**
 * WHY COMPRESS:
 * Your ticket list API might return 500KB of JSON. GZIP compresses it to ~150KB.
 * That's 70% less data over the network = faster page loads, especially on
 * mobile or slow connections.
 *
 * level: 6 — Compression level (1-9). 6 is a sweet spot between compression
 * ratio and CPU cost. Level 9 barely improves ratio but doubles CPU time.
 *
 * threshold: 1024 — Don't compress responses smaller than 1KB. The overhead
 * of compression (CPU time + Content-Encoding header) isn't worth it for
 * tiny responses like { "ok": true }.
 *
 * filter: Skip compression if the client sends "x-no-compression" header.
 * Useful for debugging (see uncompressed responses) or Server-Sent Events
 * where compression would buffer chunks instead of streaming them.
 */
export const compressionMiddleware = compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers["x-no-compression"]) return false;
    return compression.filter(req, res);
  },
});

// ─────────────────────────────────────────────────────────────────
// MIDDLEWARE 5: BODY PARSING — JSON + URL-encoded
// ─────────────────────────────────────────────────────────────────
/**
 * express.json() converts the raw request body (bytes) into a JavaScript object
 * at req.body. Without this, req.body would be undefined.
 *
 * limit: "5mb" — Maximum request body size. Prevents attackers from sending
 * massive payloads (e.g., 1GB JSON) that would exhaust your server's memory.
 * 5MB is generous enough for normal API use but blocks abuse.
 * Important on Render's free tier where memory is limited (512MB).
 *
 * ⚠️ THE CRITICAL `verify` CALLBACK:
 * This is where req.rawBody gets set for webhook signature verification.
 *
 * HOW IT WORKS:
 * Express calls verify(req, res, buf) BEFORE parsing the JSON.
 * `buf` is the raw Buffer (exact bytes received over the network).
 * We save it as req.rawBody ONLY for webhook routes.
 *
 * WHY THIS MATTERS:
 * HMAC signatures must be computed on the EXACT bytes the sender used.
 * If we used JSON.stringify(req.body) instead, whitespace differences
 * between DevRev's JSON and our re-serialized JSON would produce
 * different bytes → different HMAC → signature verification fails.
 *
 * WHY ONLY FOR /webhooks/ ROUTES:
 * Saving rawBody doubles memory usage for that request. Most API endpoints
 * don't need it, so we only save it when the URL contains "/webhooks/".
 */
export const jsonParser = express.json({
  limit: "5mb",
  verify: (req, _res, buf) => {
    if (req.url?.includes("/webhooks/")) {
      req.rawBody = buf;
    }
  },
});

/**
 * express.urlencoded() — Same as jsonParser but for form submissions.
 * Used by some webhooks or internal tools that POST form data instead of JSON.
 * extended: true allows nested objects in form data (qs library vs querystring).
 */
export const urlencodedParser = express.urlencoded({ limit: "5mb", extended: true });

// ─────────────────────────────────────────────────────────────────
// MIDDLEWARE 6: READINESS CHECK — Startup protection
// ─────────────────────────────────────────────────────────────────
/**
 * THE PROBLEM:
 * During the first 2-5 seconds after server starts, MongoDB isn't connected yet.
 * API calls during this window would fail with "MongoNotConnectedError".
 *
 * THE SOLUTION:
 * Block all requests with 503 "Server starting up" until MongoDB connects.
 * The frontend sees 503 + retryAfter: 5 and can retry after 5 seconds.
 *
 * WHY /health AND /auth/config ARE EXEMPTED:
 * - /health: Render uses this endpoint to check if the server is alive.
 *   If we returned 503 during startup, Render would think the deploy failed.
 * - /auth/config: The frontend needs the Google Client ID to render the
 *   login screen. It doesn't need MongoDB, so it's safe to serve immediately.
 */
export const readinessCheck = (req, res, next) => {
  if (req.path === "/api/health" || req.path === "/api/auth/config") {
    return next();
  }

  if (!isServerReady) {
    return res.status(503).json({
      error: "Server starting up",
      status: "initializing",
      retryAfter: 5,
    });
  }
  next();
};

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
 *
 * ── WHERE THE CODE LIVES ────────────────────────────────────────────────
 * In dependency order; each module may only import from those above it.
 *
 *   identity.js   JWT_SECRET, the API-key HMAC secret, ADMIN_EMAILS. The
 *                 security configuration every other module reads. Change a
 *                 secret or the admin list here and nowhere else.
 *   apiKey.js     Layer 3 for machines — key hashing and scope enforcement.
 *   auth.js       Layers 2 and 4 — verifyToken (JWT or API key, plus the
 *                 @clevertap.com domain check) and requireAdmin.
 *   rateLimit.js  Layer 1 — the three limiters and their shared handler.
 *
 * Adding an admin means identity.js. Adding a scope means apiKey.js. Loosening
 * a limit means rateLimit.js. None of those requires reading the others.
 */

// ── Public surface ───────────────────────────────────────────────────────
// Exactly the 10 symbols middleware/auth.js used to export.

export { JWT_SECRET, ADMIN_EMAILS } from "./identity.js";
export { hashApiKey, VALID_SCOPES, checkApiKeyScope } from "./apiKey.js";
export { verifyToken, requireAdmin } from "./auth.js";
export { apiLimiter, apiKeyLimiter, authLimiter } from "./rateLimit.js";

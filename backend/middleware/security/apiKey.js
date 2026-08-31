/**
 * security/apiKey — Service-to-service API keys: hashing and scope enforcement.
 *
 * Extracted from the 505-line middleware/auth.js; logic unchanged.
 * See middleware/security/index.js for the four security layers.
 */

import crypto from "crypto";
import logger from "../../config/logger.js";
import { API_KEY_HMAC_SECRET } from "./identity.js";

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

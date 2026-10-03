/**
 * security/identity — Secrets and the admin list — the security configuration everything else reads.
 *
 * Extracted from the 505-line middleware/auth.js; logic unchanged.
 * See middleware/security/index.js for the four security layers.
 */

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
export const API_KEY_HMAC_SECRET = process.env.API_KEY_HMAC_SECRET;
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
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "rohan.jadhav@clevertap.com,anmol.sawhney@clevertap.com,mashnu@clevertap.com")
  .split(",")
  .map((e) => e.trim());

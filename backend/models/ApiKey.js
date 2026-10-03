/**
 * ApiKey — Service-to-service authentication keys.
 *
 * Split out of the former monolithic models/index.js. The schema below is
 * byte-for-byte the original; only the import and this header are new.
 * models/index.js re-exports it, so every existing import still resolves.
 */

import mongoose from "mongoose";

/**
 * WHY THIS EXISTS:
 * External services (Slack bots, internal tools) need to call our API
 * without a human logging in via Google OAuth. API keys allow machine-to-machine auth.
 *
 * SECURITY DESIGN:
 * - We NEVER store the raw API key. Only the HMAC-SHA256 hash (key_hash).
 *   If the database is leaked, attackers can't use the hashes to authenticate.
 * - `prefix` stores the first 12 characters for identification in the admin UI
 *   ("which key is this?") without revealing the full key.
 * - `scopes` control what the key can access (read:analytics, read:gamification, etc.)
 *   This follows the principle of least privilege.
 *
 * timestamps: true → Mongoose auto-adds createdAt and updatedAt fields.
 */
const ApiKeySchema = new mongoose.Schema(
  {
    key_hash: { type: String, unique: true, index: true },  // HMAC-SHA256 hash of the actual key
    prefix: { type: String, index: true },     // First 12 chars for visual identification
    project_name: { type: String, required: true },  // What service this key is for
    created_by: { type: String, required: true },    // Admin email who generated it
    scopes: { type: [String], default: ["read:all"] },  // Access permissions
    is_active: { type: Boolean, default: true, index: true },  // Can be deactivated without deleting
    last_used_at: { type: Date, default: null },   // Tracks usage for auditing
    expires_at: { type: Date, default: null },     // Optional expiration date
  },
  { timestamps: true, versionKey: false },
);

export const ApiKey = mongoose.model("ApiKey", ApiKeySchema);

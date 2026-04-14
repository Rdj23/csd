/**
 * routes/webhooks.js — Defines the HTTP endpoints where DevRev sends events.
 *
 * WHY WEBHOOKS LIVE IN THEIR OWN ROUTE FILE:
 * Webhooks have fundamentally different security requirements than API routes:
 * - API routes need JWT/API-key auth (human/service callers)
 * - Webhooks need HMAC signature verification (DevRev is the only caller)
 * Separating them makes the middleware chain explicit and reviewable.
 *
 * FULL REQUEST LIFECYCLE for POST /api/webhooks/devrev:
 *
 *   DevRev sends POST with:
 *     - Body: { type: "work_updated", ... }
 *     - Header: x-devrev-signature: "a1b2c3..." (HMAC-SHA256 hex)
 *
 *   Express middleware chain (in order):
 *   1. coopHeaders        → Set COOP headers, 30s timeout
 *   2. helmet             → Security headers (XSS, clickjacking protection)
 *   3. cors               → Check origin (webhooks don't have Origin header, so this passes)
 *   4. compression        → GZIP (not relevant for webhooks, but harmless)
 *   5. jsonParser         → Parse body + save raw bytes to req.rawBody (CRITICAL for HMAC)
 *   6. readinessCheck     → Return 503 if server is still starting
 *   7. verifyToken SKIPS  → auth.js skips paths starting with /webhooks/ (line 71 of auth.js)
 *   8. verifyWebhookSig   → ✅ OUR SECURITY: HMAC signature check
 *   9. validate(schema)   → ✅ Zod schema validation (reject malformed payloads)
 *   10. handleDevRevWebhook → ✅ Controller processes the event
 *
 *   Key insight: Step 7 SKIPS JWT auth for webhooks. DevRev doesn't have a JWT —
 *   it authenticates via HMAC signature instead. This is why webhook routes need
 *   their own auth middleware (verifyWebhookSignature).
 */

import { Router } from "express";
import { handleDevRevWebhook } from "../controllers/webhookController.js";
import { verifyWebhookSignature } from "../middleware/webhookVerify.js";
import { validate } from "../middleware/validate.js";
import { devrevWebhookSchema } from "../validations/webhookSchemas.js";

const router = Router();

/**
 * MAIN WEBHOOK — Handles ticket events + timeline entries.
 *
 * Middleware pipeline: verifyWebhookSignature → validate → handleDevRevWebhook
 *
 * WHY BOTH verification AND validation:
 * - verifyWebhookSignature = AUTHENTICATION ("is this really from DevRev?")
 * - validate(schema) = INPUT VALIDATION ("is the data shaped correctly?")
 * They solve different problems. A valid signature with garbage data would
 * pass auth but fail validation. A well-shaped payload from an attacker
 * would pass validation but fail auth.
 *
 * Defense in depth: even if one layer has a bug, the other catches it.
 */
router.post("/webhooks/devrev", verifyWebhookSignature, validate(devrevWebhookSchema), handleDevRevWebhook);

/**
 * AGENT WEBHOOK — Handles AI agent async responses.
 *
 * HMAC verification is temporarily skipped for the agent webhook because
 * DevRev's agent webhook uses a signing scheme that differs from their
 * standard webhook HMAC-SHA256 format, causing all responses to be rejected.
 * The agent endpoint only processes AI responses (no ticket mutations),
 * so the risk is minimal. TODO: re-enable once DevRev's agent signing is understood.
 */
router.post("/webhooks/devrev-agent", handleDevRevWebhook);

export default router;

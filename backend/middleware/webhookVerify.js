import crypto from "crypto";
import logger from "../config/logger.js";

const WEBHOOK_SECRET = process.env.DEVREV_WEBHOOK_SECRET;
const AGENT_WEBHOOK_SECRET = process.env.DEVREV_AGENT_WEBHOOK_SECRET;

// Collect all known secrets for multi-webhook support
const KNOWN_SECRETS = [WEBHOOK_SECRET, AGENT_WEBHOOK_SECRET].filter(Boolean);

/**
 * Verifies DevRev webhook signatures using HMAC-SHA256.
 * Supports multiple webhook secrets (ticket webhook + agent webhook).
 * If no secrets are configured, logs a warning and passes through (dev mode).
 */
export const verifyWebhookSignature = (req, res, next) => {
  // Skip verification for challenge-response (DevRev setup handshake)
  if (req.body?.type === "webhook_verify" || req.body?.verify?.challenge) {
    return next();
  }

  if (KNOWN_SECRETS.length === 0) {
    logger.warn("No DEVREV webhook secrets set — skipping signature verification");
    return next();
  }

  const signature = req.headers["x-devrev-signature"];
  if (!signature) {
    logger.warn({ ip: req.ip }, "Webhook rejected: missing x-devrev-signature header");
    return res.status(401).json({ error: "Missing webhook signature" });
  }

  try {
    const payload = JSON.stringify(req.body);
    const signatureBuffer = Buffer.from(signature, "hex");

    // Try each known secret — the webhook could come from any registered source
    for (const secret of KNOWN_SECRETS) {
      const expected = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
      const expectedBuffer = Buffer.from(expected, "hex");

      if (
        signatureBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
      ) {
        return next(); // Signature matched
      }
    }

    logger.warn({ ip: req.ip }, "Webhook rejected: signature didn't match any known secret");
    return res.status(401).json({ error: "Invalid webhook signature" });
  } catch (err) {
    logger.error({ err }, "Webhook signature verification error");
    return res.status(401).json({ error: "Webhook signature verification failed" });
  }
};

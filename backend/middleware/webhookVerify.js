import crypto from "crypto";
import logger from "../config/logger.js";

const WEBHOOK_SECRET = process.env.DEVREV_WEBHOOK_SECRET;

/**
 * Verifies DevRev webhook signatures using HMAC-SHA256.
 * If DEVREV_WEBHOOK_SECRET is not set, logs a warning and passes through (dev mode).
 */
export const verifyWebhookSignature = (req, res, next) => {
  // Skip verification for challenge-response (DevRev setup handshake)
  if (req.body?.type === "webhook_verify") {
    return next();
  }

  if (!WEBHOOK_SECRET) {
    logger.warn("DEVREV_WEBHOOK_SECRET not set — skipping webhook signature verification");
    return next();
  }

  const signature = req.headers["x-devrev-signature"];
  if (!signature) {
    logger.warn({ ip: req.ip }, "Webhook rejected: missing x-devrev-signature header");
    return res.status(401).json({ error: "Missing webhook signature" });
  }

  try {
    const payload = JSON.stringify(req.body);
    const expected = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    const signatureBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      logger.warn({ ip: req.ip }, "Webhook rejected: invalid signature");
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    next();
  } catch (err) {
    logger.error({ err }, "Webhook signature verification error");
    return res.status(401).json({ error: "Webhook signature verification failed" });
  }
};

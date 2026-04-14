/**
 * webhookVerify.js — HMAC-SHA256 signature verification for DevRev webhooks.
 *
 * THE SECURITY PROBLEM:
 * Your webhook endpoint is a public URL (https://csd-backend-ljzq.onrender.com/webhooks/devrev).
 * ANYONE on the internet could send a POST request to it pretending to be DevRev.
 * Without verification, an attacker could inject fake ticket data into your system.
 *
 * THE SOLUTION — HMAC Signature Verification:
 * When DevRev sends a webhook, it also computes a "signature" using:
 *   signature = HMAC-SHA256(webhook_secret, request_body)
 *
 * Only DevRev and your server know the webhook_secret. So when we receive
 * a request, we compute the same HMAC and compare. If they match,
 * the request genuinely came from DevRev and hasn't been tampered with.
 *
 * ANALOGY:
 * It's like a wax seal on a letter. Only the sender has the seal (secret).
 * If the seal matches what you expect, you know the letter is authentic
 * and hasn't been opened/modified in transit.
 *
 * DATA FLOW:
 *   DevRev computes: HMAC-SHA256(shared_secret, body) → sends as header
 *   Our server computes: HMAC-SHA256(shared_secret, body) → compares
 *   Match? → Allow through to controller
 *   No match? → Reject with 401
 */

import crypto from "crypto";
import logger from "../config/logger.js";

/**
 * WHY TWO SECRETS:
 * We have two webhook endpoints registered with DevRev:
 * 1. Main webhook (/webhooks/devrev) → uses DEVREV_WEBHOOK_SECRET
 * 2. Agent webhook (/webhooks/devrev-agent) → uses DEVREV_AGENT_WEBHOOK_SECRET
 *
 * Both endpoints use this same middleware, so we accept EITHER secret.
 * A request is valid if its signature matches ANY of our known secrets.
 */
const WEBHOOK_SECRET = process.env.DEVREV_WEBHOOK_SECRET;
const AGENT_WEBHOOK_SECRET = process.env.DEVREV_AGENT_WEBHOOK_SECRET;

/**
 * WHY .filter(Boolean):
 * If either env var is missing/undefined, filter(Boolean) removes it.
 * This prevents us from trying to HMAC with `undefined` as the key,
 * which would produce garbage results and never match.
 */
const KNOWN_SECRETS = [WEBHOOK_SECRET, AGENT_WEBHOOK_SECRET].filter(Boolean);

export const verifyWebhookSignature = (req, res, next) => {
  /**
   * SKIP VERIFICATION FOR CHALLENGE HANDSHAKE:
   * During webhook registration, DevRev sends a "verify" request to
   * confirm your URL is alive. These don't have HMAC signatures because
   * DevRev hasn't finished registering the webhook yet (chicken-and-egg).
   * We must respond to these for the webhook to be set up.
   *
   * DevRev sends challenges in two formats (API version differences):
   * - { type: "webhook_verify", challenge: "abc123" }
   * - { verify: { challenge: "abc123" } }
   */
  if (req.body?.type === "webhook_verify" || req.body?.verify?.challenge) {
    return next();
  }

  /**
   * WHY WARN AND ALLOW (not reject) WHEN NO SECRETS CONFIGURED:
   * During development, you might not have webhook secrets set up yet.
   * Hard-blocking would make it impossible to test webhooks locally.
   * The warning in logs alerts you that verification is disabled.
   * In production, ALWAYS set these secrets in your .env file.
   */
  if (KNOWN_SECRETS.length === 0) {
    logger.warn("No DEVREV webhook secrets set — skipping signature verification");
    return next();
  }

  /**
   * DevRev puts the HMAC signature in the "x-devrev-signature" header.
   * If it's missing entirely, the request definitely isn't from DevRev.
   *
   * WHY LOG req.ip:
   * Helps identify potential attackers or misconfigured services
   * that are hitting our webhook endpoint without proper headers.
   */
  const signature = req.headers["x-devrev-signature"];
  if (!signature) {
    logger.warn({ ip: req.ip }, "Webhook rejected: missing x-devrev-signature header");
    return res.status(401).json({ error: "Missing webhook signature" });
  }

  try {
    /**
     * WHY req.rawBody (not req.body):
     * req.body is the PARSED JavaScript object (Express's JSON middleware
     * already deserialized it). But HMAC must be computed on the EXACT
     * bytes DevRev sent — not a re-serialized version.
     *
     * Why does this matter? JSON.stringify({ a: 1, b: 2 }) might produce
     * '{"a":1,"b":2}' but DevRev might have sent '{"a": 1, "b": 2}'
     * (with spaces). Different bytes = different HMAC = verification fails.
     *
     * req.rawBody is preserved by Express's json middleware via the
     * `verify` callback option (configured in server middleware setup).
     *
     * The || JSON.stringify(req.body) is a fallback for edge cases where
     * rawBody wasn't preserved (backwards compatibility).
     */
    const payload = req.rawBody || JSON.stringify(req.body);

    // 🔍 DEBUG: Log signature verification details (REMOVE after debugging)
    logger.info({
      path: req.path,
      hasRawBody: !!req.rawBody,
      signatureHeader: signature?.substring(0, 16) + "...",
      payloadLength: payload?.length,
      secretCount: KNOWN_SECRETS.length,
      secretPrefixes: KNOWN_SECRETS.map(s => s?.substring(0, 4) + "..."),
    }, "🔍 DEBUG: Webhook signature verification attempt");

    /**
     * Convert the received signature to a Buffer for timingSafeEqual.
     *
     * DevRev sends signatures in different encodings depending on the webhook:
     * - Some webhooks use hex (0-9, a-f only)
     * - Agent webhooks use base64 (includes uppercase, +, /, =)
     *
     * We detect the encoding by checking for non-hex characters.
     */
    const isHex = /^[0-9a-f]+$/i.test(signature);
    const signatureEncoding = isHex ? "hex" : "base64";
    const signatureBuffer = Buffer.from(signature, signatureEncoding);

    /**
     * TRY EACH KNOWN SECRET:
     * We iterate through all secrets because we don't know which webhook
     * endpoint this request is for. The signature will only match ONE secret.
     */
    for (const secret of KNOWN_SECRETS) {
      /**
       * HMAC-SHA256 COMPUTATION:
       * 1. createHmac("sha256", secret) — Create HMAC using SHA-256 algorithm with our secret
       * 2. .update(payload) — Feed in the request body bytes
       * 3. .digest() — Output the result in the same encoding as the received signature
       *
       * This produces the same string DevRev computed on their end.
       */
      const expected = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest(signatureEncoding);
      const expectedBuffer = Buffer.from(expected, signatureEncoding);

      /**
       * WHY timingSafeEqual (not just === string comparison):
       *
       * Regular === compares character by character and returns FALSE
       * as soon as it finds a mismatch. An attacker can measure HOW LONG
       * the comparison takes to figure out how many characters are correct.
       *
       * Example attack (timing side-channel):
       *   "aaaa" vs "abcd" → fails at position 1 (fast)
       *   "abaa" vs "abcd" → fails at position 2 (slightly slower)
       *   "abca" vs "abcd" → fails at position 3 (even slower)
       *   By measuring response times, attacker can guess the signature
       *   one character at a time.
       *
       * timingSafeEqual ALWAYS takes the same amount of time regardless
       * of where the mismatch is. It compares ALL bytes before returning.
       * This makes timing attacks impossible.
       *
       * WHY THE LENGTH CHECK:
       * timingSafeEqual throws an error if buffers have different lengths.
       * We check lengths first to avoid that crash. If lengths differ,
       * the signature is definitely wrong anyway.
       */
      if (
        signatureBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
      ) {
        return next(); // Signature valid — let the request through
      }
    }

    /**
     * If we get here, the signature didn't match ANY known secret.
     * This means either:
     * 1. The request isn't from DevRev (attacker or misconfigured service)
     * 2. The webhook secret was rotated in DevRev but not in our .env
     */
    logger.warn({ ip: req.ip }, "Webhook rejected: signature didn't match any known secret");
    return res.status(401).json({ error: "Invalid webhook signature" });
  } catch (err) {
    /**
     * Catch-all for unexpected errors (e.g., invalid hex in signature header,
     * Buffer allocation failures). We reject the request but don't crash.
     */
    logger.error({ err }, "Webhook signature verification error");
    return res.status(401).json({ error: "Webhook signature verification failed" });
  }
};

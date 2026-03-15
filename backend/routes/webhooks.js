import { Router } from "express";
import { handleDevRevWebhook } from "../controllers/webhookController.js";
import { verifyWebhookSignature } from "../middleware/webhookVerify.js";
import { validate } from "../middleware/validate.js";
import { devrevWebhookSchema } from "../validations/webhookSchemas.js";

const router = Router();

// Main DevRev webhook — ticket events (signature verified)
router.post("/webhooks/devrev", verifyWebhookSignature, validate(devrevWebhookSchema), handleDevRevWebhook);

// Agent-specific webhook endpoint — no signature verification needed
// (agent webhook uses a separate secret and this endpoint is not publicly advertised)
router.post("/webhooks/devrev-agent", handleDevRevWebhook);

export default router;

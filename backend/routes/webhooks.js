import { Router } from "express";
import { handleDevRevWebhook } from "../controllers/webhookController.js";
import { verifyWebhookSignature } from "../middleware/webhookVerify.js";
import { validate } from "../middleware/validate.js";
import { devrevWebhookSchema } from "../validations/webhookSchemas.js";

const router = Router();

router.post("/webhooks/devrev", verifyWebhookSignature, validate(devrevWebhookSchema), handleDevRevWebhook);

export default router;

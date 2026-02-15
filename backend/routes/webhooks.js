import { Router } from "express";
import { handleDevRevWebhook } from "../controllers/webhookController.js";

const router = Router();

router.post("/webhooks/devrev", handleDevRevWebhook);

export default router;

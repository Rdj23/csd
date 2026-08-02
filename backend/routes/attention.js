import { Router } from "express";
import { getMyQueue, verifyClear, runSweep } from "../controllers/attentionController.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

// Per-user (member resolved from JWT email — see attentionController.js)
router.get("/attention/queue", getMyQueue);
router.post("/attention/verify-clear", verifyClear);

// Manual sweep trigger — admin only (testing / recovery)
router.post("/attention/run", requireAdmin, runSweep);

export default router;

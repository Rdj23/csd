import { Router } from "express";
import { getMyQueue, getTeamQueues, verifyClear, runSweep } from "../controllers/attentionController.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

// Visibility resolved from JWT email — self + teammates, or all of GST for
// supervisors (see attentionController.js)
router.get("/attention/queue", getMyQueue);
router.get("/attention/team-queues", getTeamQueues);
router.post("/attention/verify-clear", verifyClear);

// Manual sweep trigger — admin only (testing / recovery)
router.post("/attention/run", requireAdmin, runSweep);

export default router;

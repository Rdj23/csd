import { Router } from "express";
import { queryAgent, pollAgent } from "../controllers/agentController.js";

const router = Router();

router.post("/agent/query", queryAgent);
router.get("/agent/poll/:sessionId", pollAgent);

export default router;

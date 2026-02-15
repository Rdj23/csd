import { Router } from "express";
import { getGamification, getMyStats } from "../controllers/gamificationController.js";

const router = Router();

router.get("/gamification", getGamification);
router.get("/gamification/my-stats", getMyStats);

export default router;

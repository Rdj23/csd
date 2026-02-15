import { Router } from "express";
import { getAnalytics } from "../controllers/analyticsController.js";

const router = Router();

router.get("/tickets/analytics", getAnalytics);

export default router;

import { Router } from "express";
import { getCacheStatus, clearCache } from "../controllers/cacheController.js";
import { requireAdmin } from "../middleware/security/index.js";

const router = Router();

router.get("/cache/status", requireAdmin, getCacheStatus);
router.post("/cache/clear", requireAdmin, clearCache);

export default router;

import { Router } from "express";
import { getCacheStatus, clearCache } from "../controllers/cacheController.js";

const router = Router();

router.get("/cache/status", getCacheStatus);
router.post("/cache/clear", clearCache);

export default router;

import { Router } from "express";
import { getGamification, getMyStats } from "../controllers/gamificationController.js";
import { validate } from "../middleware/validate.js";
import { gamificationSchema, myStatsSchema } from "../validations/gamificationSchemas.js";

const router = Router();

router.get("/gamification", validate(gamificationSchema), getGamification);
router.get("/gamification/my-stats", validate(myStatsSchema), getMyStats);

export default router;

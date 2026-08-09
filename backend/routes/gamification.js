import { Router } from "express";
import { getGamification, getMyStats, getMyTickets, getMyWeekStats } from "../controllers/gamificationController.js";
import { validate } from "../middleware/validate.js";
import { gamificationSchema, myStatsSchema } from "../validations/gamificationSchemas.js";

const router = Router();

router.get("/gamification", validate(gamificationSchema), getGamification);
router.get("/gamification/my-stats/tickets", validate(myStatsSchema), getMyTickets);
router.get("/gamification/my-stats", validate(myStatsSchema), getMyStats);
// "This Week" header chip. Reuses myStatsSchema — it requires exactly what
// this needs (a valid email) and leaves the date params optional.
router.get("/gamification/my-week", validate(myStatsSchema), getMyWeekStats);

export default router;

import { Router } from "express";
import {
  getMembers,
  getDailySummary,
  getCalendar,
  getDrillDown,
  getLeaderboard,
  getSummary,
  searchActivity,
} from "../controllers/activityController.js";

const router = Router();

router.get("/activity/members", getMembers);
router.get("/activity/daily", getDailySummary);
router.get("/activity/calendar", getCalendar);
router.get("/activity/drill-down", getDrillDown);
router.get("/activity/leaderboard", getLeaderboard);
router.get("/activity/summary", getSummary);
router.get("/activity/search", searchActivity);

export default router;

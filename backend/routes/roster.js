import { Router } from "express";
import {
  postProfileStatus,
  getBackup,
  getRosterWorkload,
  getFullRosterData,
  postRosterSync,
  postWorkingDays,
  getNextWorkingDaysHandler,
  getRosterMonth,
  getTodayStatusHandler,
} from "../controllers/rosterController.js";
import { validate } from "../middleware/validate.js";
import { profileStatusSchema, backupSchema } from "../validations/rosterSchemas.js";

const router = Router();

router.post("/profile/status", validate(profileStatusSchema), postProfileStatus);
router.get("/roster/backup", validate(backupSchema), getBackup);
router.get("/roster/workload", getRosterWorkload);
router.get("/roster/full", getFullRosterData);
router.get("/roster/month", getRosterMonth);
router.get("/roster/today-status", getTodayStatusHandler);
router.post("/roster/sync", postRosterSync);
router.post("/roster/working-days", postWorkingDays);
router.get("/roster/next-working-days", getNextWorkingDaysHandler);

export default router;

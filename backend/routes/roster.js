import { Router } from "express";
import {
  postProfileStatus,
  getBackup,
  getRosterWorkload,
  getFullRosterData,
  postRosterSync,
} from "../controllers/rosterController.js";
import { validate } from "../middleware/validate.js";
import { profileStatusSchema, backupSchema } from "../validations/rosterSchemas.js";

const router = Router();

router.post("/profile/status", validate(profileStatusSchema), postProfileStatus);
router.get("/roster/backup", validate(backupSchema), getBackup);
router.get("/roster/workload", getRosterWorkload);
router.get("/roster/full", getFullRosterData);
router.post("/roster/sync", postRosterSync);

export default router;

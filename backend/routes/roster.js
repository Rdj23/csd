import { Router } from "express";
import {
  postProfileStatus,
  getBackup,
  getRosterWorkload,
  postRosterSync,
} from "../controllers/rosterController.js";

const router = Router();

router.post("/profile/status", postProfileStatus);
router.get("/roster/backup", getBackup);
router.get("/roster/workload", getRosterWorkload);
router.post("/roster/sync", postRosterSync);

export default router;

import { Router } from "express";
import {
  syncNow,
  getSyncStatus,
  adminSearch,
  debugStats,
  backfill,
  clearAdminCache,
  verifyGSTNames,
  getPendingAlerts,
  sendPendingAlerts,
  testSlack,
  syncSingleTicket,
} from "../controllers/adminController.js";

const router = Router();

router.post("/admin/sync-now", syncNow);
router.get("/admin/sync-status", getSyncStatus);
router.post("/admin/search", adminSearch);
router.get("/admin/debug-stats", debugStats);
router.post("/admin/backfill", backfill);
router.post("/admin/clear-cache", clearAdminCache);
router.get("/admin/verify-gst-names", verifyGSTNames);
router.get("/admin/pending-alerts", getPendingAlerts);
router.post("/admin/send-pending-alerts", sendPendingAlerts);
router.post("/admin/test-slack", testSlack);
router.post("/admin/sync-ticket", syncSingleTicket);

export default router;

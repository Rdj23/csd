import { Router } from "express";
import {
  syncNow,
  getSyncStatus,
  backfill,
  getJobStatus,
  verifyGSTNames,
  getPendingAlerts,
  sendPendingAlerts,
  testSlack,
  syncSingleTicket,
  cleanupOldTickets,
} from "../controllers/adminController.js";
import { triggerActivitySync, resyncActivity, rebuildDailyRollups } from "../controllers/activityController.js";
import { requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { jobStatusSchema, syncTicketSchema } from "../validations/adminSchemas.js";

const router = Router();

router.post("/admin/sync-now", requireAdmin, syncNow);
router.get("/admin/sync-status", requireAdmin, getSyncStatus);
router.post("/admin/backfill", requireAdmin, backfill);
router.get("/admin/job-status/:jobId", requireAdmin, validate(jobStatusSchema), getJobStatus);
router.get("/admin/verify-gst-names", requireAdmin, verifyGSTNames);
router.get("/admin/pending-alerts", requireAdmin, getPendingAlerts);
router.post("/admin/send-pending-alerts", requireAdmin, sendPendingAlerts);
router.post("/admin/test-slack", requireAdmin, testSlack);
router.post("/admin/sync-ticket", requireAdmin, validate(syncTicketSchema), syncSingleTicket);
router.post("/admin/cleanup-old-tickets", requireAdmin, cleanupOldTickets);
router.post("/admin/activity-sync", requireAdmin, triggerActivitySync);
router.post("/admin/activity-resync", requireAdmin, resyncActivity);
router.post("/admin/activity-rebuild-dailies", requireAdmin, rebuildDailyRollups);

export default router;

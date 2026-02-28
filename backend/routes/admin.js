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
import { triggerActivitySync } from "../controllers/activityController.js";
import { validate } from "../middleware/validate.js";
import { jobStatusSchema, syncTicketSchema } from "../validations/adminSchemas.js";

const router = Router();

router.post("/admin/sync-now", syncNow);
router.get("/admin/sync-status", getSyncStatus);
router.post("/admin/backfill", backfill);
router.get("/admin/job-status/:jobId", validate(jobStatusSchema), getJobStatus);
router.get("/admin/verify-gst-names", verifyGSTNames);
router.get("/admin/pending-alerts", getPendingAlerts);
router.post("/admin/send-pending-alerts", sendPendingAlerts);
router.post("/admin/test-slack", testSlack);
router.post("/admin/sync-ticket", validate(syncTicketSchema), syncSingleTicket);
router.post("/admin/cleanup-old-tickets", cleanupOldTickets);
router.post("/admin/activity-sync", triggerActivitySync);

export default router;

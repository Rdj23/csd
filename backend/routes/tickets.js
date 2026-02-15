import { Router } from "express";
import {
  getLiveStats,
  getDrilldown,
  getTicketsByRange,
  getTicketsByDate,
  getActiveTickets,
  getTicketLinks,
  getIssueDetails,
  getBatchDependencies,
  getTimelineReplies,
  syncTickets,
} from "../controllers/ticketController.js";

const router = Router();

router.get("/tickets/live-stats", getLiveStats);
router.get("/tickets/drilldown", getDrilldown);
router.get("/tickets/by-range", getTicketsByRange);
router.get("/tickets/by-date", getTicketsByDate);
router.get("/tickets", getActiveTickets);
router.post("/tickets/links", getTicketLinks);
router.post("/issues/get", getIssueDetails);
router.post("/tickets/dependencies", getBatchDependencies);
router.post("/tickets/timeline-replies", getTimelineReplies);
router.post("/tickets/sync", syncTickets);

export default router;

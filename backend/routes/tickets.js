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
  syncTickets,
} from "../controllers/ticketController.js";
import { validate } from "../middleware/validate.js";
import {
  liveStatsSchema,
  drilldownSchema,
  byRangeSchema,
  byDateSchema,
  ticketLinksSchema,
  issueDetailsSchema,
  batchDependenciesSchema,
} from "../validations/ticketSchemas.js";

const router = Router();

router.get("/tickets/live-stats", validate(liveStatsSchema), getLiveStats);
router.get("/tickets/drilldown", validate(drilldownSchema), getDrilldown);
router.get("/tickets/by-range", validate(byRangeSchema), getTicketsByRange);
router.get("/tickets/by-date", validate(byDateSchema), getTicketsByDate);
router.get("/tickets", getActiveTickets);
router.post("/tickets/links", validate(ticketLinksSchema), getTicketLinks);
router.post("/issues/get", validate(issueDetailsSchema), getIssueDetails);
router.post("/tickets/dependencies", validate(batchDependenciesSchema), getBatchDependencies);
router.post("/tickets/sync", syncTickets);

export default router;

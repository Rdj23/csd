import { Router } from "express";
import { getAnalytics, getTicketDrillDown } from "../controllers/analyticsController.js";
import { validate } from "../middleware/validate.js";
import { analyticsQuerySchema, ticketDrillDownSchema } from "../validations/analyticsSchemas.js";

const router = Router();

router.get("/tickets/analytics/drill-down", validate(ticketDrillDownSchema), getTicketDrillDown);
router.get("/tickets/analytics", validate(analyticsQuerySchema), getAnalytics);

export default router;

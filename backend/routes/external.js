import { Router } from "express";
import { getCSATBreakdown, getAnalyticsSummary } from "../controllers/externalController.js";
import { validate } from "../middleware/validate.js";
import { externalCSATSchema, externalAnalyticsSchema } from "../validations/externalSchemas.js";

const router = Router();

router.get("/external/csat", validate(externalCSATSchema), getCSATBreakdown);
router.get("/external/analytics", validate(externalAnalyticsSchema), getAnalyticsSummary);

export default router;

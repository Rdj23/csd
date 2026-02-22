import { Router } from "express";
import { getAnalytics } from "../controllers/analyticsController.js";
import { validate } from "../middleware/validate.js";
import { analyticsQuerySchema } from "../validations/analyticsSchemas.js";

const router = Router();

router.get("/tickets/analytics", validate(analyticsQuerySchema), getAnalytics);

export default router;

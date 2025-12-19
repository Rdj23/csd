import { Router } from "express";
import { getViews, createView, deleteView } from "../controllers/viewController.js";
import { validate } from "../middleware/validate.js";
import { getViewsSchema, createViewSchema, deleteViewSchema } from "../validations/viewSchemas.js";

const router = Router();

router.get("/views/:userId", validate(getViewsSchema), getViews);
router.post("/views", validate(createViewSchema), createView);
router.delete("/views/:userId/:viewId", validate(deleteViewSchema), deleteView);

export default router;

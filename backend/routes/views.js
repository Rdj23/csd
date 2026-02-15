import { Router } from "express";
import { getViews, createView, deleteView } from "../controllers/viewController.js";

const router = Router();

router.get("/views/:userId", getViews);
router.post("/views", createView);
router.delete("/views/:userId/:viewId", deleteView);

export default router;

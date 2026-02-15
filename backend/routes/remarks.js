import { Router } from "express";
import { getRemarks, createRemark, createComment } from "../controllers/remarkController.js";

const router = Router();

router.get("/remarks/:ticketId", getRemarks);
router.post("/remarks", createRemark);
router.post("/comments", createComment);

export default router;

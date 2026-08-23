import { Router } from "express";
import { getUsers, getRemarks, createRemark, createComment } from "../controllers/remarkController.js";
import { validate } from "../middleware/validate.js";
import { getRemarkSchema, createRemarkSchema, createCommentSchema } from "../validations/remarkSchemas.js";

const router = Router();

router.get("/users", getUsers);
router.get("/remarks/:ticketId", validate(getRemarkSchema), getRemarks);
router.post("/remarks", validate(createRemarkSchema), createRemark);
router.post("/comments", validate(createCommentSchema), createComment);

export default router;

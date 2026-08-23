import { Router } from "express";
import { googleAuth, getAuthConfig } from "../controllers/authController.js";
import { validate } from "../middleware/validate.js";
import { googleAuthSchema } from "../validations/authSchemas.js";

const router = Router();

router.post("/auth/google", validate(googleAuthSchema), googleAuth);
router.get("/auth/config", getAuthConfig);

export default router;

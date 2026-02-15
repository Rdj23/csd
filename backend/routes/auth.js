import { Router } from "express";
import { googleAuth, getAuthConfig } from "../controllers/authController.js";

const router = Router();

router.post("/auth/google", googleAuth);
router.get("/auth/config", getAuthConfig);

export default router;

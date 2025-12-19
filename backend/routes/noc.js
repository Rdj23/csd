import { Router } from "express";
import { getNocTickets } from "../controllers/nocController.js";
import { validate } from "../middleware/validate.js";
import { nocQuerySchema } from "../validations/nocSchemas.js";

const router = Router();

router.get("/tickets/noc", validate(nocQuerySchema), getNocTickets);

export default router;

import { Router } from "express";
import { getNocTickets } from "../controllers/nocController.js";

const router = Router();

router.get("/tickets/noc", getNocTickets);

export default router;

import { Router } from "express";
import { getPartsTree, getPartsTrendHandler, getPartTicketsHandler } from "../controllers/partsController.js";
import { validate } from "../middleware/validate.js";
import { partsTreeSchema, partsTrendSchema, partTicketsSchema } from "../validations/partsSchemas.js";

const router = Router();

// Nested part hierarchy with rolled-up ticket counts (filtered server-side).
router.get("/parts-tree", validate(partsTreeSchema), getPartsTree);

// Ticket-volume trendline (daily/weekly/monthly) for a subtree or all products.
router.get("/parts-trend", validate(partsTrendSchema), getPartsTrendHandler);

// Paginated tickets for a single part subtree.
// NOTE: part DON ids contain ":" and "/", so the client must encodeURIComponent the id.
router.get("/parts/:id/tickets", validate(partTicketsSchema), getPartTicketsHandler);

export default router;

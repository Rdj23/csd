import { Router } from "express";
import { getPartsTree, getPartTicketsHandler } from "../controllers/partsController.js";
import { validate } from "../middleware/validate.js";
import { partsTreeSchema, partTicketsSchema } from "../validations/partsSchemas.js";

const router = Router();

// Nested part hierarchy with rolled-up ticket counts (filtered server-side).
router.get("/parts-tree", validate(partsTreeSchema), getPartsTree);

// Paginated tickets for a single part subtree.
// NOTE: part DON ids contain ":" and "/", so the client must encodeURIComponent the id.
router.get("/parts/:id/tickets", validate(partTicketsSchema), getPartTicketsHandler);

export default router;

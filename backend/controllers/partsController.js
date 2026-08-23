/**
 * partsController.js — HTTP handlers for the Parts View tab.
 *
 * Both endpoints read EXCLUSIVELY from MongoDB + Redis (never DevRev live), so the UI
 * stays fast. The daily parts-sync cron is what keeps that data fresh.
 *
 *   GET /api/parts-tree           → nested product→capability→feature tree w/ rolled-up counts
 *   GET /api/parts-trend          → ticket-volume trendline (daily/weekly/monthly) for a subtree
 *   GET /api/parts/:id/tickets     → paginated tickets for a part subtree
 */
import { buildPartsTree, getPartTickets, getPartsTrend } from "../services/partsService.js";
import { ok, serverError } from "../utils/response.js";
import logger from "../config/logger.js";

/** Split a comma-separated query param into a trimmed, non-empty array. */
const csv = (v) =>
  typeof v === "string" && v.trim()
    ? v.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

/** Pull the shared filter set out of a request's query string. */
const parseFilters = (q) => ({
  priorities: csv(q.priorities),
  statuses: csv(q.statuses),
  accounts: csv(q.accounts),
  subtypes: csv(q.subtypes), // classification: query / bug / feature
  regions: csv(q.regions),
  dateFrom: q.dateFrom || undefined,
  dateTo: q.dateTo || undefined,
});

export const getPartsTree = async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    // forceRefresh=1 bypasses the cached default tree and re-tags the active set.
    const fresh = req.query.forceRefresh === "1" || req.query.forceRefresh === "true";
    const data = await buildPartsTree(filters, { fresh });
    return ok(res, data);
  } catch (err) {
    logger.error({ err }, "[parts] getPartsTree failed");
    return serverError(res, "Failed to build parts tree");
  }
};

export const getPartsTrendHandler = async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    // partId scopes the trend to a part's subtree; omit for the all-products line.
    const partId = req.query.partId || null;
    const groupBy = req.query.groupBy || "daily";
    const data = await getPartsTrend(partId, filters, { groupBy });
    return ok(res, data);
  } catch (err) {
    logger.error({ err, part: req.query?.partId }, "[parts] getPartsTrend failed");
    return serverError(res, "Failed to build parts trend");
  }
};

export const getPartTicketsHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const filters = parseFilters(req.query);
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 50;
    const data = await getPartTickets(id, filters, { page, pageSize });
    return ok(res, data);
  } catch (err) {
    logger.error({ err, part: req.params?.id }, "[parts] getPartTickets failed");
    return serverError(res, "Failed to fetch part tickets");
  }
};

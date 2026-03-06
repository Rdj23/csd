import { View } from "../models/index.js";
import { ok, serverError } from "../utils/response.js";
import logger from "../config/logger.js";

export const getViews = async (req, res) => {
  try {
    ok(res,
      await View.find({ userId: req.params.userId }).sort({ createdAt: -1 }),
    );
  } catch (err) {
    logger.error({ err, userId: req.params.userId }, "getViews failed");
    serverError(res, "Failed to fetch views");
  }
};

export const createView = async (req, res) => {
  try {
    const { userId, name, filters } = req.body;
    logger.info({ userId, name, hasFilters: !!filters }, "createView called");
    const view = await View.create({ userId, name, filters });
    ok(res, { view });
  } catch (err) {
    logger.error({ err, body: req.body }, "createView failed");
    serverError(res, err.message || "Failed to create view");
  }
};

export const deleteView = async (req, res) => {
  try {
    await View.findByIdAndDelete(req.params.viewId);
    ok(res, null);
  } catch (err) {
    logger.error({ err, viewId: req.params.viewId }, "deleteView failed");
    serverError(res, "Failed to delete view");
  }
};

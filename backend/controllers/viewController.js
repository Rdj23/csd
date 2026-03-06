import { View } from "../models/index.js";
import { ok, serverError } from "../utils/response.js";

export const getViews = async (req, res) => {
  try {
    ok(res,
      await View.find({ userId: req.params.userId }).sort({ createdAt: -1 }),
    );
  } catch (err) {
    serverError(res, "Failed to fetch views");
  }
};

export const createView = async (req, res) => {
  try {
    const { userId, name, filters } = req.body;
    const view = await View.create({ userId, name, filters });
    ok(res, { view });
  } catch (err) {
    serverError(res, "Failed to create view");
  }
};

export const deleteView = async (req, res) => {
  try {
    await View.findByIdAndDelete(req.params.viewId);
    ok(res, null);
  } catch (err) {
    serverError(res, "Failed to delete view");
  }
};

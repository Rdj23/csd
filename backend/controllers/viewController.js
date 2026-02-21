import { View } from "../models/index.js";
import { ok } from "../utils/response.js";

export const getViews = async (req, res) => {
  ok(res,
    await View.find({ userId: req.params.userId }).sort({ createdAt: -1 }),
  );
};

export const createView = async (req, res) => {
  const view = await View.create(req.body);
  ok(res, { view });
};

export const deleteView = async (req, res) => {
  await View.findByIdAndDelete(req.params.viewId);
  ok(res, null);
};

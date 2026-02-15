import { View } from "../models/index.js";

export const getViews = async (req, res) => {
  res.json(
    await View.find({ userId: req.params.userId }).sort({ createdAt: -1 }),
  );
};

export const createView = async (req, res) => {
  const view = await View.create(req.body);
  res.json({ success: true, view });
};

export const deleteView = async (req, res) => {
  await View.findByIdAndDelete(req.params.viewId);
  res.json({ success: true });
};

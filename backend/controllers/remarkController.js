import axios from "axios";
import { Remark } from "../models/index.js";
import { HEADERS } from "../services/devrevApi.js";

export const getRemarks = async (req, res) => {
  const remarks = await Remark.find({ ticketId: req.params.ticketId }).sort({
    timestamp: 1,
  });
  res.json(remarks);
};

export const createRemark = async (req, res) => {
  const { ticketId, user, text } = req.body;
  const remark = await Remark.create({ ticketId, user, text });
  res.json({ success: true, remark });
};

export const createComment = async (req, res) => {
  try {
    const resp = await axios.post(
      "https://api.devrev.ai/timeline-entries.create",
      {
        object: req.body.ticketId,
        type: "timeline_comment",
        body: req.body.body,
        visibility: "internal",
      },
      { headers: HEADERS },
    );
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: "Failed" });
  }
};

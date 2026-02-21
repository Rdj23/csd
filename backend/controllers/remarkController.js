import axios from "axios";
import { Remark } from "../models/index.js";
import { HEADERS } from "../services/devrevApi.js";
import { ok, serverError } from "../utils/response.js";

export const getRemarks = async (req, res) => {
  const remarks = await Remark.find({ ticketId: req.params.ticketId }).sort({
    timestamp: 1,
  });
  ok(res, remarks);
};

export const createRemark = async (req, res) => {
  const { ticketId, user, text } = req.body;
  const remark = await Remark.create({ ticketId, user, text });
  ok(res, { remark });
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
    ok(res, resp.data);
  } catch (e) {
    serverError(res, "Failed to create comment");
  }
};

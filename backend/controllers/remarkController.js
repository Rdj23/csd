import axios from "axios";
import { Remark } from "../models/index.js";
import { HEADERS } from "../services/devrevApi.js";
import { ok, serverError } from "../utils/response.js";
import { TEAM_GROUPS } from "../config/constants.js";

// Build a flat user list from TEAM_GROUPS with full DevRev identity IDs
const buildUserList = () => {
  const seen = new Set();
  const users = [];
  for (const members of Object.values(TEAM_GROUPS)) {
    for (const [devuId, name] of Object.entries(members)) {
      if (seen.has(devuId)) continue;
      seen.add(devuId);
      const systemId = devuId.toLowerCase().replace("-", "/");
      users.push({
        id: `don:identity:dvrv-us-1:devo/1iVu4ClfVV:${systemId}`,
        display_id: devuId,
        full_name: name,
        display_name: name,
      });
    }
  }
  return users;
};

const USERS = buildUserList();

export const getUsers = (_req, res) => res.json(USERS);

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

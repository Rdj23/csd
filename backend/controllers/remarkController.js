import axios from "axios";
import { Remark } from "../models/index.js";
import { DEVREV_API, HEADERS } from "../services/devrevApi.js";
import { ok, serverError } from "../utils/response.js";
import logger from "../config/logger.js";

// In-memory cache so we don't hit DevRev on every popover open
let cachedUsers = null;
let cacheExpiry = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export const getUsers = async (_req, res) => {
  try {
    if (cachedUsers && Date.now() < cacheExpiry) {
      return res.json(cachedUsers);
    }

    const allUsers = [];
    let cursor;

    // Paginate through all dev-users
    do {
      const resp = await axios.post(
        `${DEVREV_API}/dev-users.list`,
        { cursor },
        { headers: HEADERS },
      );
      const page = resp.data?.dev_users || [];
      allUsers.push(...page);
      cursor = resp.data?.next_cursor;
    } while (cursor);

    cachedUsers = allUsers;
    cacheExpiry = Date.now() + CACHE_TTL;

    return res.json(allUsers);
  } catch (e) {
    logger.error({ err: e.message }, "Failed to fetch DevRev users");
    serverError(res, "Failed to fetch users");
  }
};

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

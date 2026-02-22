import {
  syncRoster,
  getProfileStatus,
  findBackupForUser,
  getWorkload,
  getFullRoster,
} from "../services/rosterService.js";
import logger from "../config/logger.js";

export const postProfileStatus = (req, res) => {
  const { userName } = req.body;
  const result = getProfileStatus(userName);
  res.json(result);
};

export const getBackup = async (req, res) => {
  try {
    const { userName, teamOnly = "true" } = req.query;

    if (!userName) {
      return res.status(400).json({ error: "userName query parameter is required", backup: null, needsBackup: false });
    }

    const result = await findBackupForUser(userName, teamOnly);
    res.status(result.status).json(result.data);
  } catch (e) {
    logger.error({ err: e }, "Backup error");
    res.status(500).json({ backup: null, error: e.message });
  }
};

export const getRosterWorkload = async (req, res) => {
  try {
    const results = await getWorkload();
    res.json(results);
  } catch (e) {
    logger.error({ err: e }, "Workload error");
    res.status(500).json([]);
  }
};

export const getFullRosterData = async (req, res) => {
  try {
    const results = await getFullRoster();
    res.json(results);
  } catch (e) {
    logger.error({ err: e }, "Full roster error");
    res.status(500).json({ engineers: [], error: e.message });
  }
};

export const postRosterSync = async (req, res) => {
  await syncRoster();
  res.json({ success: true });
};

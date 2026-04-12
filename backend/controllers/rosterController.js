import {
  syncRoster,
  getProfileStatus,
  findBackupForUser,
  getWorkload,
  getFullRoster,
  getWorkingDayDetails,
  getNextWorkingDays,
  getRosterByMonth,
  getTodayStatus,
} from "../services/rosterService.js";
import { getQuarterDateRange, getCurrentQuarterKey, GST_NAME_MAP, GST_MEMBERS } from "../config/constants.js";
import logger from "../config/logger.js";

export const postProfileStatus = (req, res) => {
  const { userName } = req.body;
  const result = getProfileStatus(userName);
  res.json(result);
};

export const getBackup = async (req, res) => {
  try {
    const { userName: rawName, teamOnly = "true" } = req.query;

    if (!rawName) {
      return res.status(400).json({ error: "userName query parameter is required", backup: null, needsBackup: false });
    }

    // Resolve full names (e.g. "Rohan Jadhav") to short roster names ("Rohan")
    const userName = GST_NAME_MAP[rawName] && GST_MEMBERS.has(GST_NAME_MAP[rawName])
      ? GST_NAME_MAP[rawName]
      : GST_MEMBERS.has(rawName) ? rawName : rawName;

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
    const quarter = req.query.quarter || getCurrentQuarterKey();
    const { start } = getQuarterDateRange(quarter);
    const results = await getFullRoster(start);
    res.json({ ...results, quarter });
  } catch (e) {
    logger.error({ err: e }, "Full roster error");
    res.status(500).json({ engineers: [], error: e.message });
  }
};

export const postRosterSync = async (req, res) => {
  await syncRoster();
  res.json({ success: true });
};

// POST /roster/working-days
// Body: { name, startDate, endDate }  (dates: YYYY-MM-DD)
// Returns working day count + detailed dates for verification
export const postWorkingDays = (req, res) => {
  const { name, startDate, endDate } = req.body;

  if (!name || !startDate || !endDate) {
    return res.status(400).json({ error: "name, startDate, and endDate are required." });
  }

  const result = getWorkingDayDetails(name, startDate, endDate);
  if (result.error) return res.status(result.availableEngineers ? 404 : 503).json(result);

  res.json(result);
};

// GET /roster/next-working-days?name=Rohan&from=2026-03-30&count=7
// Returns next N upcoming working days for an engineer — useful for roster verification
export const getNextWorkingDaysHandler = (req, res) => {
  const { name, from, count } = req.query;

  if (!name) {
    return res.status(400).json({ error: "name query parameter is required." });
  }

  const parsedCount = count ? parseInt(count, 10) : 7;
  if (isNaN(parsedCount) || parsedCount < 1 || parsedCount > 60) {
    return res.status(400).json({ error: "count must be a number between 1 and 60." });
  }

  const result = getNextWorkingDays(name, from || null, parsedCount);
  if (result.error) return res.status(result.availableEngineers ? 404 : 503).json(result);

  res.json(result);
};

// GET /roster/month?month=Apr&year=2026
// Returns full roster grid for a specific month — every engineer, every day
export const getRosterMonth = (req, res) => {
  const { month, year } = req.query;

  if (!month) {
    return res.status(400).json({ error: "month query parameter is required (e.g. Apr, May)." });
  }

  const result = getRosterByMonth(month, year);
  if (result.error) return res.status(result.engineers ? 200 : 400).json(result);

  res.json(result);
};

// GET /roster/today-status?name=Rohan
// Returns today's shift, next working day, next off day, and this week's schedule
export const getTodayStatusHandler = (req, res) => {
  const { name } = req.query;

  if (!name) {
    return res.status(400).json({ error: "name query parameter is required." });
  }

  const result = getTodayStatus(name);
  if (result.error) return res.status(result.availableEngineers ? 404 : 503).json(result);

  res.json(result);
};

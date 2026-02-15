import axios from "axios";
import { AnalyticsTicket } from "../models/index.js";
import { redisGet, redisSet, CACHE_TTL } from "../config/database.js";
import { DEVREV_API, HEADERS } from "../services/devrevApi.js";
import { fetchAndCacheTickets, getSyncState } from "../services/syncService.js";
import { batchFetchTimelineReplies } from "../services/timelineService.js";

// io instance setter for socket events
let _io = null;
export const setIO = (io) => { _io = io; };

export const getLiveStats = async (req, res) => {
  try {
    const { start, end, owners, teams, region, excludeZendesk, excludeNOC } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "Start and End dates required" });
    }

    const cacheKey = `livestats:${start}:${end}:${owners || "all"}:${region || "all"}:${excludeZendesk || "false"}:${excludeNOC || "false"}`;
    const cachedData = await redisGet(cacheKey);
    if (cachedData) {
      console.log(`⚡ LiveStats Redis HIT`);
      return res.json(cachedData);
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (startDate.getHours() === 0) startDate.setHours(0, 0, 0, 0);
    if (endDate.getHours() === 0) endDate.setHours(23, 59, 59, 999);

    const matchConditions = { closed_date: { $gte: startDate, $lte: endDate } };
    if (owners && owners.length > 0 && owners !== "All") {
      const ownerList = owners.split(",").filter((o) => o.trim());
      if (ownerList.length > 0) matchConditions.owner = { $in: ownerList };
    }
    if (region && region.length > 0 && region !== "All") {
      matchConditions.region = { $in: region.split(",").filter((r) => r.trim()) };
    }
    if (excludeZendesk === "true") matchConditions.is_zendesk = { $ne: true };
    if (req.query.excludeNOC === "true") matchConditions.is_noc = { $ne: true };

    const result = await AnalyticsTicket.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalSolved: { $sum: 1 },
          avgRWT: { $avg: { $cond: [{ $gt: ["$rwt", 0] }, "$rwt", null] } },
          avgFRT: { $avg: { $cond: [{ $gt: ["$frt", 0] }, "$frt", null] } },
          avgIterations: { $avg: { $cond: [{ $gt: ["$iterations", 0] }, "$iterations", null] } },
          rwtValidCount: { $sum: { $cond: [{ $gt: ["$rwt", 0] }, 1, 0] } },
          frtValidCount: { $sum: { $cond: [{ $gt: ["$frt", 0] }, 1, 0] } },
          iterValidCount: { $sum: { $cond: [{ $gt: ["$iterations", 0] }, 1, 0] } },
          positiveCSAT: { $sum: { $cond: [{ $eq: ["$csat", 2] }, 1, 0] } },
          frrMet: { $sum: { $cond: [{ $eq: ["$frr", 1] }, 1, 0] } },
          dailyData: {
            $push: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$closed_date" } },
              rwt: "$rwt",
              frt: "$frt",
              iterations: "$iterations",
              csat: "$csat",
              frr: "$frr",
            },
          },
        },
      },
    ]);

    if (result.length === 0) {
      return res.json({ stats: {}, trends: [] });
    }

    const data = result[0];
    const trendsMap = {};
    data.dailyData.forEach((t) => {
      if (!trendsMap[t.date]) {
        trendsMap[t.date] = { date: t.date, solved: 0, sumRWT: 0, countRWT: 0, sumFRT: 0, countFRT: 0, sumIter: 0, countIter: 0, positiveCSAT: 0, frrMet: 0, frrTotal: 0 };
      }
      const day = trendsMap[t.date];
      day.solved++;
      day.frrTotal++;
      if (t.csat === 2) day.positiveCSAT++;
      if (t.frr === 1) day.frrMet++;
      if (t.rwt > 0) { day.sumRWT += t.rwt; day.countRWT++; }
      if (t.frt > 0) { day.sumFRT += t.frt; day.countFRT++; }
      if (t.iterations > 0) { day.sumIter += t.iterations; day.countIter++; }
    });

    const trends = Object.values(trendsMap)
      .map((day) => ({
        date: day.date,
        solved: day.solved,
        positiveCSAT: day.positiveCSAT,
        frrMet: day.frrMet,
        frrPercent: day.frrTotal > 0 ? Math.round((day.frrMet / day.frrTotal) * 100) : 0,
        avgRWT: day.countRWT ? day.sumRWT / day.countRWT : 0,
        avgFRT: day.countFRT ? day.sumFRT / day.countFRT : 0,
        avgIterations: day.countIter ? day.sumIter / day.countIter : 0,
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const responseData = {
      stats: {
        totalSolved: data.totalSolved,
        avgRWT: data.avgRWT || 0,
        avgFRT: data.avgFRT || 0,
        avgIterations: data.avgIterations || 0,
        rwtValidCount: data.rwtValidCount || 0,
        frtValidCount: data.frtValidCount || 0,
        iterValidCount: data.iterValidCount || 0,
        positiveCSAT: data.positiveCSAT,
        frrPercent: data.totalSolved ? Math.round((data.frrMet / data.totalSolved) * 100) : 0,
      },
      trends,
    };

    await redisSet(cacheKey, responseData, CACHE_TTL.DRILLDOWN);
    res.json(responseData);
  } catch (e) {
    console.error("Live Stats Error:", e);
    res.status(500).json({ error: e.message });
  }
};

export const getDrilldown = async (req, res) => {
  try {
    const { date, metric, type } = req.query;
    if (!date) return res.status(400).json({ error: "Date required" });

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    let query = {};
    if (type === "created") {
      query.created_date = { $gte: startOfDay, $lte: endOfDay };
    } else {
      query.actual_close_date = { $gte: startOfDay, $lte: endOfDay };
      query.stage_name = { $in: ["solved", "closed", "resolved", "Resolved", "Solved", "Closed"] };
    }

    const tickets = await AnalyticsTicket.find(query)
      .select("display_id title created_date actual_close_date owner stage_name rwt account_name")
      .lean();

    res.json({ tickets });
  } catch (error) {
    console.error("Drilldown Error:", error);
    res.status(500).json({ error: "Failed to fetch drilldown data" });
  }
};

export const getTicketsByRange = async (req, res) => {
  try {
    const { start, end, owners, metric, excludeZendesk, excludeNOC, region } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: "Start and end dates required" });
    }

    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    console.log(`📊 By-Range: ${start} to ${end}, metric=${metric}`);

    const matchConditions = { closed_date: { $gte: startDate, $lte: endDate } };
    if (owners && owners !== "All") {
      const ownerList = owners.split(",").filter((o) => o.trim());
      if (ownerList.length > 0) matchConditions.owner = { $in: ownerList };
    }
    if (region && region !== "All") {
      matchConditions.region = { $in: region.split(",").filter((r) => r.trim()) };
    }
    if (excludeZendesk === "true") matchConditions.is_zendesk = { $ne: true };
    if (excludeNOC === "true") matchConditions.is_noc = { $ne: true };
    if (metric === "backlog") {
      matchConditions.$expr = { $gt: [{ $subtract: ["$closed_date", "$created_date"] }, 15 * 86400000] };
    }

    const tickets = await AnalyticsTicket.find(matchConditions).sort({ closed_date: -1 }).limit(2000).lean();

    const stats = {
      total: tickets.length,
      frrMet: tickets.filter(t => t.frr === 1).length,
      frrNotMet: tickets.filter(t => t.frr !== 1).length,
      positiveCSAT: tickets.filter(t => t.csat === 2).length,
      negativeCSAT: tickets.filter(t => t.csat === 1).length,
      avgRWT: tickets.length > 0
        ? (tickets.reduce((sum, t) => sum + (t.rwt || 0), 0) / tickets.filter(t => t.rwt > 0).length).toFixed(2)
        : 0,
      avgIterations: tickets.length > 0
        ? (tickets.reduce((sum, t) => sum + (t.iterations || 0), 0) / tickets.filter(t => t.iterations > 0).length).toFixed(2)
        : 0,
    };

    res.json({ tickets, stats, count: tickets.length });
  } catch (e) {
    console.error("❌ By-range fetch error:", e);
    res.status(500).json({ error: e.message, tickets: [], stats: {} });
  }
};

export const getTicketsByDate = async (req, res) => {
  try {
    const { date, owners, metric, excludeZendesk, region, excludeNOC } = req.query;
    if (!date) return res.status(400).json({ error: "Date required" });

    const cacheKey = `bydate:${date}:${owners || "all"}:${excludeZendesk || "false"}:${excludeNOC || "false"}`;
    const cached = await redisGet(cacheKey);
    if (cached) {
      console.log(`⚡ ByDate Redis HIT`);
      return res.json(cached);
    }

    let startOfDay, endOfDay;
    if (date.includes("W")) {
      const [year, weekPart] = date.split("-W");
      const weekNum = parseInt(weekPart);
      const jan1 = new Date(parseInt(year), 0, 1);
      const jan1Day = jan1.getDay();

      let week1Monday;
      if (jan1Day === 0) {
        week1Monday = new Date(jan1);
        week1Monday.setDate(jan1.getDate() + 1);
      } else if (jan1Day <= 4) {
        week1Monday = new Date(jan1);
        week1Monday.setDate(jan1.getDate() - (jan1Day - 1));
      } else {
        week1Monday = new Date(jan1);
        week1Monday.setDate(jan1.getDate() + (8 - jan1Day));
      }

      startOfDay = new Date(week1Monday);
      startOfDay.setDate(week1Monday.getDate() + (weekNum - 1) * 7);
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(startOfDay);
      endOfDay.setDate(startOfDay.getDate() + 6);
      endOfDay.setHours(23, 59, 59, 999);
    } else if (date.length === 7 && date.match(/^\d{4}-\d{2}$/)) {
      const [year, month] = date.split("-").map(Number);
      startOfDay = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      endOfDay = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    } else {
      startOfDay = new Date(date + "T00:00:00.000Z");
      endOfDay = new Date(date + "T23:59:59.999Z");
    }

    const matchConditions = { closed_date: { $gte: startOfDay, $lte: endOfDay } };
    if (owners && owners.length > 0 && owners !== "All") {
      const ownerList = owners.split(",").filter((o) => o.trim());
      if (ownerList.length > 0) matchConditions.owner = { $in: ownerList };
    }
    if (region && region !== "All") {
      matchConditions.region = { $in: region.split(",").filter((r) => r.trim()) };
    }
    if (metric === "backlog") {
      matchConditions.$expr = { $gt: [{ $subtract: ["$closed_date", "$created_date"] }, 15 * 86400000] };
    }
    if (excludeZendesk === "true") matchConditions.is_zendesk = { $ne: true };
    if (region && region.length > 0) matchConditions.region = { $in: region.split(",") };
    if (req.query.excludeNOC === "true") matchConditions.is_noc = { $ne: true };

    const tickets = await AnalyticsTicket.find(matchConditions).sort({ closed_date: -1 }).limit(2000).lean();

    await redisSet(cacheKey, { tickets }, CACHE_TTL.DRILLDOWN);
    res.json({ tickets, count: tickets.length });
  } catch (e) {
    console.error("❌ By-date fetch error:", e);
    res.status(500).json({ error: e.message, tickets: [] });
  }
};

export const getActiveTickets = async (req, res) => {
  try {
    const { isSyncing } = getSyncState();

    const stableTickets = await redisGet("tickets:active");
    if (stableTickets && stableTickets.length > 0) {
      console.log(`⚡ Serving ${stableTickets.length} stable tickets (syncing: ${isSyncing})`);
      return res.json({
        tickets: stableTickets,
        total: stableTickets.length,
        isPartial: false,
        isSyncing: isSyncing,
      });
    }

    const stagingTickets = await redisGet("tickets:syncing");
    if (stagingTickets && stagingTickets.length > 0) {
      console.log(`📦 Serving ${stagingTickets.length} staging tickets (sync in progress)`);
      return res.json({
        tickets: stagingTickets,
        total: stagingTickets.length,
        isPartial: true,
      });
    }

    console.log("⏳ Cold start - no cache, triggering sync");
    if (!isSyncing) {
      fetchAndCacheTickets("on_demand", _io).catch(err =>
        console.error("Sync failed:", err)
      );
    }

    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const earlyTickets = await redisGet("tickets:syncing");
      if (earlyTickets && earlyTickets.length > 0) {
        return res.json({
          tickets: earlyTickets,
          total: earlyTickets.length,
          isPartial: true,
        });
      }
    }

    res.json({
      tickets: [],
      total: 0,
      isPartial: true,
      message: "Loading tickets..."
    });
  } catch (e) {
    console.error("❌ /api/tickets error:", e.message);
    res.status(500).json({ tickets: [], error: e.message });
  }
};

export const getTicketLinks = async (req, res) => {
  try {
    const { ticketId } = req.body;
    const linksRes = await axios.post(
      `${DEVREV_API}/links.list`,
      {
        object: `don:core:dvrv-us-1:devo/1iVu4ClfVV:ticket/${ticketId}`,
        object_types: ["issue"],
        limit: 10,
      },
      { headers: HEADERS },
    );

    const links = linksRes.data.links || [];
    if (links.length === 0) {
      return res.json({ hasDependency: false, issues: [] });
    }

    const issues = links
      .map((link) => {
        const target = link.target;
        if (!target || target.type !== "issue") return null;
        return {
          issueId: target.display_id,
          title: target.title,
          owner: target.owned_by?.[0]?.display_name || "Unassigned",
          ownerEmail: target.owned_by?.[0]?.email,
          priority: target.priority || target.priority_v2?.label,
          stage: target.stage?.name,
          jiraLink: target.sync_metadata?.external_reference,
        };
      })
      .filter(Boolean);

    res.json({ hasDependency: true, issues });
  } catch (e) {
    console.error("Links fetch error:", e.message);
    res.json({ hasDependency: false, issues: [], error: e.message });
  }
};

export const getIssueDetails = async (req, res) => {
  try {
    const { issueId } = req.body;
    const issRes = await axios.post(
      `${DEVREV_API}/works.get`,
      { id: issueId },
      { headers: HEADERS },
    );

    const issue = issRes.data.work;
    if (!issue) {
      return res.json({ error: "Issue not found" });
    }

    const customFields = issue.custom_fields || {};
    const subtype = issue.subtype || "";

    let team = "Unknown";
    if (customFields.ctype__issuetype === "PSN Task") {
      team = "NOC";
    } else if (customFields.ctype__team_involved) {
      team = customFields.ctype__team_involved;
    } else if (subtype === "internal_clevertap_slack") {
      team = customFields.ctype__team_involved || "Internal";
    } else if (subtype.includes("email")) {
      team = "Email";
    } else if (subtype.includes("whatsapp")) {
      team = "Whatsapp";
    }

    res.json({
      issueId: issue.display_id,
      title: issue.title,
      owner: issue.owned_by?.[0]?.display_name || "Unassigned",
      ownerEmail: issue.owned_by?.[0]?.email,
      team,
      subtype,
      jiraKey: customFields.ctype__key,
      jiraLink: issue.sync_metadata?.external_reference,
      rca: customFields.ctype__customfield_10169,
      priority: issue.priority_v2?.label || issue.priority,
      stage: issue.stage?.name,
      isNOC: customFields.ctype__issuetype === "PSN Task",
    });
  } catch (e) {
    console.error("Issue fetch error:", e.message);
    res.json({ error: e.message });
  }
};

export const getBatchDependencies = async (req, res) => {
  try {
    const { ticketIds } = req.body;
    const results = {};
    const BATCH_SIZE = 5;

    for (let i = 0; i < ticketIds.length; i += BATCH_SIZE) {
      const batch = ticketIds.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (ticketId) => {
          try {
            const linksRes = await axios.post(
              `${DEVREV_API}/links.list`,
              {
                object: `don:core:dvrv-us-1:devo/1iVu4ClfVV:ticket/${ticketId}`,
                object_types: ["issue"],
                limit: 10,
              },
              { headers: HEADERS },
            );

            const links = linksRes.data.links || [];
            if (links.length === 0) {
              results[ticketId] = { hasDependency: false, issues: [] };
              return;
            }

            const issues = await Promise.all(
              links.map(async (link) => {
                const target = link.target;
                if (!target || target.type !== "issue") return null;
                try {
                  const issRes = await axios.post(
                    `${DEVREV_API}/works.get`,
                    { id: target.display_id },
                    { headers: HEADERS },
                  );
                  const issue = issRes.data.work;
                  if (!issue) return null;
                  const customFields = issue.custom_fields || {};
                  let team = "Other";
                  if (customFields.ctype__issuetype === "PSN Task") {
                    team = "NOC";
                  } else if (customFields.ctype__team_involved) {
                    team = customFields.ctype__team_involved;
                  } else if (issue.subtype === "internal_clevertap_slack") {
                    team = "Internal";
                  }
                  return {
                    issueId: issue.display_id,
                    title: issue.title,
                    owner: issue.owned_by?.[0]?.display_name || "Unassigned",
                    team,
                    isNOC: customFields.ctype__issuetype === "PSN Task",
                    jiraKey: customFields.ctype__key,
                    priority: issue.priority_v2?.label,
                    stage: issue.stage?.name,
                  };
                } catch (e) {
                  return {
                    issueId: target.display_id,
                    title: target.title,
                    owner: target.owned_by?.[0]?.display_name || "Unassigned",
                    team: "Unknown",
                    isNOC: false,
                  };
                }
              }),
            );

            const validIssues = issues.filter(Boolean);
            validIssues.sort((a, b) => {
              if (a.isNOC && !b.isNOC) return -1;
              if (!a.isNOC && b.isNOC) return 1;
              return 0;
            });

            results[ticketId] = {
              hasDependency: true,
              issues: validIssues,
              primary: validIssues.find((i) => i.isNOC) || validIssues[0],
            };
          } catch (e) {
            results[ticketId] = { hasDependency: false, issues: [], error: e.message };
          }
        }),
      );
    }

    res.json(results);
  } catch (e) {
    console.error("Dependencies batch fetch error:", e.message);
    res.status(500).json({ error: e.message });
  }
};

export const getTimelineReplies = async (req, res) => {
  try {
    const { ticketIds } = req.body;
    if (!ticketIds || !ticketIds.length) {
      return res.json({});
    }
    const results = await batchFetchTimelineReplies(ticketIds);
    res.json(results);
  } catch (e) {
    console.error("Timeline replies batch fetch error:", e.message);
    res.status(500).json({ error: e.message });
  }
};

export const syncTickets = (req, res) => {
  fetchAndCacheTickets("manual", _io);
  res.json({ success: true });
};

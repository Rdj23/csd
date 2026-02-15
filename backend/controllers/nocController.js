import { AnalyticsTicket } from "../models/index.js";

export const getNocTickets = async (req, res) => {
  try {
    const { startDate, endDate, rca, reporter, owner, confirmationBy, showL2Only } = req.query;

    const matchConditions = {
      $or: [{ is_noc: true }, { has_l2_noc_confirmation: true }],
    };

    if (startDate && endDate) {
      matchConditions.closed_date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    if (rca && rca !== "all") {
      const rcaArr = rca.split(",").map(r => r.trim());
      matchConditions.noc_rca = rcaArr.length === 1 ? rcaArr[0] : { $in: rcaArr };
    }

    if (reporter && reporter !== "all") {
      const reporterArr = reporter.split(",").map(r => r.trim());
      matchConditions.noc_reported_by = reporterArr.length === 1 ? reporterArr[0] : { $in: reporterArr };
    }

    if (owner && owner !== "all") {
      const ownerArr = owner.split(",").map(r => r.trim());
      matchConditions.owner = ownerArr.length === 1 ? ownerArr[0] : { $in: ownerArr };
    }

    if (confirmationBy && confirmationBy !== "all") {
      const confirmArr = confirmationBy.split(",").map(r => r.trim());
      matchConditions.noc_confirmation_by = confirmArr.length === 1 ? confirmArr[0] : { $in: confirmArr };
    }

    if (showL2Only === "true") {
      matchConditions.has_l2_noc_confirmation = true;
    }

    const nocTickets = await AnalyticsTicket.find(matchConditions)
      .select({
        display_id: 1, title: 1, owner: 1,
        noc_issue_id: 1, noc_jira_key: 1, noc_rca: 1,
        noc_reported_by: 1, noc_assignee: 1,
        noc_confirmation_by: 1, has_l2_noc_confirmation: 1,
        noc_confirmation_iss_id: 1, is_noc: 1,
        closed_date: 1, created_date: 1,
      })
      .sort({ closed_date: -1 })
      .lean();

    const baseFilter = { $or: [{ is_noc: true }, { has_l2_noc_confirmation: true }] };

    const [rcaValues, reporterValues, ownerValues, confirmationByValues] = await Promise.all([
      AnalyticsTicket.distinct("noc_rca", baseFilter),
      AnalyticsTicket.distinct("noc_reported_by", baseFilter),
      AnalyticsTicket.distinct("owner", baseFilter),
      AnalyticsTicket.distinct("noc_confirmation_by", baseFilter),
    ]);

    const [byReporter, byRca, byOwner, byConfirmation] = await Promise.all([
      AnalyticsTicket.aggregate([
        { $match: matchConditions },
        { $group: { _id: "$noc_reported_by", count: { $sum: 1 } } },
        { $match: { _id: { $ne: null } } },
        { $sort: { count: -1 } },
      ]),
      AnalyticsTicket.aggregate([
        { $match: matchConditions },
        { $group: { _id: "$noc_rca", count: { $sum: 1 } } },
        { $match: { _id: { $ne: null } } },
        { $sort: { count: -1 } },
      ]),
      AnalyticsTicket.aggregate([
        { $match: matchConditions },
        { $group: { _id: "$owner", count: { $sum: 1 } } },
        { $match: { _id: { $ne: null } } },
        { $sort: { count: -1 } },
      ]),
      AnalyticsTicket.aggregate([
        { $match: matchConditions },
        { $group: { _id: "$noc_confirmation_by", count: { $sum: 1 } } },
        { $match: { _id: { $ne: null } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    res.json({
      tickets: nocTickets,
      filters: {
        rcaOptions: rcaValues.filter(r => r != null && r !== "").sort(),
        reporterOptions: reporterValues.filter(r => r != null && r !== "").sort(),
        ownerOptions: ownerValues.filter(r => r != null && r !== "").sort(),
        confirmationByOptions: confirmationByValues.filter(r => r != null && r !== "").sort(),
      },
      stats: {
        total: nocTickets.length,
        byReporter: byReporter.map(r => ({ name: r._id, value: r.count })),
        byRca: byRca.map(r => ({ name: r._id, value: r.count })),
        byOwner: byOwner.map(r => ({ name: r._id, value: r.count })),
        byConfirmation: byConfirmation.map(r => ({ name: r._id, value: r.count })),
      },
    });
  } catch (e) {
    console.error("❌ /api/tickets/noc error:", e.message);
    res.status(500).json({
      tickets: [],
      filters: { rcaOptions: [], reporterOptions: [], ownerOptions: [], confirmationByOptions: [] },
      stats: { total: 0, byReporter: [], byRca: [], byOwner: [], byConfirmation: [] },
      error: e.message,
    });
  }
};

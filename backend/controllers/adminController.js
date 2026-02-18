import axios from "axios";
import { AnalyticsTicket } from "../models/index.js";
import { DEVREV_API, HEADERS } from "../services/devrevApi.js";
import { sendSlackAlerts, findGSTMember, getSlackWebhookUrl } from "../services/slackService.js";
import { resolveOwnerName, GST_SLACK_MEMBER_IDS } from "../config/constants.js";
import { getHistoricalSyncQueue, getAnalyticsQueue } from "../lib/queues.js";

export const syncNow = async (req, res) => {
  console.log("🔄 Manual sync triggered...");
  try {
    const queue = getHistoricalSyncQueue();
    if (!queue) {
      return res.status(503).json({ success: false, error: "Sync queue not available (no Redis)" });
    }
    const job = await queue.add("delta-sync", {}, { jobId: `manual-sync-${Date.now()}` });
    res.status(202).json({
      success: true,
      message: "Historical sync job dispatched. Check Bull Board for progress.",
      jobId: job.id,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

export const getSyncStatus = async (req, res) => {
  try {
    const count = await AnalyticsTicket.countDocuments();
    const latest = await AnalyticsTicket.findOne().sort({ closed_date: -1 });
    const oldest = await AnalyticsTicket.findOne().sort({ closed_date: 1 });

    const latestDate = latest?.closed_date;
    const isStale = latestDate
      ? Date.now() - new Date(latestDate).getTime() > 2 * 24 * 60 * 60 * 1000
      : true;

    res.json({
      totalTickets: count,
      latestClosedDate: latestDate,
      oldestClosedDate: oldest?.closed_date,
      isStale,
      message: isStale
        ? "⚠️ Data may be stale. Consider running manual sync."
        : "✅ Data is up to date",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const backfill = async (req, res) => {
  try {
    const queue = getHistoricalSyncQueue();
    if (!queue) {
      return res.status(503).json({ error: "Sync queue not available (no Redis)" });
    }
    const job = await queue.add("full-sync", { fullSync: true }, { jobId: `backfill-${Date.now()}` });
    res.status(202).json({ message: "Full backfill job dispatched.", jobId: job.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const getJobStatus = async (req, res) => {
  const { jobId } = req.params;
  const { queue: queueName } = req.query;
  try {
    const queueMap = {
      "historical-sync": getHistoricalSyncQueue,
      analytics: getAnalyticsQueue,
    };
    const getQueue = queueMap[queueName];
    if (!getQueue) {
      return res.status(400).json({ error: `Unknown queue: ${queueName}` });
    }
    const q = getQueue();
    if (!q) {
      return res.status(503).json({ error: "Queue not available" });
    }
    const job = await q.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    const state = await job.getState();
    res.json({
      jobId: job.id,
      state,
      progress: job.progress,
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      timestamp: job.timestamp,
      finishedOn: job.finishedOn,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const verifyGSTNames = async (req, res) => {
  try {
    const configuredGSTMembers = Object.keys(GST_SLACK_MEMBER_IDS);

    const understandingGapTickets = await AnalyticsTicket.find({
      noc_rca: { $regex: /understanding gap/i }
    }).select({ noc_reported_by: 1, ticket_id: 1, closed_date: 1 }).lean();

    const uniqueReporters = [...new Set(understandingGapTickets.map(t => t.noc_reported_by).filter(Boolean))];

    const matched = uniqueReporters.filter(name => findGSTMember(name));
    const notMatched = uniqueReporters.filter(name => !findGSTMember(name));

    const unmatchedWithCounts = notMatched.map(name => {
      const tickets = understandingGapTickets.filter(t => t.noc_reported_by === name);
      return {
        name,
        ticketCount: tickets.length,
        sampleTickets: tickets.slice(0, 3).map(t => t.ticket_id)
      };
    }).sort((a, b) => b.ticketCount - a.ticketCount);

    const gstWithNoTickets = configuredGSTMembers.filter(name => !uniqueReporters.includes(name));

    res.json({
      summary: {
        totalConfiguredGST: configuredGSTMembers.length,
        totalUniqueReporters: uniqueReporters.length,
        matchedReporters: matched.length,
        unmatchedReporters: notMatched.length,
        potentialMissedAlerts: unmatchedWithCounts.reduce((sum, r) => sum + r.ticketCount, 0)
      },
      configuredGSTMembers: configuredGSTMembers.sort(),
      matchedReporters: matched.sort(),
      unmatchedReporters: unmatchedWithCounts,
      gstMembersWithNoTickets: gstWithNoTickets.sort(),
      note: "Unmatched reporters will NOT trigger Slack alerts. Add them to GST_SLACK_MEMBER_IDS if they should."
    });
  } catch (err) {
    console.error("Error verifying GST names:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const getPendingAlerts = async (req, res) => {
  try {
    const SLACK_ALERT_START_DATE = new Date("2026-01-25");

    const pendingTickets = await AnalyticsTicket.find({
      closed_date: { $gte: SLACK_ALERT_START_DATE },
      noc_rca: { $regex: /understanding gap - cs/i },
      slack_alerted_at: null
    }).select({
      ticket_id: 1, title: 1, closed_date: 1, noc_rca: 1,
      noc_reported_by: 1, noc_jira_key: 1, account_name: 1
    }).sort({ closed_date: -1 }).lean();

    const alertedTickets = await AnalyticsTicket.find({
      closed_date: { $gte: SLACK_ALERT_START_DATE },
      noc_rca: { $regex: /understanding gap - cs/i },
      slack_alerted_at: { $ne: null }
    }).select({
      ticket_id: 1, closed_date: 1, slack_alerted_at: 1, noc_reported_by: 1
    }).sort({ slack_alerted_at: -1 }).lean();

    const pendingWithGST = pendingTickets.filter(t => findGSTMember(t.noc_reported_by));
    const pendingNonGST = pendingTickets.filter(t => !findGSTMember(t.noc_reported_by));

    res.json({
      summary: {
        pendingAlerts: pendingWithGST.length,
        pendingNonGST: pendingNonGST.length,
        alreadyAlerted: alertedTickets.length,
        slackWebhookConfigured: !!getSlackWebhookUrl()
      },
      pendingTickets: pendingWithGST.map(t => ({ ...t, isGSTReporter: true, willAlert: true })),
      pendingNonGST: pendingNonGST.map(t => ({ ...t, isGSTReporter: false, willAlert: false, reason: "Reporter not in GST team" })),
      alreadyAlerted: alertedTickets
    });
  } catch (err) {
    console.error("Error fetching pending alerts:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const sendPendingAlerts = async (req, res) => {
  try {
    const SLACK_ALERT_START_DATE = new Date("2026-01-25");

    const pendingTickets = await AnalyticsTicket.find({
      closed_date: { $gte: SLACK_ALERT_START_DATE },
      noc_rca: { $regex: /understanding gap - cs/i },
      slack_alerted_at: null,
    }).lean();

    const eligible = pendingTickets.filter(t => findGSTMember(t.noc_reported_by));

    if (eligible.length === 0) {
      return res.json({ message: "No pending alerts to send", sent: 0 });
    }

    const alertPayload = eligible.map(t => ({
      ticket_id: t.ticket_id,
      noc_jira_key: t.noc_jira_key,
      noc_rca: t.noc_rca,
      noc_reported_by: t.noc_reported_by,
      noc_assignee: t.noc_assignee,
      noc_confirmation_by: t.noc_confirmation_by || null,
      account_name: t.account_name || "Unknown",
    }));

    const sentCount = await sendSlackAlerts(alertPayload) || 0;

    res.json({
      message: `Sent ${sentCount} Slack alerts (${eligible.length - sentCount} skipped as already alerted)`,
      sent: sentCount,
      skipped: eligible.length - sentCount,
      tickets: eligible.map(t => t.ticket_id),
    });
  } catch (err) {
    console.error("Error sending pending alerts:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export const testSlack = async (req, res) => {
  const SLACK_WEBHOOK_URL = getSlackWebhookUrl();
  if (!SLACK_WEBHOOK_URL) {
    return res.status(400).json({
      success: false,
      error: "SLACK_WEBHOOK_URL not configured in environment variables"
    });
  }

  try {
    const payload = {
      text: `✅ *Slack Webhook Test*\n\nThis is a test message from the Support Dashboard.\nTimestamp: ${new Date().toISOString()}\n\nIf you see this, your webhook is working correctly!`
    };

    await axios.post(SLACK_WEBHOOK_URL, payload);
    console.log("📢 Test Slack message sent successfully");

    res.json({
      success: true,
      message: "Test message sent to Slack! Check your channel.",
      webhookConfigured: true
    });
  } catch (err) {
    console.error("❌ Slack test failed:", err.message);
    res.status(500).json({
      success: false,
      error: err.message,
      hint: "Check if your SLACK_WEBHOOK_URL is correct and the webhook is not disabled"
    });
  }
};

export const syncSingleTicket = async (req, res) => {
  const { ticketId } = req.body;
  if (!ticketId) {
    return res.status(400).json({ error: "ticketId required" });
  }

  try {
    console.log(`🔄 Single ticket sync: ${ticketId}`);

    const ticketRes = await axios.post(
      `${DEVREV_API}/works.get`,
      { id: ticketId },
      { headers: HEADERS }
    );
    const t = ticketRes.data.work;
    if (!t) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const stage = t.stage?.name?.toLowerCase() || "";
    const isSolved = stage.includes("solved") || stage.includes("closed") || stage.includes("resolved");

    const ownerRaw = t.owned_by?.[0]?.display_name || "";
    const owner = resolveOwnerName(ownerRaw);

    let isNoc = false, nocIssueId = null, nocJiraKey = null, nocRca = null, nocReportedBy = null, nocAssignee = null;
    const NOC_CHECK_DATE = new Date("2026-01-01");
    const SLACK_ALERT_START_DATE = new Date("2026-01-25");
    const closedDate = t.actual_close_date ? new Date(t.actual_close_date) : null;

    if (closedDate && closedDate >= NOC_CHECK_DATE) {
      try {
        const linksRes = await axios.post(
          `${DEVREV_API}/links.list`,
          { object: t.id, object_types: ["issue"], limit: 10 },
          { headers: HEADERS }
        );
        for (const link of linksRes.data.links || []) {
          const issueId = link.target?.display_id || link.source?.display_id;
          if (!issueId || !issueId.startsWith("ISS-")) continue;

          const issRes = await axios.post(
            `${DEVREV_API}/works.get`,
            { id: issueId },
            { headers: HEADERS }
          );
          const issue = issRes.data.work;
          if (issue?.custom_fields?.ctype__issuetype === "PSN Task") {
            isNoc = true;
            nocIssueId = issue.display_id;
            nocJiraKey = issue.custom_fields?.ctype__key || null;
            nocRca = issue.custom_fields?.ctype__customfield_10169 || null;
            nocReportedBy = issue.reported_by?.[0]?.display_name || null;
            nocAssignee = issue.owned_by?.[0]?.display_name || null;
            break;
          }
        }
      } catch (e) {
        console.log("NOC detection error:", e.message);
      }
    }

    const existingTicket = await AnalyticsTicket.findOne({ ticket_id: t.display_id });
    const alreadyAlerted = existingTicket?.slack_alerted_at != null;
    const closedAfterStartDate = closedDate && closedDate >= SLACK_ALERT_START_DATE;
    const isReporterGST = nocReportedBy && findGSTMember(nocReportedBy);
    const hasUnderstandingGapCS = nocRca && nocRca.toLowerCase().includes("understanding gap - cs");

    const alertConditions = {
      isSolved, isNoc, hasUnderstandingGapCS,
      isReporterGST: !!isReporterGST,
      notAlreadyAlerted: !alreadyAlerted,
      closedAfterJan25: closedAfterStartDate,
      nocReportedBy, nocRca,
    };

    const shouldAlert = isSolved && hasUnderstandingGapCS && isReporterGST && !alreadyAlerted && closedAfterStartDate;

    let slackSent = false;
    if (shouldAlert) {
      const existingDoc = await AnalyticsTicket.findOne({ ticket_id: t.display_id });
      await sendSlackAlerts([{
        ticket_id: t.display_id,
        noc_jira_key: nocJiraKey,
        noc_rca: nocRca,
        noc_reported_by: nocReportedBy,
        noc_assignee: nocAssignee,
        noc_confirmation_by: existingDoc?.noc_confirmation_by || null,
        account_name: t.custom_fields?.tnt__instance_account_name || t.account?.display_name || "Unknown",
      }]);
      slackSent = true;
    }

    await AnalyticsTicket.updateOne(
      { ticket_id: t.display_id },
      {
        $set: {
          ticket_id: t.display_id,
          display_id: t.display_id,
          title: t.title,
          created_date: new Date(t.created_date),
          closed_date: closedDate,
          owner,
          region: t.custom_fields?.tnt__region_salesforce || "Unknown",
          priority: t.priority,
          is_noc: isNoc,
          noc_issue_id: nocIssueId,
          noc_jira_key: nocJiraKey,
          noc_rca: nocRca,
          noc_reported_by: nocReportedBy,
          noc_assignee: nocAssignee,
          account_name: t.custom_fields?.tnt__instance_account_name || t.account?.display_name || "Unknown",
        },
      },
      { upsert: true }
    );

    res.json({
      success: true,
      ticketId: t.display_id,
      stage: t.stage?.name,
      alertConditions,
      shouldAlert,
      slackSent,
      message: slackSent ? "✅ Slack alert sent!" : shouldAlert ? "Alert conditions met but send failed" : "Alert conditions not met",
    });
  } catch (e) {
    console.error("Single ticket sync error:", e.message);
    res.status(500).json({ error: e.message });
  }
};

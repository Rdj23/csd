import axios from "axios";
import { AnalyticsTicket } from "../models/index.js";
import { GST_SLACK_MEMBER_IDS, SLACK_ADMIN_ID } from "../config/constants.js";

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// Lookup GST member by full name or first name fallback
export const findGSTMember = (name) => {
  if (!name) return null;
  if (GST_SLACK_MEMBER_IDS[name]) return GST_SLACK_MEMBER_IDS[name];
  const nameLower = name.toLowerCase();
  const match = Object.entries(GST_SLACK_MEMBER_IDS).find(
    ([fullName]) => fullName.toLowerCase().split(" ")[0] === nameLower
  );
  return match ? match[1] : null;
};

/**
 * Send Slack alert for Understanding Gap - CS NOC tickets
 * @param {Array} tickets - Array of ticket objects to alert
 */
export const sendSlackAlerts = async (tickets) => {
  if (!SLACK_WEBHOOK_URL || tickets.length === 0) return;

  let sentCount = 0;

  for (const ticket of tickets) {
    // Double-check: skip if already alerted (prevents duplicates from concurrent runs)
    const existing = await AnalyticsTicket.findOne({ ticket_id: ticket.ticket_id, slack_alerted_at: { $ne: null } });
    if (existing) {
      console.log(`   ⏭️ Skipping ${ticket.ticket_id} - already alerted`);
      continue;
    }

    const reporterMention = findGSTMember(ticket.noc_reported_by) || ticket.noc_reported_by || "Unknown";
    const confirmationMention = findGSTMember(ticket.noc_confirmation_by) || ticket.noc_confirmation_by || "N/A";
    const ticketLink = `<https://app.devrev.ai/clevertapsupport/works/${ticket.ticket_id}|${ticket.ticket_id}>`;

    const payload = {
      text:
        `<!here> 🚨 The below NOC task was incorrectly created:\n\n` +
        `• Jira Ticket: https://wizrocket.atlassian.net/browse/${ticket.noc_jira_key}\n` +
        `• DevRev Ticket: ${ticketLink}\n` +
        `• Account: ${ticket.account_name}\n` +
        `• RCA: ${ticket.noc_rca}\n` +
        `• Reported By: ${reporterMention}\n` +
        `• Confirmed By: ${confirmationMention}\n` +
        `• Task Assignee: ${ticket.noc_assignee || "Unassigned"}\n` +
        `FYI: ${SLACK_ADMIN_ID}`,
    };

    try {
      await axios.post(SLACK_WEBHOOK_URL, payload);
      // Mark as alerted IMMEDIATELY after successful send
      await AnalyticsTicket.updateOne(
        { ticket_id: ticket.ticket_id },
        { $set: { slack_alerted_at: new Date() } }
      );
      sentCount++;
      console.log(`   📢 Slack alert sent & marked for ${ticket.ticket_id}`);
    } catch (err) {
      console.error(`   ❌ Slack alert failed for ${ticket.ticket_id}:`, err.message);
    }
  }

  if (sentCount > 0) {
    console.log(`   ✅ Total ${sentCount} Slack alerts sent`);
  }
  return sentCount;
};

export const getSlackWebhookUrl = () => SLACK_WEBHOOK_URL;

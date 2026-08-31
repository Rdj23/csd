/**
 * activity/webhook — The live path — one timeline entry arriving from a DevRev webhook.
 *
 * Extracted from the 653-line activityService.js; logic unchanged.
 * See activity/index.js for how a comment becomes points.
 */

import logger from "../../config/logger.js";
import { processTimelineEntry } from "./entries.js";

// ---------------------------------------------------------------------------
// Process a webhook timeline_entry_created event
// ---------------------------------------------------------------------------

export const processWebhookTimelineEntry = async (eventBody) => {
  // DevRev webhook payloads vary — try common paths
  const entry =
    eventBody.payload?.timeline_entry ||
    eventBody.timeline_entry ||
    eventBody.payload;

  if (!entry || entry.type !== "timeline_comment") {
    return null;
  }

  try {
    const result = await processTimelineEntry(entry);
    if (result) {
      logger.info(
        { entry_id: entry.id, user: result.user_name, visibility: result.visibility },
        "Webhook: activity entry processed",
      );
    }
    return result;
  } catch (err) {
    // Duplicate key (race condition) is fine — means already processed
    if (err.code === 11000) return null;
    throw err;
  }
};

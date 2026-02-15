import axios from "axios";
import { DEVREV_API, HEADERS } from "./devrevApi.js";
import { redisGet, redisSet } from "../config/database.js";

// Helper: fetch timeline replies for a single ticket from DevRev
// Optimized: fetches only the latest 10 entries (no pagination) since we
// only need the most recent CT and customer reply timestamps.
export const fetchTimelineForTicket = async (ticketId) => {
  const objectDon = `don:core:dvrv-us-1:devo/1iVu4ClfVV:ticket/${ticketId}`;
  let lastCtReply = null;
  let lastCustomerReply = null;

  const tlRes = await axios.post(
    `${DEVREV_API}/timeline-entries.list`,
    {
      object: objectDon,
      collections: ["discussions"],
      visibility: ["external"],
      limit: 10,
    },
    { headers: HEADERS, timeout: 10000 },
  );

  const entries = tlRes.data.timeline_entries || [];

  for (const te of entries) {
    if (te.type !== "timeline_comment") continue;

    let replyTime = te.created_date;
    if (te.snap_widget_body && Array.isArray(te.snap_widget_body)) {
      const emailWidget = te.snap_widget_body.find(
        (w) => w.type === "email_preview",
      );
      if (emailWidget && emailWidget.sent_timestamp) {
        replyTime = emailWidget.sent_timestamp;
      }
    }

    const actorType = te.created_by?.type;

    if (actorType === "dev_user" || actorType === "service_account") {
      if (!lastCtReply || new Date(replyTime) > new Date(lastCtReply)) {
        lastCtReply = replyTime;
      }
    }

    if (actorType === "rev_user") {
      if (!lastCustomerReply || new Date(replyTime) > new Date(lastCustomerReply)) {
        lastCustomerReply = replyTime;
      }
    }
  }

  return { last_ct_reply: lastCtReply, last_customer_reply: lastCustomerReply };
};

// Background job: pre-warm timeline cache for all active tickets after sync
// Uses per-ticket Redis keys so the API endpoint is a pure cache read
export const enrichTimelineReplies = async () => {
  const tickets = await redisGet("tickets:active");
  if (!tickets || !tickets.length) return;

  const ticketIds = tickets
    .map((t) => t.display_id?.replace("TKT-", ""))
    .filter(Boolean);

  // Check which tickets are already cached (per-ticket keys)
  const uncachedIds = [];
  await Promise.all(
    ticketIds.map(async (id) => {
      const cached = await redisGet(`timeline:reply:${id}`);
      if (!cached) uncachedIds.push(id);
    }),
  );

  if (!uncachedIds.length) {
    console.log("✅ Timeline cache already warm for all tickets");
    return;
  }

  console.log(`🔄 Enriching timeline replies for ${uncachedIds.length} tickets...`);
  let enriched = 0;

  // Process 5 at a time with 500ms delay between batches
  const BATCH = 5;
  for (let i = 0; i < uncachedIds.length; i += BATCH) {
    const batch = uncachedIds.slice(i, i + BATCH);

    await Promise.all(
      batch.map(async (ticketId) => {
        try {
          const data = await fetchTimelineForTicket(ticketId);
          await redisSet(`timeline:reply:${ticketId}`, data, 1800);
          enriched++;
        } catch (e) {
          // Cache null result to avoid re-fetching on next request
          await redisSet(`timeline:reply:${ticketId}`, {
            last_ct_reply: null,
            last_customer_reply: null,
          }, 1800);
        }
      }),
    );

    // Rate limit: 500ms pause between batches
    if (i + BATCH < uncachedIds.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`✅ Timeline enrichment done: ${enriched} tickets enriched`);
};

// Batch fetch timeline replies (used by the API endpoint)
export const batchFetchTimelineReplies = async (ticketIds) => {
  if (!ticketIds || !ticketIds.length) {
    return {};
  }

  // Per-ticket Redis cache lookup
  const results = {};
  const uncachedIds = [];

  // Check individual per-ticket keys in parallel
  await Promise.all(
    ticketIds.map(async (id) => {
      const cached = await redisGet(`timeline:reply:${id}`);
      if (cached) {
        results[id] = cached;
      } else {
        uncachedIds.push(id);
      }
    }),
  );

  // Fetch uncached tickets from DevRev (5 concurrent, 200ms delay)
  if (uncachedIds.length > 0) {
    const BATCH_SIZE = 5;
    for (let i = 0; i < uncachedIds.length; i += BATCH_SIZE) {
      const batch = uncachedIds.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (ticketId) => {
          try {
            const data = await fetchTimelineForTicket(ticketId);
            results[ticketId] = data;
            // Cache per-ticket with 30 min TTL
            await redisSet(`timeline:reply:${ticketId}`, data, 1800);
          } catch (e) {
            results[ticketId] = {
              last_ct_reply: null,
              last_customer_reply: null,
            };
          }
        }),
      );

      // Rate limit between batches
      if (i + BATCH_SIZE < uncachedIds.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  return results;
};

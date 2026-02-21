import axios from "axios";
import { DEVREV_API, HEADERS } from "./devrevApi.js";
import { redisGet } from "../config/database.js";
import { publishSocketEvent } from "../lib/pubsub.js";

// In-memory fallback cache for when Redis is down
const memoryCache = new Map();
const MEMORY_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const memGet = (key) => {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) { memoryCache.delete(key); return null; }
  return entry.data;
};

const memSet = (key, data) => {
  // Cap memory cache at 500 entries to prevent unbounded growth
  if (memoryCache.size > 500) {
    const oldest = memoryCache.keys().next().value;
    memoryCache.delete(oldest);
  }
  memoryCache.set(key, { data, expiry: Date.now() + MEMORY_CACHE_TTL });
};

// Helper: fetch timeline replies for a single ticket from DevRev
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

// Cache helper: in-memory only (Redis too expensive for per-ticket keys)
const cacheTimeline = async (ticketId, data) => {
  memSet(`timeline:reply:${ticketId}`, data);
};

// Cache helper: read from in-memory cache
const getCachedTimeline = async (ticketId) => {
  return memGet(`timeline:reply:${ticketId}`);
};

// Background job: pre-warm timeline cache for all active tickets after sync
// Uses per-ticket Redis + memory keys so the API endpoint is a pure cache read
export const enrichTimelineReplies = async () => {
  const tickets = await redisGet("tickets:active");
  if (!tickets || !tickets.length) return;

  const ticketIds = tickets
    .map((t) => t.display_id?.replace("TKT-", ""))
    .filter(Boolean);

  // Check which tickets are already cached
  const uncachedIds = [];
  for (const id of ticketIds) {
    const cached = await getCachedTimeline(id);
    if (!cached) uncachedIds.push(id);
  }

  if (!uncachedIds.length) {
    console.log("✅ Timeline cache already warm for all tickets");
    return;
  }

  console.log(`🔄 Enriching timeline replies for ${uncachedIds.length} tickets...`);
  let enriched = 0;

  // Process 3 at a time with 500ms delay between batches (reduced from 5)
  const BATCH = 3;
  for (let i = 0; i < uncachedIds.length; i += BATCH) {
    const batch = uncachedIds.slice(i, i + BATCH);

    await Promise.all(
      batch.map(async (ticketId) => {
        try {
          const data = await fetchTimelineForTicket(ticketId);
          await cacheTimeline(ticketId, data);
          enriched++;
        } catch (e) {
          await cacheTimeline(ticketId, {
            last_ct_reply: null,
            last_customer_reply: null,
          });
        }
      }),
    );

    if (i + BATCH < uncachedIds.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`✅ Timeline enrichment done: ${enriched} tickets enriched`);
};

// API endpoint handler: CACHE-ONLY read — never calls DevRev on user requests.
// Returns { cached: {...}, pending: [...] } so the frontend knows what to skeleton.
export const batchFetchTimelineReplies = async (ticketIds) => {
  if (!ticketIds || !ticketIds.length) {
    return { cached: {}, pending: [] };
  }

  const cached = {};
  const pending = [];

  // Pure cache read from Redis + in-memory fallback
  await Promise.all(
    ticketIds.map(async (id) => {
      const data = await getCachedTimeline(id);
      if (data) {
        cached[id] = data;
      } else {
        pending.push(id);
      }
    }),
  );

  return { cached, pending };
};

// Worker-side function: fetches missing timeline data from DevRev in batches,
// updates cache, and publishes each batch via Redis Pub/Sub → Socket.IO.
export const fetchMissingTimelinesForWorker = async (missingIds) => {
  if (!missingIds || !missingIds.length) return;

  const BATCH = 3;
  const DELAY_MS = 200; // Respect DevRev rate limit

  for (let i = 0; i < missingIds.length; i += BATCH) {
    const batch = missingIds.slice(i, i + BATCH);
    const batchResults = {};

    await Promise.all(
      batch.map(async (ticketId) => {
        try {
          const data = await fetchTimelineForTicket(ticketId);
          await cacheTimeline(ticketId, data);
          batchResults[ticketId] = data;
        } catch (e) {
          const fallback = { last_ct_reply: null, last_customer_reply: null };
          await cacheTimeline(ticketId, fallback);
          batchResults[ticketId] = fallback;
        }
      }),
    );

    // Push batch to all connected clients via Pub/Sub
    await publishSocketEvent("timeline_batch_updated", batchResults);

    // Rate-limit delay between batches
    if (i + BATCH < missingIds.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
};

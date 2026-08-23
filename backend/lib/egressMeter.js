/**
 * egressMeter.js — Measures outbound (service-initiated) bandwidth.
 *
 * WHY THIS EXISTS:
 * Render bills bandwidth in two buckets: "HTTP Responses" (what we serve to
 * browsers) and "Service-Initiated" (what WE pull from external services).
 * On 2026-08-09 the second bucket was 7.31 GB of an 8.96 GB total — the
 * phase-2 solved scan pulling ~20k ticket JSONs on every webhook batch.
 * Nothing in the app measured that, so it was invisible until the bill.
 *
 * On the Hobby plan bandwidth is metered at $0.15/GB, so a regression now
 * costs money rather than just headroom. This meter makes the number visible
 * DAILY instead of at month-end.
 *
 * WHY A GLOBAL AXIOS INTERCEPTOR:
 * DevRev/Slack/roster calls are spread across ~8 files using bare `axios`
 * rather than a shared client instance (see devrevApi.js, syncService.js,
 * attentionService.js, slackService.js…). Patching each call site would
 * guarantee we miss the next one. Registering on the axios DEFAULT instance
 * catches every current and future caller with one hook.
 *
 * WHAT IT COUNTS:
 * `content-length` when the server sends it — that is the COMPRESSED,
 * on-the-wire size, which is what Render bills. axios decompresses the body
 * afterwards but leaves the original response headers intact, so this stays
 * accurate for gzipped DevRev responses.
 * When a response is chunked (no content-length) we fall back to the
 * DECOMPRESSED body length and flag the day's total as an over-estimate —
 * better to over-report than to silently under-count.
 */

import axios from "axios";
import { getRedis, isRedisReady } from "../config/database.js";
import { istTodayYmd } from "../config/constants.js";
import logger from "../config/logger.js";

// In-memory accumulator, flushed to Redis periodically. Keyed by host so a
// spike can be attributed ("which upstream grew?") rather than just observed.
let pending = new Map();
let pendingEstimated = 0;
let flushTimer = null;
let registered = false;

const FLUSH_INTERVAL_MS = 60_000;

/** Redis hash holding one IST day of per-host byte counts. */
const dayKey = () => `egress:ist:${istTodayYmd()}`;

// 10 days of history is enough to spot a regression against the previous
// week without holding data we will never look at.
const DAY_TTL_S = 10 * 24 * 60 * 60;

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
};

/**
 * Best-effort byte count for one response.
 * Returns { bytes, estimated } — `estimated` marks the chunked fallback.
 */
const measure = (response) => {
  const len = response?.headers?.["content-length"];
  if (len) {
    const n = Number(len);
    if (Number.isFinite(n)) return { bytes: n, estimated: false };
  }
  // No content-length → chunked. Fall back to the decompressed payload.
  try {
    const data = response?.data;
    if (data == null) return { bytes: 0, estimated: true };
    if (typeof data === "string") return { bytes: Buffer.byteLength(data), estimated: true };
    if (Buffer.isBuffer(data)) return { bytes: data.length, estimated: true };
    return { bytes: Buffer.byteLength(JSON.stringify(data)), estimated: true };
  } catch {
    return { bytes: 0, estimated: true };
  }
};

const record = (response) => {
  try {
    const url = response?.config?.url;
    if (!url) return;
    const { bytes, estimated } = measure(response);
    if (bytes <= 0) return;
    const host = hostOf(url);
    pending.set(host, (pending.get(host) || 0) + bytes);
    if (estimated) pendingEstimated += bytes;
  } catch {
    // A metering failure must never break the request it is measuring.
  }
};

const mb = (bytes) => Number((bytes / (1024 * 1024)).toFixed(2));

/**
 * Flush the in-memory counters into Redis and log a summary.
 *
 * WHY HINCRBY: two processes (API + worker in hybrid, or separate services in
 * a split topology) both meter into the same day key. HINCRBY is atomic, so
 * neither clobbers the other's total.
 */
export const flushEgress = async () => {
  if (pending.size === 0) return;

  const snapshot = pending;
  const estimated = pendingEstimated;
  pending = new Map();
  pendingEstimated = 0;

  const total = [...snapshot.values()].reduce((a, b) => a + b, 0);

  if (!isRedisReady()) {
    // Redis down — still surface the number rather than dropping it silently.
    logger.warn({ totalMB: mb(total) }, "[egress] Redis unavailable, counters not persisted");
    return;
  }

  try {
    const redis = getRedis();
    const key = dayKey();
    const pipeline = redis.pipeline();
    for (const [host, bytes] of snapshot) pipeline.hincrby(key, host, bytes);
    pipeline.hincrby(key, "_total", total);
    pipeline.expire(key, DAY_TTL_S);
    await pipeline.exec();

    const dayTotal = Number(await redis.hget(key, "_total")) || total;
    logger.info(
      {
        windowMB: mb(total),
        dayMB: mb(dayTotal),
        estimatedMB: mb(estimated),
        byHost: Object.fromEntries([...snapshot].map(([h, b]) => [h, mb(b)])),
      },
      "[egress] outbound bandwidth",
    );
  } catch (e) {
    logger.warn({ err: e.message }, "[egress] flush failed");
  }
};

/** Per-host byte totals for an IST day (defaults to today). */
export const getEgressForDay = async (ymd = istTodayYmd()) => {
  if (!isRedisReady()) return null;
  try {
    const raw = await getRedis().hgetall(`egress:ist:${ymd}`);
    if (!raw || Object.keys(raw).length === 0) return { date: ymd, totalMB: 0, byHost: {} };
    const byHost = {};
    for (const [host, bytes] of Object.entries(raw)) {
      if (host === "_total") continue;
      byHost[host] = mb(Number(bytes));
    }
    return { date: ymd, totalMB: mb(Number(raw._total) || 0), byHost };
  } catch (e) {
    logger.warn({ err: e.message }, "[egress] read failed");
    return null;
  }
};

/**
 * Register the interceptor. Idempotent — hybrid mode imports this from both
 * the server and worker bootstrap paths in the same process.
 */
export const startEgressMeter = () => {
  if (registered) return;
  registered = true;

  axios.interceptors.response.use(
    (response) => {
      record(response);
      return response;
    },
    (error) => {
      // Error responses still crossed the wire and still bill.
      if (error?.response) record(error.response);
      return Promise.reject(error);
    },
  );

  flushTimer = setInterval(() => { flushEgress().catch(() => {}); }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();

  logger.info({ flushIntervalMs: FLUSH_INTERVAL_MS }, "Egress meter started");
};

export const stopEgressMeter = async () => {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  await flushEgress();
};

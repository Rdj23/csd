/**
 * memoryGuard.js — RSS watchdog + admission control for heavy jobs.
 *
 * WHY THIS EXISTS:
 * On 2026-08-08 the Render instance was OOM-killed. The trigger was a bug
 * (a missing import in syncService), but the *reason it escalated to a kill*
 * was that nothing in the process was watching memory. Several full
 * active-ticket syncs stacked up, each holding ~8k ticket objects plus a
 * multi-MB JSON string plus a gzip buffer, and the container died with no
 * warning in the logs — just a hard stop mid-sync.
 *
 * Two jobs, then:
 *
 *  1. VISIBILITY. Sample RSS on a timer and log it. When the next incident
 *     happens we want a rising memory curve in the logs leading up to the
 *     kill, not silence. This alone turns "the service vanished" into
 *     "the service was at 91% for four minutes first".
 *
 *  2. ADMISSION CONTROL. isMemoryCritical() lets a heavy job decline to start
 *     when there isn't headroom for it. Shedding one sync cycle is cheap —
 *     the next cron tick retries and the data is at most an interval stale.
 *     Getting SIGKILLed is expensive: every in-flight job dies, BullMQ marks
 *     them stalled, and the restart stampede re-runs all of them at once.
 *
 * WHY RSS AND NOT heapUsed:
 * V8's --max-old-space-size only bounds the JS heap. The things that actually
 * pushed this process over were largely OFF-heap: gzip output Buffers, ioredis
 * socket buffers, the DevRev axios response bodies. Render's cgroup killer
 * counts all of it. heapUsed would have looked healthy right up to the kill,
 * which is exactly the blind spot that let this happen quietly.
 */

import logger from "../config/logger.js";

// Container memory ceiling. Render Free/Starter instances are 512MB; override
// via env if the instance is resized so the thresholds scale with it.
const LIMIT_MB = Number(process.env.MEMORY_LIMIT_MB) || 512;

// WARN: log loudly, hint a GC, keep serving.
// CRITICAL: additionally refuse to admit new heavy jobs.
//
// 75/88 leaves real room to act. A full active sync costs roughly 100MB at
// peak, so admitting one at 88% of 512MB would be a guaranteed kill; blocking
// there means we shed the job while the process is still healthy enough to
// serve API traffic, which is the part users actually notice.
const WARN_PCT = 0.75;
const CRITICAL_PCT = 0.88;

const SAMPLE_INTERVAL_MS = 30_000;

// Don't re-run gc() on every sample while memory sits high — gc() is a
// stop-the-world pause and hammering it makes the event-loop stalls (and
// therefore the BullMQ lock-renewal failures) worse, not better.
const GC_COOLDOWN_MS = 60_000;

let timer = null;
let lastGcAt = 0;
let lastState = "ok";

const rssMB = () => process.memoryUsage().rss / (1024 * 1024);

const snapshot = () => {
  const m = process.memoryUsage();
  const mb = (bytes) => Number((bytes / (1024 * 1024)).toFixed(1));
  return {
    rssMB: mb(m.rss),
    heapUsedMB: mb(m.heapUsed),
    heapTotalMB: mb(m.heapTotal),
    externalMB: mb(m.external),
    limitMB: LIMIT_MB,
    pctOfLimit: Number(((m.rss / (1024 * 1024) / LIMIT_MB) * 100).toFixed(1)),
  };
};

/**
 * True when the process is too close to the container limit to safely start
 * another memory-hungry job. Heavy workers call this before beginning.
 */
export const isMemoryCritical = () => rssMB() / LIMIT_MB >= CRITICAL_PCT;

export const getMemorySnapshot = snapshot;

/**
 * Guard a heavy job behind a memory check.
 *
 * Returns true if the job should proceed. When it returns false the caller
 * should RETURN, not throw: throwing would mark the BullMQ job failed and
 * trigger the retry/backoff chain, which is more load applied to a process
 * that is already short on memory — precisely the wrong reflex. Every caller
 * here is on a repeating schedule, so skipping simply defers to the next tick.
 */
export const admitHeavyJob = (jobLabel) => {
  if (!isMemoryCritical()) return true;
  logger.error(
    { job: jobLabel, ...snapshot() },
    "Memory critical — refusing to start heavy job (will retry next scheduled run)",
  );
  if (global.gc && Date.now() - lastGcAt > GC_COOLDOWN_MS) {
    lastGcAt = Date.now();
    global.gc();
  }
  return false;
};

const sample = () => {
  const snap = snapshot();
  const pct = snap.pctOfLimit / 100;

  if (pct >= CRITICAL_PCT) {
    logger.error(snap, "Memory critical — heavy jobs are being shed");
    lastState = "critical";
    if (global.gc && Date.now() - lastGcAt > GC_COOLDOWN_MS) {
      lastGcAt = Date.now();
      global.gc();
      logger.warn({ afterGc: snapshot() }, "Forced GC under memory pressure");
    }
  } else if (pct >= WARN_PCT) {
    logger.warn(snap, "Memory elevated — approaching container limit");
    lastState = "warn";
    if (global.gc && Date.now() - lastGcAt > GC_COOLDOWN_MS) {
      lastGcAt = Date.now();
      global.gc();
    }
  } else if (lastState !== "ok") {
    // Only log the all-clear on a transition, so a healthy process stays quiet.
    logger.info(snap, "Memory back to normal");
    lastState = "ok";
  }
};

export const startMemoryGuard = () => {
  if (timer) return;
  timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  // Don't hold the event loop open on shutdown.
  timer.unref();
  logger.info(
    { limitMB: LIMIT_MB, warnPct: WARN_PCT * 100, criticalPct: CRITICAL_PCT * 100, gcAvailable: Boolean(global.gc) },
    "Memory guard started",
  );
};

export const stopMemoryGuard = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

/**
 * models/index.js — the data-model barrel.
 *
 * ONE FILE PER COLLECTION. To change a collection's shape or indexes, open that
 * collection's own file; you never have to scroll through unrelated schemas:
 *
 *   Tickets & parts      AnalyticsTicket.js  Part.js
 *   Analytics caches     AnalyticsCache.js   PrecomputedDashboard.js
 *   Activity tracking    UserActivityEntry.js  UserActivityDaily.js
 *                        ActivitySyncedTicket.js
 *   Attention queue      AttentionQueue.js
 *   User-owned data      Remark.js  View.js
 *   Platform             ApiKey.js  SyncMetadata.js
 *
 * WHY A BARREL: services import several models at once (activityService needs
 * UserActivityEntry AND AnalyticsTicket). Re-exporting from one place keeps
 * those imports short and avoids the circular-import problems that motivated
 * the original single-file layout.
 *
 * KEY CONCEPT — MONGOOSE SCHEMA vs MODEL:
 * Schema = the "blueprint" (what fields exist, their types, constraints).
 * Model  = the "class" you read/write with (Ticket.find(), Ticket.create()).
 * Schema is the form template; Model is the filled-out form you submit.
 *
 * KEY CONCEPT — INDEXES:
 * Indexes are a book's table of contents. Without one, MongoDB scans EVERY
 * document (full collection scan); with one it jumps straight to the matches.
 * The tradeoff: indexes speed up reads but slow writes, since MongoDB must
 * update the index on every insert/update. Each model file documents why its
 * own indexes exist.
 */

// ── Tickets & parts ──────────────────────────────────────────────────────
export { AnalyticsTicket } from "./AnalyticsTicket.js";
export { Part } from "./Part.js";

// ── Analytics caches (both TTL-expired) ──────────────────────────────────
export { AnalyticsCache } from "./AnalyticsCache.js";
export { PrecomputedDashboard } from "./PrecomputedDashboard.js";

// ── Activity tracking ────────────────────────────────────────────────────
export { UserActivityEntry } from "./UserActivityEntry.js";
export { UserActivityDaily } from "./UserActivityDaily.js";
export { ActivitySyncedTicket } from "./ActivitySyncedTicket.js";

// ── Attention queue ──────────────────────────────────────────────────────
export { AttentionQueue } from "./AttentionQueue.js";

// ── User-owned data ──────────────────────────────────────────────────────
export { Remark } from "./Remark.js";
export { View } from "./View.js";

// ── Platform ─────────────────────────────────────────────────────────────
export { ApiKey } from "./ApiKey.js";
export { SyncMetadata } from "./SyncMetadata.js";

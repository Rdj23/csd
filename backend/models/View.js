/**
 * View — Saved filter presets per user.
 *
 * Split out of the former monolithic models/index.js. The schema below is
 * byte-for-byte the original; only the import and this header are new.
 * models/index.js re-exports it, so every existing import still resolves.
 */

import mongoose from "mongoose";

/**
 * WHY THIS EXISTS:
 * Users frequently look at the same subset of tickets (e.g., "My team, APAC region,
 * high priority"). Instead of re-selecting filters every time, they save a "view".
 *
 * `filters` is type Object (not a strict schema) because the filter shape can evolve
 * (new filter types added on frontend) without requiring a DB migration.
 */
const ViewSchema = new mongoose.Schema({
  userId: { type: String, index: true },    // Who created this view
  name: String,                              // Display name ("My APAC High-Pri")
  filters: Object,                           // The saved filter state (teams, regions, owners, etc.)
  createdAt: { type: Date, default: Date.now },
});
export const View = mongoose.model("View", ViewSchema);

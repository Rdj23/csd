/**
 * Part — DevRev part hierarchy (Product > Capability > Feature).
 *
 * Split out of the former monolithic models/index.js. The schema below is
 * byte-for-byte the original; only the import and this header are new.
 * models/index.js re-exports it, so every existing import still resolves.
 */

import mongoose from "mongoose";

/**
 * WHY THIS EXISTS:
 * Tickets point to ONE part via applies_to_part (any level). To render DevRev's part
 * tree and roll ticket counts up to the product, we need the hierarchy itself. The
 * public parts.get API does NOT return parent info — only links.list does — so walking
 * the chain is expensive. We resolve each part's ancestry ONCE via links.list and cache
 * it here. The hierarchy rarely changes, so subsequent syncs are almost all cache hits.
 *
 * _id IS the DevRev DON id (e.g. "don:core:dvrv-us-1:devo/1iVu4ClfVV:product/5").
 * Using the DON as the primary key makes upserts naturally idempotent and lets the
 * resolver check "is this part already cached?" with a single findById.
 *
 * ancestry includes SELF as the last element (root product → … → this part), so a
 * feature's ancestry = [product, capability, feature]. A product's ancestry = [product].
 */
const PartSchema = new mongoose.Schema(
  {
    _id: { type: String },              // DevRev DON id — the natural unique key
    display_id: { type: String, index: true }, // PROD-5 / CAPL-30 / FEAT-269
    type: { type: String, index: true },       // "product" | "capability" | "feature"
    name: { type: String },
    parent_id: { type: String, default: null, index: true }, // immediate is_part_of target DON (null for product)
    product_id: { type: String, default: null, index: true }, // root product DON
    product_name: { type: String, default: null },
    ancestry: { type: [String], default: [] },  // ordered DON ids root→leaf, INCLUDING self
    updated_at: { type: Date, default: Date.now },
  },
  // Declaring the `_id` path as String (above) is enough for Mongoose to use the DON
  // as the key — do NOT add `{ _id: false }`, which would instead strip _id entirely.
  { versionKey: false },
);
export const Part = mongoose.model("Part", PartSchema);

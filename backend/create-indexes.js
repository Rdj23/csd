/**
 * MongoDB Index Creation Script
 * Run this after deploying the optimized backend
 *
 * Usage: node create-indexes.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const createIndexes = async () => {
  try {
    console.log("🔗 Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;
    const collection = db.collection("analyticstickets");

    console.log("\n📊 Creating indexes for Hot/Warm/Cold data strategy...\n");

    // 1. Stage + Close Date (for active vs solved filtering)
    console.log("Creating index: { stage_name: 1, actual_close_date: -1 }");
    await collection.createIndex(
      { stage_name: 1, actual_close_date: -1 },
      { background: true }
    );
    console.log("✅ Index created");

    // 2. Close Date (for recent solved tickets)
    console.log("Creating index: { actual_close_date: -1 }");
    await collection.createIndex(
      { actual_close_date: -1 },
      { background: true }
    );
    console.log("✅ Index created");

    // 3. Creation Date + Stage (for pagination)
    console.log("Creating index: { created_date: -1, stage_name: 1 }");
    await collection.createIndex(
      { created_date: -1, stage_name: 1 },
      { background: true }
    );
    console.log("✅ Index created");

    // ── Parts View indexes (analyticstickets enrichment) ──
    console.log("\n🌳 Creating Parts View indexes...\n");

    console.log("Creating index: { applies_to_part_id: 1, closed_date: -1 }");
    await collection.createIndex({ applies_to_part_id: 1, closed_date: -1 }, { background: true });
    console.log("✅ Index created");

    console.log("Creating index: { product_id: 1, closed_date: -1 }");
    await collection.createIndex({ product_id: 1, closed_date: -1 }, { background: true });
    console.log("✅ Index created");

    // Multikey index on the ancestry array → "every ticket whose chain contains <part>".
    console.log("Creating index: { ancestry: 1, closed_date: -1 }");
    await collection.createIndex({ ancestry: 1, closed_date: -1 }, { background: true });
    console.log("✅ Index created");

    // ── Parts hierarchy collection ──
    const partsCol = db.collection("parts");
    console.log("\nCreating parts indexes: type, parent_id, product_id, ancestry, display_id");
    await partsCol.createIndex({ type: 1 }, { background: true });
    await partsCol.createIndex({ parent_id: 1 }, { background: true });
    await partsCol.createIndex({ product_id: 1 }, { background: true });
    await partsCol.createIndex({ ancestry: 1 }, { background: true });
    await partsCol.createIndex({ display_id: 1 }, { background: true });
    console.log("✅ Parts indexes created");

    console.log("\n📋 Listing all indexes:\n");
    const indexes = await collection.indexes();
    indexes.forEach((idx, i) => {
      console.log(`${i + 1}. ${idx.name}:`);
      console.log(`   Keys: ${JSON.stringify(idx.key)}`);
      console.log(`   Background: ${idx.background || false}`);
    });

    console.log("\n✅ All indexes created successfully!");
    console.log("\n💡 Tip: Run 'db.analyticstickets.getIndexes()' in MongoDB shell to verify\n");

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error creating indexes:", error);
    process.exit(1);
  }
};

createIndexes();

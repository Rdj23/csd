import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// 1. Configure Environment Variables (ES Module style)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

const DEVREV_API = "https://api.devrev.ai";
const PAT = process.env.VITE_DEVREV_PAT; 

if (!PAT) {
  console.error("❌ Error: VITE_DEVREV_PAT is missing from your .env file.");
  process.exit(1);
}

async function checkRateLimit() {
  console.log("🚀 Starting Rate Limit Test...");
  
  // Fire 20 requests in parallel to see headers
  const requests = Array.from({ length: 20 }).map((_, i) => 
    axios.post(
      `${DEVREV_API}/works.list`, 
      { type: ["ticket"], limit: 1 }, 
      { headers: { Authorization: `Bearer ${PAT}` } }
    ).then(res => ({
      status: res.status,
      // Read DevRev Rate Limit Headers
      limit: res.headers['x-ratelimit-limit'], 
      remaining: res.headers['x-ratelimit-remaining'],
      reset: res.headers['x-ratelimit-reset']
    })).catch(err => ({
      status: err.response?.status || "Error",
      data: err.response?.data
    }))
  );

  const results = await Promise.all(requests);
  
  // Log success details
  const success = results.find(r => r.status === 200);
  if (success) {
    console.log(`\n✅ Rate Limit Info:`);
    console.log(`   Total Request Limit: ${success.limit}`);
    console.log(`   Requests Remaining:  ${success.remaining}`);
    console.log(`   Reset Time (Epoch):  ${success.reset}`);
  } else {
    console.log("❌ All requests failed. Check your PAT.");
  }

  const throttled = results.filter(r => r.status === 429);
  console.log(`\n📊 Test Results:`);
  console.log(`   Successful: ${results.filter(r => r.status === 200).length}`);
  console.log(`   Throttled (429): ${throttled.length}`);
}

checkRateLimit();
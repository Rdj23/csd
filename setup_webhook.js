// setup_webhook.js
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const DEVREV_PAT = process.env.DEVREV_PAT;
if (!DEVREV_PAT) {
  throw new Error("❌ DEVREV_PAT missing in .env");
}

// MUST be a full endpoint, not base URL
const WEBHOOK_URL = "https://csd-backend-ljzq.onrender.com/webhooks/devrev";

async function turnOnWebhooks() {
  console.log("🔌 Creating DevRev webhook...");

  const response = await axios.post(
    "https://api.devrev.ai/webhooks.create",
    {
      url: WEBHOOK_URL,

      event_types: ["work_created", "work_updated", "work_deleted"],
    },
    {
      headers: {
        Authorization: `Bearer ${DEVREV_PAT}`,
        "Content-Type": "application/json",
      },
    }
  );
  console.log("✅ SUCCESS! Webhook Created.");
  console.log("ID:", response.data.webhook.id);
  console.log("Secret:", response.data.webhook.secret);
  console.log(response.data);
}

turnOnWebhooks().catch((err) => {
  console.error("❌ Failed to create webhook");
  console.error(err.response?.data || err.message);
});

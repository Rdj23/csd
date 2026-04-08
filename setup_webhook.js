/**
 * setup_webhook.js — One-time script to register a webhook URL with DevRev.
 *
 * HOW WEBHOOKS GET SET UP (the full lifecycle):
 *
 *   Step 1: You run this script ONCE
 *           → Calls DevRev API: "Hey, send events to this URL"
 *           → DevRev sends a challenge request to verify the URL is alive
 *           → Our server responds with the challenge (handled in webhookController.js)
 *           → DevRev confirms: "OK, webhook is active"
 *           → DevRev returns: { webhook.id, webhook.secret }
 *
 *   Step 2: You copy the webhook.secret into your .env file as DEVREV_WEBHOOK_SECRET
 *           This secret is used by webhookVerify.js to validate future events.
 *
 *   Step 3: From now on, DevRev sends POST requests to WEBHOOK_URL
 *           every time a ticket is created, updated, or deleted.
 *           You never need to run this script again (unless changing the URL).
 *
 * WHEN TO RE-RUN THIS SCRIPT:
 * - If you change your backend URL (e.g., migrating from Render to AWS)
 * - If you want to register additional event types
 * - If the webhook gets deactivated (DevRev deactivates after too many failures)
 *
 * IMPORTANT: This is a SETUP script, not part of the running server.
 * Run it manually: `node setup_webhook.js`
 *
 * USAGE:
 *   1. Ensure .env has DEVREV_PAT (your Personal Access Token)
 *   2. Run: node setup_webhook.js
 *   3. Copy the printed "Secret" into .env as DEVREV_WEBHOOK_SECRET
 *   4. Restart your server so it picks up the new secret
 */

import axios from "axios";
import dotenv from "dotenv";

// Load .env to get DEVREV_PAT
dotenv.config();

/**
 * DEVREV_PAT — Personal Access Token for DevRev API authentication.
 * This PAT must have permissions to create webhooks in your DevRev org.
 * Generate one at: DevRev Settings → API Tokens → Create Token
 */
const DEVREV_PAT = process.env.DEVREV_PAT;
if (!DEVREV_PAT) {
  throw new Error("❌ DEVREV_PAT missing in .env");
}

/**
 * WEBHOOK_URL — The public HTTPS URL where DevRev will send events.
 *
 * REQUIREMENTS:
 * 1. Must be HTTPS (DevRev won't send to HTTP)
 * 2. Must be publicly accessible (not localhost — use ngrok for local dev)
 * 3. Must respond to POST requests at this exact path
 * 4. Must handle the challenge handshake (webhook_verify event)
 *
 * This URL must match the route defined in routes/webhooks.js:
 *   router.post("/webhooks/devrev", ...)
 *   Mounted at /api → full path is /api/webhooks/devrev
 *   But our Render deployment proxies /webhooks/devrev directly.
 */
const WEBHOOK_URL = "https://csd-backend-ljzq.onrender.com/webhooks/devrev";

async function turnOnWebhooks() {
  console.log("🔌 Creating DevRev webhook...");

  /**
   * DevRev API: webhooks.create
   *
   * url: Where to send events (must be HTTPS, publicly accessible)
   *
   * event_types: Which events to subscribe to.
   * - "work_created"  → New ticket is created
   * - "work_updated"  → Ticket is modified (stage change, assignment, fields, etc.)
   * - "work_deleted"  → Ticket is deleted
   *
   * WHY NOT SUBSCRIBE TO timeline_entry_created HERE:
   * Timeline entries (comments) ARE received via this webhook — DevRev sends
   * them even though we only subscribed to work_* events. This is because
   * DevRev considers timeline activity as part of the "work" lifecycle.
   * If this changes, add "timeline_entry_created" to event_types.
   *
   * WHAT HAPPENS BEHIND THE SCENES:
   * 1. DevRev registers this URL in their system
   * 2. DevRev generates a unique webhook secret (HMAC key)
   * 3. DevRev sends a verification challenge to our URL
   * 4. If our server responds correctly, webhook is activated
   * 5. DevRev returns the webhook ID + secret in the response
   */
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

  /**
   * CRITICAL OUTPUT:
   * The "Secret" printed here is the DEVREV_WEBHOOK_SECRET.
   * You MUST copy this into your .env file. Without it, webhookVerify.js
   * can't verify incoming webhook signatures, and all events will be rejected.
   *
   * DevRev only shows this secret ONCE at creation time.
   * If you lose it, you must delete the webhook and create a new one.
   */
  console.log("✅ SUCCESS! Webhook Created.");
  console.log("ID:", response.data.webhook.id);
  console.log("Secret:", response.data.webhook.secret);
  console.log(response.data);
}

turnOnWebhooks().catch((err) => {
  console.error("❌ Failed to create webhook");
  console.error(err.response?.data || err.message);
});

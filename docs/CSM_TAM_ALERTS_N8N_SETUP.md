# CSM/TAM Stale-Ticket DMs → Slack via n8n

*Created: 13 Aug 2026*

Every weekday at **11:00 IST** (cron `30 5 * * 1-5` UTC, registered in both `server.js` and `worker.js`), each account's **CSM and TAM** gets a **direct message** listing that account's open / pending / on-hold tickets **older than 15 days**. One DM per person, all their accounts grouped in it — nothing goes to any channel, only to the respective CSM/TAM.

Like the Attention Queue, the backend holds **no Slack token** — it POSTs to an n8n webhook and n8n's Slack bot does the delivery. Unlike the attention flow (channel posts), this one must **DM by email**, so the n8n workflow does `users.lookupByEmail` → `chat.postMessage`.

Backend logic: `backend/services/csmTamAlertService.js`. The job rides the existing `attention` queue (job name `csm-tam-alerts`) so no new Redis connections are used.

- **CSM** emails come straight off the ticket (`tnt__csm_email_id`).
- **TAM** is only a display name on tickets (`tnt__tam`) — the backend resolves it to an email via the DevRev **dev-users directory** (cached 24 h in Redis at `csmtam:devusers`). Names with no directory match are skipped and reported in the run summary as `unresolvedTams`.

---

## 1. Backend → n8n contract

The backend POSTs JSON to `CSM_TAM_N8N_WEBHOOK_URL` (set it in the root `.env`) — **one POST per recipient**:

```json
{
  "kind": "csm_tam_stale_dm",
  "email": "avinash@clevertap.com",
  "name": "Avinash Kalani",
  "text": "<ready-to-post Slack mrkdwn>"
}
```

- `text` is fully formatted by the backend (bold, `<url|TKT-xxx>` links) — except one token: the literal `{SLACK_MENTION}`, which n8n must replace with `<@` + the looked-up user ID + `>` so the greeting renders as a real @-mention. The Send DM expression in §2 does this.
- `email` is the ONLY routing field — look the user up by it and DM them. Never post to a channel.
- Respond `200` on success (any body). **Respond non-2xx if the email isn't found in the workspace** — the backend then logs the failure and, because no sent-marker is written, retries that person on the next run instead of silently losing them.

Idempotency lives in the backend: a Redis marker per recipient per IST day (`csmtam:sent:<yyyy-mm-dd>:<email>`, 48 h TTL) means a retried job never double-DMs. n8n needs no dedup logic.

## 2. n8n workflow — import this as-is

**Webhook → Lookup User by Email → Send DM → Slack OK? → Respond OK / Respond Error**

⚠️ Slack's Web API returns **HTTP 200 even on failure** (`{"ok": false, "error": "…"}` in the body). The IF node ("Slack OK?") converts that into a non-2xx response — without it the backend would mark failed DMs as sent and write the dedup marker.

### Import steps

1. In n8n: **Workflows → Add workflow**, then press **Ctrl/Cmd+V** on the empty canvas (or menu ⋯ → *Import from Clipboard*) with the JSON below copied.
2. In **both** HTTP nodes, replace `xoxb-REPLACE-WITH-BOT-TOKEN` in the Authorization header with the real bot token (scopes: `users:read.email`, `users:read`, `chat:write`, `im:write` — reinstall the Slack app after adding scopes).
3. Test: click **Listen for test event** on the Webhook node, then run the "pipe test" curl from §3 against the **test** URL — the DM should arrive.
4. Toggle the workflow **Active**, copy the Webhook node's **Production URL** (`/webhook/…`, not `/webhook-test/…`) into `CSM_TAM_N8N_WEBHOOK_URL` on Render.

```json
{
  "name": "CSM TAM Stale Ticket DMs",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "csm-tam-alerts",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "a1b2c3d4-0001-4000-8000-000000000001",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [0, 0]
    },
    {
      "parameters": {
        "url": "https://slack.com/api/users.lookupByEmail",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            { "name": "email", "value": "={{ $json.body.email }}" }
          ]
        },
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer xoxb-REPLACE-WITH-BOT-TOKEN" }
          ]
        },
        "options": {}
      },
      "id": "a1b2c3d4-0002-4000-8000-000000000002",
      "name": "Lookup User by Email",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [220, 0]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://slack.com/api/chat.postMessage",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            { "name": "Authorization", "value": "Bearer xoxb-REPLACE-WITH-BOT-TOKEN" }
          ]
        },
        "sendBody": true,
        "contentType": "json",
        "specifyBody": "keypair",
        "bodyParameters": {
          "parameters": [
            { "name": "channel", "value": "={{ $json.user.id }}" },
            { "name": "text", "value": "={{ $('Webhook').item.json.body.text.replace('{SLACK_MENTION}', '<@' + $json.user.id + '>') }}" }
          ]
        },
        "options": {}
      },
      "id": "a1b2c3d4-0003-4000-8000-000000000003",
      "name": "Send DM",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [440, 0]
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": true,
            "leftValue": "",
            "typeValidation": "loose"
          },
          "conditions": [
            {
              "leftValue": "={{ $json.ok }}",
              "rightValue": true,
              "operator": { "type": "boolean", "operation": "true", "singleValue": true }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "a1b2c3d4-0004-4000-8000-000000000004",
      "name": "Slack OK?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [660, 0]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "{ \"ok\": true }",
        "options": {}
      },
      "id": "a1b2c3d4-0005-4000-8000-000000000005",
      "name": "Respond OK",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [880, -110]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ { \"ok\": false, \"error\": $json.error } }}",
        "options": { "responseCode": 500 }
      },
      "id": "a1b2c3d4-0006-4000-8000-000000000006",
      "name": "Respond Error",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [880, 110]
    }
  ],
  "connections": {
    "Webhook": {
      "main": [[{ "node": "Lookup User by Email", "type": "main", "index": 0 }]]
    },
    "Lookup User by Email": {
      "main": [[{ "node": "Send DM", "type": "main", "index": 0 }]]
    },
    "Send DM": {
      "main": [[{ "node": "Slack OK?", "type": "main", "index": 0 }]]
    },
    "Slack OK?": {
      "main": [
        [{ "node": "Respond OK", "type": "main", "index": 0 }],
        [{ "node": "Respond Error", "type": "main", "index": 0 }]
      ]
    }
  },
  "pinData": {},
  "settings": { "executionOrder": "v1" }
}
```

### Node reference (if you'd rather build or fix by hand)

| Node | What matters |
|---|---|
| **Webhook** | POST, path `csm-tam-alerts`, Respond = *Using 'Respond to Webhook' node* |
| **Lookup User by Email** | GET `https://slack.com/api/users.lookupByEmail`, query `email` = `{{ $json.body.email }}`, Authorization header |
| **Send DM** | POST `https://slack.com/api/chat.postMessage`, JSON body: `channel` = `{{ $json.user.id }}`, `text` = `{{ $('Webhook').item.json.body.text.replace('{SLACK_MENTION}', '<@' + $json.user.id + '>') }}` — reference the webhook by its EXACT canvas node name (plain `$json` here is the lookup output); the `.replace` turns the backend's `{SLACK_MENTION}` token into a real @-mention |
| **Slack OK?** (IF) | `{{ $json.ok }}` is true. Catches `users_not_found` too: a failed lookup leaves `user.id` empty so the send fails with `channel_not_found` → false branch |
| **Respond OK** | 200, `{ "ok": true }` |
| **Respond Error** | **500**, `{ ok: false, error: $json.error }` — backend logs it in `sendFailures`, writes no sent-marker, retries next run |

### Bot scopes

| Scope | Why |
|---|---|
| `users:read.email` | `users.lookupByEmail` |
| `users:read` | required companion of `users:read.email` |
| `chat:write` | send the DM |
| `im:write` | open the DM conversation with the user |

After adding scopes, **reinstall the app** to the workspace.

## 3. Testing (nothing sends without you triggering it)

**Pipe test (n8n only, no backend)** — with the Webhook node in *Listen for test event*, POST a sample to the **test** URL; the DM should hit your Slack in ~1s:

```bash
curl -X POST '<n8n TEST webhook URL>' \
  -H 'Content-Type: application/json' \
  -d '{"kind":"csm_tam_stale_dm","email":"rohan.jadhav@clevertap.com","name":"Rohan","text":"*Test* — CSM/TAM DM pipe works ✅"}'
```

**Full-path tests** — the 11 AM cron only fires the real run. To test, hit the admin endpoint yourself:

```bash
# 1. Dry run — renders every message, sends NOTHING, returns them as JSON
curl -X POST $API/api/admin/csm-tam-alerts \
  -H "Authorization: Bearer <admin jwt>" -H "Content-Type: application/json" \
  -d '{"dryRun": true}'

# 2. Reroute — every DM goes to YOU instead of the real CSM/TAM
curl -X POST $API/api/admin/csm-tam-alerts \
  -H "Authorization: Bearer <admin jwt>" -H "Content-Type: application/json" \
  -d '{"testEmail": "rohan.jadhav@clevertap.com"}'

# 3. One recipient only — `only` matches by email OR display name and
#    composes with dryRun/testEmail (preview one TAM's DM in your own DMs):
curl -X POST $API/api/admin/csm-tam-alerts \
  -H "Authorization: Bearer <admin jwt>" -H "Content-Type: application/json" \
  -d '{"only": "Avinash Kalani", "testEmail": "rohan.jadhav@clevertap.com"}'

# 4. Real send to just that one person (drop testEmail):
curl -X POST $API/api/admin/csm-tam-alerts \
  -H "Authorization: Bearer <admin jwt>" -H "Content-Type: application/json" \
  -d '{"only": "avinash@clevertap.com"}'

# 5. Real run for everyone (per-day dedup applies — safe alongside the cron)
curl -X POST $API/api/admin/csm-tam-alerts \
  -H "Authorization: Bearer <admin jwt>" -H "Content-Type: application/json" -d '{}'
```

The response reports `staleTickets`, `recipients`, `sent`, `alreadySentToday`, `ticketsWithoutCsmEmail`, and `unresolvedTams` (TAM names the dev-user directory couldn't map — worth eyeballing after the first run).

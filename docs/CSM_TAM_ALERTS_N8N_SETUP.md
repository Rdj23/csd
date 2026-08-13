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

- `text` is fully formatted by the backend (bold, `<url|TKT-xxx>` links). n8n is a dumb pipe.
- `email` is the ONLY routing field — look the user up by it and DM them. Never post to a channel.
- Respond `200` on success (any body). **Respond non-2xx if the email isn't found in the workspace** — the backend then logs the failure and, because no sent-marker is written, retries that person on the next run instead of silently losing them.

Idempotency lives in the backend: a Redis marker per recipient per IST day (`csmtam:sent:<yyyy-mm-dd>:<email>`, 48 h TTL) means a retried job never double-DMs. n8n needs no dedup logic.

## 2. n8n workflow (4 nodes)

**Webhook → HTTP Request (lookupByEmail) → Slack (send DM) → Respond to Webhook**

1. **Webhook**
   - Method: `POST`, Path: `csm-tam-alerts`
   - Respond: **Using 'Respond to Webhook' node**
   - The production URL of this node goes into `CSM_TAM_N8N_WEBHOOK_URL`.

2. **HTTP Request** — [users.lookupByEmail](https://docs.slack.dev/reference/methods/users.lookupByEmail)
   - Method: `GET`, URL: `https://slack.com/api/users.lookupByEmail`
   - Query parameter: `email` = `={{ $json.body.email }}`
   - Auth: the Slack bot token (Header `Authorization: Bearer xoxb-…`). Reusing the attention bot is fine — just add the scope below.
   - The response is `{ "ok": true, "user": { "id": "U0…" } }`. If `ok` is false (`users_not_found`), fail the workflow so the Respond node (or n8n's error path) returns non-2xx.

3. **Slack** (same bot credential)
   - Resource: Message · Operation: Send
   - Send to: **User** (or Channel in expression mode) = `={{ $node["HTTP Request"].json.user.id }}`
     — posting to a user ID opens/reuses the DM automatically.
   - Text: `={{ $json.body.text }}`, mrkdwn enabled (default).

4. **Respond to Webhook**
   - Respond with: JSON, body `={{ { "ok": true } }}`

### Bot scopes

| Scope | Why |
|---|---|
| `users:read.email` | `users.lookupByEmail` |
| `users:read` | required companion of `users:read.email` |
| `chat:write` | send the DM |
| `im:write` | open the DM conversation with the user |

After adding scopes, **reinstall the app** to the workspace.

## 3. Testing (nothing sends without you triggering it)

The 11 AM cron only fires the real run. To test, hit the admin endpoint yourself:

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

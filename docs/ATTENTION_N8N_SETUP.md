# Attention Queue → Slack via n8n

*Last updated: 10 Aug 2026 — TEAM-CHANNEL routing*

All Attention Queue Slack alerts are sent through **one n8n webhook**. n8n posts them with a real Slack **bot** (`chat.postMessage`), which is what enables **threading** — the next-day "no action" alert replies under the shift-end summary. Incoming webhooks can't do that, so the plain `ATTENTION_SLACK_WEBHOOK_URL` is only a fallback (posts fine, but to its own fixed channel, no threads).

**Since 10 Aug 2026 alerts go to each member's TEAM channel**, not one shared channel. The team → channel mapping lives in the backend, on the `TEAMS` array in `backend/config/constants.js` (`slackChannel` per team) — the same array you edit for every roster change, so team reshuffles stay a one-file edit. The backend resolves the channel and sends it in the payload; the n8n Slack node just posts to whatever `channel` says. Members without a team (TEAMLESS_MEMBERS) or whose team has `slackChannel: ""` get **no Slack alerts at all** — queues still build for the dashboard, posts are skipped with a log.

---

## 1. Backend → n8n contract

The backend POSTs JSON to `ATTENTION_N8N_WEBHOOK_URL` (set it in the root `.env`):

```json
{
  "kind": "shift_end_summary | no_action_followup | queue_cleared",
  "text": "<ready-to-post Slack mrkdwn>",
  "channel": "<team channel — ID (C0…) or #name, from TEAMS[].slackChannel>",
  "thread_ts": "1754392500.123456 or null"
}
```

- `text` is fully formatted by the backend (bold, `<url|TKT-xxx>` links). n8n is a dumb pipe — just forward it.
- `channel` is always present (the backend never sends an alert without one). Post to exactly this channel. The bot must be `/invite`'d to **every** team channel.
- `thread_ts` is set **only** on `no_action_followup` — post that message as a **reply in the thread** with this ts. When `null`, post to the channel normally. Thread replies land in the right team channel automatically: the ts being replied to came from that same team's summary.
- The response must return the posted message's ts:

```json
{ "ts": "1754392500.123456" }
```

The backend stores that ts (`slack_thread_ts` on the queue) and passes it back the next day as `thread_ts`. **If the response has no `ts`, nothing breaks** — the follow-up just posts to the channel instead of the thread.

| kind | When | thread_ts |
|---|---|---|
| `shift_end_summary` | ~15 min before shift end — one batched message **per shift per team**, one line per member (counts only) | never (this message *starts* the thread — its `ts` must come back in the response) |
| `no_action_followup` | Next trigger (8:45 AM for shift 1, …), one-shot — bare ticket links stage-wise | set → reply in thread |
| `queue_cleared` | Whenever a member's queue verifies clear | never (channel post) |

## 2. n8n workflow (3 nodes)

**Webhook → Slack → Respond to Webhook**

1. **Webhook**
   - Method: `POST`, Path: `attention-alerts`
   - Respond: **Using 'Respond to Webhook' node**
   - The production URL of this node is what goes into `ATTENTION_N8N_WEBHOOK_URL`.

2. **Slack** (credential: a Slack **bot token** app with `chat:write`; `/invite` the bot to **every team channel**)
   - Resource: Message · Operation: Send
   - Channel: switch the field to **expression mode** → `={{ $json.body.channel }}` (mode "By ID" if you put channel IDs in `TEAMS[].slackChannel` — recommended, rename-proof — or "By Name" if you used `#name`s)
   - Text: `={{ $json.body.text }}`
   - Options → **Reply to a message / Thread TS**: `={{ $json.body.thread_ts }}` (empty/null = normal post)
   - Keep mrkdwn enabled (default) so bold + ticket links render.
   - No Switch node needed — routing is data-driven off the payload, so team changes never touch n8n again.

3. **Respond to Webhook**
   - Respond with: JSON
   - Body: `={{ { "ts": $json.ts || $json.message_timestamp || "" } }}`
     (the Slack node returns the posted message — `ts` is the field we need)

Importable skeleton (adjust credential + channel after import):

```json
{
  "name": "Attention Queue Slack Alerts",
  "nodes": [
    {
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [0, 0],
      "parameters": {
        "httpMethod": "POST",
        "path": "attention-alerts",
        "responseMode": "responseNode"
      }
    },
    {
      "name": "Slack",
      "type": "n8n-nodes-base.slack",
      "typeVersion": 2.2,
      "position": [220, 0],
      "parameters": {
        "resource": "message",
        "operation": "post",
        "select": "channel",
        "channelId": { "__rl": true, "mode": "id", "value": "={{ $json.body.channel }}" },
        "text": "={{ $json.body.text }}",
        "otherOptions": {
          "thread_ts": { "replyValues": { "thread_ts": "={{ $json.body.thread_ts }}" } }
        }
      }
    },
    {
      "name": "Respond to Webhook",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [440, 0],
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ { \"ts\": $json.ts || $json.message_timestamp || \"\" } }}"
      }
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Slack", "type": "main", "index": 0 }]] },
    "Slack": { "main": [[{ "node": "Respond to Webhook", "type": "main", "index": 0 }]] }
  }
}
```

> n8n's Slack node fields shift between versions — if the thread option import doesn't stick, set **Options → Reply to a message → Message Timestamp to Reply To** manually to `={{ $json.body.thread_ts }}`.

## 3. Testing end-to-end

1. Fill in `slackChannel` for each team in `backend/config/constants.js` (to test safely first, point every team at one test channel), activate the workflow, put its production webhook URL in the root `.env` as `ATTENTION_N8N_WEBHOOK_URL`, redeploy/restart the backend.
2. Preview one team's summary without touching Mongo:
   `node scripts/testAttentionSweep.js --member <Name> --post`
   → posts to that member's team channel (or tells you the member has no channel).
3. Or fire a real build for one member (uses Rohan's JWT):
   `POST /api/attention/run` with `{ "force": true, "member": "<Name>" }`
   → the batched summary should land in that member's team channel within the same sweep, and the queue doc should have `slack_thread_ts` set.
4. To preview a thread reply without waiting a day, POST to the n8n webhook directly with `kind: "no_action_followup"`, the team `channel`, and the `thread_ts` from step 3's message.
5. When happy: swap the test channel for the real per-team channels in `constants.js`, redeploy. n8n needs no further edits.

## 4. Failure behavior (backend side)

- n8n unreachable → error logged, backend falls back to `ATTENTION_SLACK_WEBHOOK_URL` (message still goes out, no threading).
- Summary post fails entirely → `shift_alert_sent_at` stays unset, the next 15-min sweep retries (up to a 2-hour late tolerance, then it skips with a log instead of pinging mid-night).
- No-action post fails → the hourly escalation slot isn't consumed; it retries on the next sweep.

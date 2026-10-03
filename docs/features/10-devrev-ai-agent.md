# DevRev AI Agent

## What It Does (User Perspective)

The **AI Agent** feature lets users ask natural-language questions about their ticket data. A Sparkles button in the header opens a chat modal where you can type questions like:

- "How many open tickets do we have?"
- "Show high priority tickets"
- "Which accounts have most tickets?"

### Chat Interface

- **Suggested Prompts**: Shown when the chat is empty (3 starter questions)
- **Message Display**: User messages on the right (indigo), Agent responses on the left (slate)
- **Loading State**: Spinner with animated status messages
- **Stop Button**: Cancel the current query
- **Session Continuity**: Follow-up questions use the same session for context

### Response Rendering

The agent's response is parsed and rendered with:
- **Markdown links**: `[text](url)` → clickable links
- **Bold text**: `**text**` → `<strong>`
- **DevRev DON URIs**: Converted to human-readable TKT- links
- **Tables**: Pipe-delimited tables → rendered HTML tables

### Polling Architecture

The agent uses an **async poll pattern** (not WebSocket streaming):

```
1. User sends query → POST /api/agent/query → returns sessionId
2. Frontend polls GET /api/agent/poll/{sessionId} every 2 seconds
3. Max 60 polls (2 minutes total timeout)
4. Up to 3 retries on failure
5. Response displayed when status = "done"
```

---

## How It Maps to the Backend

### API Endpoints

| Method | Endpoint                     | Handler                      | Purpose                    |
| ------ | ---------------------------- | ---------------------------- | -------------------------- |
| `POST` | `/api/agent/query`           | `agentController.queryAgent()` | Submit question, get sessionId |
| `GET`  | `/api/agent/poll/:sessionId` | `agentController.pollAgent()` | Poll for async response     |

### Backend Flow

```
POST /api/agent/query { query: "How many open tickets?" }
    ↓
agentService.sendAgentQuery(query, sessionObject)
    ↓
1. Generate session key: "dash_" + UUID
2. Store pending entry in memory map: { status: "pending", aliasOf: null }
3. Call DevRev API: POST internal/ai-agents.events.execute-async
   - Headers: Authorization: Bearer DEVREV_PAT
   - Body: { don: DEVREV_AGENT_DON, query, session_object }
   - Retry: 3 attempts, exponential backoff (2s, 4s, 8s)
   - Timeout: 15s per attempt
4. Store alias mapping: DevRev's session_id → our poll key
5. Return pollKey to frontend
    ↓
DevRev processes query asynchronously
    ↓
DevRev sends response via webhook: POST /api/webhooks/devrev-agent
    ↓
webhookController → agentService.storeAgentResponse(webhookSessionId, type, text)
    ↓
Maps webhook session to our pollKey (via aliasOf)
Stores: { status: "done", type, text, receivedAt }
    ↓
Frontend polls GET /api/agent/poll/{pollKey}
    ↓
Returns: { status: "done", type: "ai_response", text: "You have 47 open tickets..." }
```

### In-Memory Storage

Agent responses are stored in a **plain JavaScript Map** (not Redis or MongoDB):

```javascript
const sessions = new Map();
// Key: sessionId, Value: { status, type, text, receivedAt, aliasOf }
```

**Why in-memory?**
- Agent sessions are short-lived (< 2 minutes)
- No need for persistence across restarts
- Fastest possible read/write for polling

### Auto-Cleanup

Every 15 minutes, stale entries (> 15 minutes old) are removed:

```javascript
setInterval(() => {
  for (const [key, val] of sessions) {
    if (Date.now() - val.receivedAt > 15 * 60 * 1000) sessions.delete(key);
  }
}, 15 * 60 * 1000);
```

### Session Aliasing

The DevRev API returns its own `session_id` which differs from our generated `pollKey`. The alias system bridges them:

```
Our pollKey: "dash_abc123"
DevRev's session_id: "devrev_xyz789"

On query: sessions.set("dash_abc123", { aliasOf: null, status: "pending" })
On DevRev response: Map "devrev_xyz789" → "dash_abc123" via aliasOf
Frontend polls: GET /api/agent/poll/dash_abc123 → finds the response
```

---

## Reference Files

| File | Purpose |
| ---- | ------- |
| `src/features/agent/components/AgentModal.jsx` | Chat UI, polling logic, response rendering |
| `src/api/agentApi.js` | API client (`sendAgentQuery()`, `pollAgentResponse()`) |
| `backend/controllers/agentController.js` | `queryAgent()`, `pollAgent()` (37 lines) |
| `backend/services/agentService.js` | Core logic: session map, retry, alias resolution |
| `backend/routes/agent.js` | Route definitions |
| `backend/controllers/webhookController.js` | DevRev agent webhook handler |

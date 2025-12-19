# Agent Chatbot - How We Built It (Explained Simply)

> A beginner-friendly guide to understanding how the AI Agent chatbot works on the homescreen of the Support Dashboard.

---

## Table of Contents

1. [The Big Picture - What Are We Even Building?](#1-the-big-picture)
2. [The Thought Process - Why Did We Build It This Way?](#2-the-thought-process)
3. [How We Access DevRev's AI Agent](#3-how-we-access-devrevs-ai-agent)
4. [All The Files We Created & What Each One Does](#4-all-the-files)
5. [Step-by-Step: What Happens When You Ask a Question](#5-step-by-step-flow)
6. [The Frontend - AgentModal Component](#6-the-frontend)
7. [The API Client - Bridge Between Frontend & Backend](#7-the-api-client)
8. [The Backend - Routes, Controller, Service](#8-the-backend)
9. [The Webhook - How DevRev Sends Answers Back](#9-the-webhook)
10. [Retry Logic & Error Handling](#10-retry-logic)
11. [Markdown Parsing - Making Responses Look Good](#11-markdown-parsing)
12. [Key Design Decisions](#12-key-design-decisions)

---

## 1. The Big Picture

### What is this?

We built an **AI chatbot** that sits on the homescreen of our Support Dashboard. Admin users can ask questions in plain English like:

- "How many open tickets do we have?"
- "Show high priority tickets"
- "Which accounts have the most tickets?"

And the AI (powered by **DevRev's AI Agent**) answers them using real data from our ticket system.

### The Restaurant Analogy

Think of this whole system like ordering food at a restaurant:

```
YOU (customer)
  |
  | "I'd like the pasta please" (your question)
  v
WAITER (frontend AgentModal)
  |
  | writes down your order, takes it to kitchen
  v
KITCHEN MANAGER (our backend server)
  |
  | passes order to the chef
  v
CHEF (DevRev's AI Agent)
  |
  | ... cooks for a while ...
  |
  | rings the bell when done (webhook)
  v
KITCHEN MANAGER picks up the dish
  |
  v
WAITER keeps checking: "is it ready?" (polling)
  |
  | yes! picks it up
  v
YOU get your food (see the answer on screen)
```

The key thing to understand: **the chef (DevRev AI) doesn't bring the food directly to your table**. The chef rings a bell (webhook), the kitchen manager puts it on the counter (in-memory store), and the waiter keeps checking the counter every 2 seconds (polling) until the food appears.

---

## 2. The Thought Process

### Problem We Were Solving

Our support team manages hundreds of tickets in DevRev. To answer simple questions like "how many urgent tickets are open?", someone would have to:
1. Open DevRev
2. Set up filters manually
3. Count or export results
4. Do this every single time

We wanted: **just ask in English, get an answer instantly**.

### Why Not Build Our Own AI?

DevRev already has a built-in AI Agent that understands all our ticket data. Building our own AI would mean:
- Training a model on our data (expensive, complex)
- Keeping it in sync with DevRev (nightmare)
- Maintaining it (ongoing cost)

Instead, we just **talk to DevRev's AI** via their API. It already knows everything about our tickets.

### Why Is It Async (Not Instant)?

DevRev's AI Agent works **asynchronously**. Here's why:

When you ask "how many open tickets do we have?", the AI needs to:
1. Understand your question (NLP processing)
2. Query the ticket database
3. Aggregate the results
4. Generate a human-readable answer

This can take 5-30 seconds. DevRev doesn't make you hold the phone line open for 30 seconds. Instead they say: **"Got your question, we'll call you back when the answer is ready"** (via a webhook).

### Why Polling Instead of WebSockets?

We had two choices for checking if the answer is ready:

| Approach | How It Works | Complexity |
|----------|-------------|------------|
| **WebSockets** | Keep a permanent open connection. Server pushes answer the instant it arrives. | Complex - need socket server, handle reconnections, etc. |
| **Polling** | Frontend asks "ready yet?" every 2 seconds | Simple - just regular HTTP requests |

We chose **polling** because:
- The chatbot is used by a few admins, not thousands of users
- Asking every 2 seconds is perfectly fine for this use case
- Much simpler to build, debug, and deploy
- No extra infrastructure needed (no socket server)

### Why In-Memory Storage Instead of a Database?

Agent responses are **temporary** - you ask a question, get an answer, done. They don't need to be saved forever. So we use a simple JavaScript `Map` (think of it as a dictionary) that:
- Stores responses for 10 minutes max
- Auto-cleans itself every 15 minutes
- Lives entirely in server memory (super fast reads)
- No database queries needed for polling (which happens every 2 seconds!)

---

## 3. How We Access DevRev's AI Agent

### What is DevRev's AI Agent?

DevRev has an AI feature called "AI Agents" that can answer questions about your workspace data (tickets, customers, etc.). It's like having a smart assistant that has read every single ticket you've ever created.

### What We Need to Talk to It

Three things:

```
1. AGENT_DON    = "don:core:dvrv-us-1:devo/1iVu4ClfVV:ai_agent/4"
   ^ This is the ID of our specific AI agent in DevRev
   ^ "DON" = DevRev Object Notation (their way of identifying things)

2. WEBHOOK_DON  = "don:integration:dvrv-us-1:devo/1iVu4ClfVV:webhook/Hce4XNX0"
   ^ This is the ID of our webhook endpoint registered in DevRev
   ^ It tells DevRev: "send the AI's answer to THIS URL"

3. DEVREV_PAT   = (personal access token)
   ^ Our authentication key to prove we're allowed to use the API
   ^ Like a password that lets our server talk to DevRev
```

### The API Endpoint We Call

```
POST https://api.devrev.ai/internal/ai-agents.events.execute-async
```

The word **"async"** in the URL is important - it means:
- "I'm sending you a question"
- "Don't wait for the answer"
- "Send the answer to my webhook URL when ready"

### The Payload We Send

```json
{
  "agent": "don:core:...:ai_agent/4",     // WHICH agent to use
  "event": {
    "input_message": {
      "message": "How many open tickets?"  // THE question
    }
  },
  "session_object": "dash_abc123...",      // TRACKING ID (like an order number)
  "webhook_target": {
    "webhook": "don:integration:...:webhook/Hce4XNX0"  // WHERE to send the answer
  }
}
```

### The Webhook Response We Receive

When DevRev's AI finishes thinking, it sends a POST request to our server:

```json
{
  "ai_agent_response": {
    "agent_response": "message",                    // "message" = success, "error" = failed
    "message": "You currently have 42 open tickets...", // THE answer
    "session_object": "dash_abc123..."              // TRACKING ID (matches our original question)
  }
}
```

The `session_object` is how we match the answer back to the original question. Without it, if two people ask questions at the same time, we'd have no idea which answer belongs to whom.

---

## 4. All The Files

Here's every file involved and what it does:

### Frontend (React)

```
src/
  App.jsx                              -- Where the search bar + keyboard shortcut live
  api/
    agentApi.js                        -- Two functions: sendQuery + pollResponse
  features/
    agent/
      components/
        AgentModal.jsx                 -- The chat modal UI (the main component)
```

### Backend (Node.js/Express)

```
backend/
  routes/
    agent.js                           -- Defines URL paths: POST /query, GET /poll
    webhooks.js                        -- Defines webhook URL for DevRev callbacks
  controllers/
    agentController.js                 -- Handles HTTP requests, validates input
    webhookController.js               -- Receives DevRev's AI responses
  services/
    agentService.js                    -- The BRAIN: sends to DevRev, stores responses
  validations/
    webhookSchemas.js                  -- Validates webhook payload structure
```

### Environment Variables

```
.env
  DEVREV_AGENT_DON=...                 -- Agent ID
  DEVREV_AGENT_WEBHOOK_DON=...         -- Webhook ID
  DEVREV_AGENT_WEBHOOK_SECRET=...      -- Webhook security secret
```

---

## 5. Step-by-Step Flow

Here's EXACTLY what happens when you type "How many open tickets?" and press Enter:

```
STEP 1: USER TYPES AND HITS ENTER
=========================================
File: AgentModal.jsx → handleSend()

- User's message immediately appears in the chat (instant feedback)
- Input field is cleared
- Loading spinner shows "Thinking..."
- cancelledRef is reset (in case user stopped a previous query)


STEP 2: FRONTEND CALLS BACKEND
=========================================
File: agentApi.js → sendAgentQuery()

- POST request to our backend: /api/agent/query
- Body: { query: "How many open tickets?", sessionObject: null }
  (sessionObject is null for the FIRST question, then set for follow-ups)


STEP 3: BACKEND RECEIVES THE REQUEST
=========================================
File: agentController.js → queryAgent()

- Validates: is query a non-empty string? If not, return 400 error.
- Passes to the service layer.


STEP 4: BACKEND CALLS DEVREV
=========================================
File: agentService.js → sendAgentQuery()

- Generates a unique ID: "dash_550e8400-e29b-41d4-..."
- IMMEDIATELY stores in Map: { "dash_550e8400...": { status: "pending" } }
  (This is done BEFORE calling DevRev to prevent race conditions!)
- Sends POST to DevRev's async API with:
  - The question
  - Our agent ID
  - Our webhook URL
  - The tracking ID (session_object)
- If DevRev returns its own session ID (different from ours),
  creates an ALIAS mapping DevRev's ID → our ID
- Returns our tracking ID to the frontend


STEP 5: FRONTEND STARTS POLLING
=========================================
File: AgentModal.jsx → executeQueryAndPoll()

- Sets up an interval: every 2 seconds, call GET /api/agent/poll/{sessionId}
- Backend checks the Map and returns { status: "pending" }
- After 30 seconds (15 polls): loading text changes to "Still working..."
- After 60 seconds (30 polls): "Taking a bit longer than usual..."
- After 90 seconds (45 polls): "Almost there..."
- After 120 seconds (60 polls): gives up


STEP 6: DEVREV AI THINKS (we wait)
=========================================
(Happening on DevRev's servers - not our code)

- DevRev's AI reads ticket data from the database
- Processes the question using NLP/LLM
- Generates a natural language answer


STEP 7: DEVREV SENDS ANSWER VIA WEBHOOK
=========================================
File: webhookController.js → handleDevRevWebhook()

- DevRev sends POST to our webhook URL: /api/webhooks/devrev-agent
- Payload: { ai_agent_response: { agent_response: "message", message: "...", session_object: "dash_550e8400..." } }
- Controller extracts the answer text and session_object
- Calls storeAgentResponse() which updates our Map:
  { "dash_550e8400...": { status: "done", text: "You have 42 open tickets..." } }


STEP 8: NEXT POLL PICKS UP THE ANSWER
=========================================
File: AgentModal.jsx (inside the polling interval)

- Frontend polls: GET /api/agent/poll/dash_550e8400...
- Backend checks Map → finds { status: "done", text: "..." }
- Returns the answer to frontend
- Frontend stops polling (clearInterval)


STEP 9: ANSWER IS RENDERED
=========================================
File: AgentModal.jsx

- Answer added to messages array: { role: "agent", text: "You have 42 open tickets..." }
- formatAgentText() parses markdown: bold, links, tables, DevRev DON URIs
- Chat bubble appears with the formatted response
- Loading spinner disappears
- Input field is re-focused for the next question
```

---

## 6. The Frontend - AgentModal Component

**File: `src/features/agent/components/AgentModal.jsx`**

### How the Modal Opens

There are TWO ways to open the chatbot:

**Way 1: Click the search bar** (App.jsx line 1416)
```jsx
<button onClick={() => setShowAgentModal(true)}>
  <Sparkles /> Ask AI about your tickets, customers, data...  ⌘K
</button>
```

**Way 2: Keyboard shortcut Cmd+K / Ctrl+K** (App.jsx line 1292-1304)
```jsx
useEffect(() => {
  if (!isAuthenticated) return;  // only needs login, accessible to everyone

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();  // stop browser's default Cmd+K action
      setShowAgentModal((prev) => !prev);  // toggle open/close
    }
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [isAuthenticated]);
```

The chatbot is **accessible to all authenticated users** - anyone who is logged in can see the search bar and use the keyboard shortcut.

### The State Variables

```jsx
const [messages, setMessages] = useState([]);          // Chat history: [{role, text, type}]
const [input, setInput] = useState("");                // What user is currently typing
const [loading, setLoading] = useState(false);         // Is the AI thinking right now?
const [sessionObject, setSessionObject] = useState(null); // Session ID for multi-turn conversations
const [loadingStatus, setLoadingStatus] = useState("Thinking..."); // Dynamic loading text
```

**Multi-turn explained**: When you ask a first question, `sessionObject` is `null`. After DevRev responds, it gets set to a session ID like `"dash_abc123"`. When you ask a SECOND question, this ID is sent along. DevRev sees: "Oh, this is a follow-up to the same conversation" and can reference previous context. This is how the AI "remembers" what you talked about before.

### The Suggestion Buttons

When the chat is empty, we show clickable suggestions:
```jsx
const SUGGESTIONS = [
  "How many open tickets do we have?",
  "Show high priority tickets",
  "Which accounts have most tickets?",
];
```
Clicking one calls `handleSend(suggestion)` with that text directly - same as typing it and pressing Enter.

### The Stop Button

While the AI is thinking, the Send button transforms into a Stop button:
```jsx
const handleStop = () => {
  cancelledRef.current = true;       // Set a "cancelled" flag
  clearInterval(pollTimerRef.current); // Stop the polling loop
  setLoading(false);                 // Hide loading spinner
};
```

We use a **ref** (`cancelledRef`) instead of state because refs update synchronously. Inside the polling interval callback, regular state might still hold the old value due to JavaScript closures. Refs always give you the latest value.

### Closing the Modal

Three ways to close:
1. Click the X button
2. Press Escape key
3. Click outside the modal (on the dark backdrop)

```jsx
// Escape key
useEffect(() => {
  const handleKey = (e) => { if (e.key === "Escape" && open) onClose(); };
  window.addEventListener("keydown", handleKey);
  return () => window.removeEventListener("keydown", handleKey);
}, [open, onClose]);

// Backdrop click
<div ref={backdropRef} onClick={(e) => e.target === backdropRef.current && onClose()}>
```

The backdrop click check (`e.target === backdropRef.current`) ensures clicking INSIDE the modal doesn't close it - only clicking the dark background does.

---

## 7. The API Client

**File: `src/api/agentApi.js`**

This file is the simplest in the whole feature. It has just two functions:

```js
// Function 1: Send a question to the AI
export const sendAgentQuery = async (query, sessionObject) => {
  const res = await authAxios.post(`${API_URL}/api/agent/query`, { query, sessionObject });
  return res.data;  // { sessionId: "dash_abc123..." }
};

// Function 2: Check if the answer is ready yet
export const pollAgentResponse = async (sessionId) => {
  const res = await authAxios.get(`${API_URL}/api/agent/poll/${sessionId}`);
  return res.data;  // { status: "pending" } or { status: "done", text: "..." }
};
```

`authAxios` is a pre-configured Axios instance that automatically adds the user's authentication token to every request. This means the backend knows WHO is asking.

---

## 8. The Backend

### 8a. Routes

**File: `backend/routes/agent.js`**

```js
router.post("/agent/query", queryAgent);        // Receive a question
router.get("/agent/poll/:sessionId", pollAgent); // Check if answer is ready
```

Just two routes. Dead simple.

### 8b. Controller

**File: `backend/controllers/agentController.js`**

The controller's job is to handle HTTP concerns: validate input, call the service, return a response.

```js
// POST /api/agent/query
export const queryAgent = async (req, res) => {
  const { query } = req.body;

  // Validate: must be a non-empty string
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return res.status(400).json({ success: false, error: "query is required" });
  }

  const { sessionObject } = req.body;  // Optional: for follow-up questions
  const sessionId = await sendAgentQuery(query.trim(), sessionObject);
  res.json({ success: true, sessionId });
};

// GET /api/agent/poll/:sessionId
export const pollAgent = (req, res) => {
  const result = pollAgentResponse(req.params.sessionId);
  res.json({ success: true, ...result });
};
```

Notice `pollAgent` is NOT async - it just reads from memory. No waiting needed.

### 8c. Service (The Brain)

**File: `backend/services/agentService.js`**

This is the most important file. It does three things:

#### Thing 1: Send question to DevRev

```js
export async function sendAgentQuery(query, sessionObject) {
  // Generate a unique tracking ID (or reuse existing one for multi-turn)
  const clientSessionId = sessionObject || `dash_${crypto.randomUUID()}`;

  // Build the payload for DevRev's API
  const payload = {
    agent: AGENT_DON,
    event: { input_message: { message: query } },
    session_object: clientSessionId,
    webhook_target: { webhook: WEBHOOK_DON },
  };

  // IMPORTANT: Register as "pending" BEFORE calling the API
  // Why? If DevRev responds via webhook super fast (before this function returns),
  // the webhook handler needs to find this entry. If we registered after the API call,
  // there's a tiny window where the webhook could arrive and find nothing.
  pendingResponses.set(clientSessionId, { status: "pending", createdAt: Date.now() });

  const res = await callWithRetry(payload);

  // DevRev might return its own session ID (different from ours)
  // Create an alias so the webhook can find our entry either way
  const devrevSessionId = res.data?.session?.id;
  if (devrevSessionId && devrevSessionId !== clientSessionId) {
    pendingResponses.set(devrevSessionId, { aliasOf: clientSessionId });
  }

  return clientSessionId;
}
```

#### Thing 2: Store webhook response

```js
export function storeAgentResponse(webhookSessionId, type, text) {
  const responseData = { status: "done", type, text, receivedAt: Date.now() };

  // Check if this is DevRev's own ID (an alias pointing to our real ID)
  const existing = pendingResponses.get(webhookSessionId);
  if (existing?.aliasOf) {
    pendingResponses.set(existing.aliasOf, responseData);  // Store on OUR ID
    pendingResponses.delete(webhookSessionId);             // Clean up the alias
  } else {
    pendingResponses.set(webhookSessionId, responseData);  // Store directly
  }

  // Auto-delete after 10 minutes to prevent memory leaks
  setTimeout(() => pendingResponses.delete(webhookSessionId), 10 * 60 * 1000);
}
```

#### Thing 3: Check if response is ready (polling handler)

```js
export function pollAgentResponse(sessionId) {
  const entry = pendingResponses.get(sessionId);
  if (!entry) return { status: "not_found" };           // No such question
  if (entry.aliasOf) return { status: "pending" };      // This is an alias, answer not here
  return entry;  // Either { status: "pending" } or { status: "done", text: "..." }
}
```

### The Alias Pattern Explained Visually

```
Step 1: We send question with ID "dash_abc123"
  Map: { "dash_abc123": { status: "pending" } }

Step 2: DevRev returns its own session ID "don:session:xyz789"
  Map: { "dash_abc123": { status: "pending" },
         "don:session:xyz789": { aliasOf: "dash_abc123" } }

Step 3: DevRev webhook arrives with session_object = "don:session:xyz789"
  → storeAgentResponse looks up "don:session:xyz789"
  → Finds aliasOf: "dash_abc123"
  → Stores response on "dash_abc123" instead
  Map: { "dash_abc123": { status: "done", text: "You have 42 tickets..." } }

Step 4: Frontend polls with "dash_abc123"
  → Finds { status: "done", text: "..." }
  → Returns the answer!
```

Why do we need this? Because we give DevRev an ID, but DevRev might use a DIFFERENT ID when sending the answer back via webhook. The alias bridges the gap.

---

## 9. The Webhook

**File: `backend/controllers/webhookController.js` (lines 117-153)**

When DevRev's AI finishes processing our question, it sends a POST request to our webhook URL. Here's how we handle it:

```js
// Extract the agent response from the webhook payload
// DevRev sends it in different formats, so we check both
const ar = event.ai_agent_response || event.payload?.ai_agent_response;

if (ar) {
  if (ar.agent_response === "message" || ar.agent_response === "error") {
    const type = ar.agent_response === "message" ? "message" : "error";
    const text = type === "message"
      ? ar.message                              // Success: the actual answer
      : (ar.error?.error || "Unknown agent error"); // Failure: error details

    // Store the response - the frontend's next poll will pick it up
    storeAgentResponse(ar.session_object, type, text);
  }
}
```

### Webhook Validation

**File: `backend/validations/webhookSchemas.js`**

We validate the webhook payload shape using Zod (a validation library):

```js
ai_agent_response: z.object({
  agent_response: z.string(),     // Must be "message" or "error"
  session_object: z.string(),     // Must have a correlation ID
}).passthrough().optional(),
```

The `.passthrough()` means "allow extra fields we don't check". DevRev sends a lot of metadata we don't need - we just pick out the fields we care about.

---

## 10. Retry Logic & Error Handling

We have retry logic at TWO levels:

### Level 1: Backend retries calling DevRev (agentService.js)

```
Attempt 1: Call DevRev → fails (timeout)
  Wait 2 seconds...
Attempt 2: Call DevRev → fails (500 error)
  Wait 4 seconds...
Attempt 3: Call DevRev → succeeds!
```

- **3 attempts** with **exponential backoff** (2s, 4s, 8s)
- Only retries on: network errors, timeouts, 5xx server errors
- Does NOT retry on: 4xx client errors (bad request = our fault, retrying won't help)

### Level 2: Frontend retries the whole query+poll cycle (AgentModal.jsx)

```
Attempt 1: Send query + poll → times out after 120s
  Wait 1.5 seconds...
Attempt 2: Send query + poll → success!
```

- **3 attempts** with 1.5 second gaps
- Shows "Retrying... (attempt 2/3)" to the user

### Poll Error Handling

During polling, individual poll failures are tolerated:
- Keeps polling even if 1-3 polls fail (network hiccup)
- Gives up after 4 consecutive poll failures
- Gives up after 60 total polls (120 seconds timeout)

---

## 11. Markdown Parsing

The AI's responses come as plain text with markdown formatting. We need to turn that into pretty React elements.

**Parsing Chain:**

```
Raw text from DevRev AI
  │
  ├─ formatAgentText()     -- Splits into lines, detects tables vs regular text
  │    │
  │    ├─ renderTable()    -- Converts markdown tables into HTML <table>
  │    │
  │    └─ parseInline()    -- Handles inline formatting
  │         │
  │         ├─ DevRev DON URIs: <don:core:...:ticket/1234> → clickable "TKT-1234" link
  │         │
  │         └─ parseLinks()
  │              │
  │              ├─ Markdown links: [text](url) → clickable <a> tag
  │              │
  │              └─ parseBold()
  │                   │
  │                   └─ Bold text: **text** → <strong>text</strong>
  │
  v
Pretty React JSX rendered in the chat bubble
```

### Example Transformations

| Raw Text | Rendered As |
|----------|-------------|
| `**42 tickets**` | **42 tickets** (bold) |
| `[Click here](https://...)` | Clickable link |
| `<don:core:...:ticket/1234>` | Clickable "TKT-1234" linking to DevRev |
| Markdown table with `\|` pipes | Proper HTML table with hover effects |

### Table Detection

```js
function isTableSeparator(line) {
  // Matches lines like: | --- | --- | --- |
  return /^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/.test(line.trim());
}
```

When scanning lines, if a line has `|` characters and the NEXT line is a table separator (dashes), we know it's a markdown table. We collect all table lines and render them as an HTML `<table>`.

---

## 12. Key Design Decisions

| Decision | What We Chose | Why |
|----------|--------------|-----|
| **Communication pattern** | Async (webhook + polling) | DevRev's AI takes 5-30s. Can't hold HTTP connection open that long. |
| **Polling vs WebSockets** | Polling every 2s | Way simpler. Only a few admin users. WebSockets = overkill. |
| **Response storage** | In-memory JavaScript Map | Responses are temporary (10 min TTL). No DB = faster reads. |
| **Retry strategy** | Exponential backoff at 2 levels | Resilient to network issues without hammering failing servers. |
| **Session management** | session_object passed on each request | Enables multi-turn conversations. AI remembers context. |
| **Access control** | All authenticated users | Any logged-in user can ask questions about tickets via the AI chatbot. |
| **Markdown parsing** | Custom React parsers | DevRev returns markdown with DevRev-specific DON URIs. No off-the-shelf parser handles DONs. |
| **Error display** | Red-tinted chat bubble with error icon | Errors shown in-context, not as popups. User stays in the conversation flow. |
| **Loading UX** | Dynamic status text that changes over time | Reduces user anxiety during long waits. "Still working..." is better than a frozen spinner. |

---

## Summary

In the simplest terms possible:

1. **We built a chat UI** (AgentModal.jsx) that lets users type questions
2. **Questions go to our backend** (agentController.js) which forwards them to **DevRev's AI** (agentService.js)
3. **DevRev thinks** and sends the answer back to our **webhook** (webhookController.js)
4. **Our frontend checks every 2 seconds** if the answer has arrived (polling)
5. **When it arrives**, we display it with nice formatting (markdown parsing)

The entire feature is built across ~6 files, uses no database for the chat flow, and leverages DevRev's existing AI capabilities instead of building our own. Simple, effective, and maintainable.

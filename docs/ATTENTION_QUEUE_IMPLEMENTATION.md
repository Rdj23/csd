# Attention Queue — Implementation Reference

*A port-it-yourself guide. Written 2 Sep 2026 from the live code in
`backend/services/attention/`.*

This document is the **engineering** companion to
[ATTENTION_QUEUE_GUIDE.md](ATTENTION_QUEUE_GUIDE.md) (the manager/team-facing
description) and [ATTENTION_N8N_SETUP.md](ATTENTION_N8N_SETUP.md) (the Slack
delivery wiring). It has three parts:

1. **[The logic](#1-the-logic)** — what the system decides, and on what evidence.
2. **[The files](#2-the-files)** — every file involved, in dependency order.
3. **[What you need to change](#3-what-you-need-to-change)** — the integration
   checklist for dropping this into another codebase.

---

## 0. What it is, in one paragraph

A ticketing-backlog nudge system that is **shift-aware** and **evidence-based**.
~45 min before an engineer's shift ends, it builds them a queue of tickets that
objectively need action (aging-and-unanswered / follow-up-automation-stalled /
customer-gone-quiet). The queue renders on the dashboard and *stays* there all
day until the next build replaces it. ~15 min before shift end, one batched
Slack summary posts per shift per team. The **only** way to silence a queue is
to actually action the tickets — clearing is re-verified against live ticketing
data, never against a checkbox. An uncleared queue gets exactly **one**
follow-up, threaded under its own summary, ~45 min into the member's next shift.

Three properties are worth copying even if you rewrite everything else:

| Property | Why it matters |
|---|---|
| The rule engine is a **pure function** of `(ticket, now)` | Build and verify call the same function, so the queue and the "still blocked?" check can never disagree. |
| Alerts are **claim-before-send** | A transport that answers "error" may still have delivered. Marking sent *first* makes every alert at-most-once. |
| The roster only decides **timing**, never **membership** | A roster blip must not silently skip a working engineer. Membership comes from a checked-in constant. |

---

## 1. The logic

### 1.1 The three buckets and their rules

A **"response"** always means an **external** message to the customer — an
agent reply *or* an automated follow-up bot post. **Internal notes never count
as a response.** (Verified against live timeline data;
`backend/scripts/verifyResponseTimestamps.js` is the probe that proved it.)

Rules live in [rules.js](../backend/services/attention/rules.js) (the engine)
and [config.js](../backend/services/attention/config.js) (the numbers). A
ticket in any other stage (`New`, `queued`, `Work in Progress`, `Waiting on
CSM`, anything solved) is **out of scope** and returns `null`.

#### 🟠 Open — *"Waiting on Assignee"*

```
flag when:  age ≥ OPEN_MIN_AGE_DAYS (4)
        AND no org-side external reply today (IST calendar day)
        AND no reminder tag present
```

The reminder-tag exemption is deliberate: when the ticketing automation owns a
ticket end-to-end, a human nudge is noise.

#### 🟡 Pending — *"Awaiting Customer Reply"*

This is the subtle one. The follow-up automation nudges silent customers on
**business days only**, so the rule does not ask *"has the customer replied?"* —
it asks **"is the automation off track?"**

| Situation | Threshold | Message |
|---|---|---|
| No reminder tag at all | `PENDING_FIRST_FOLLOWUP_BD (3) + PENDING_GRACE_BD (1)` = 4 business days silent | "automation never fired — nudge manually" |
| First / second reminder tag | last outbound touch > `PENDING_REMINDER_QUIET_BD (3)` business days ago | "next follow-up is overdue — automation may be stuck" |
| Final reminder tag | `PENDING_FINAL_CLOSE_BD (2)` business days, no reply | "close the ticket" |
| Customer replied last, still pending | reply older than `PENDING_CUSTOMER_REPLY_GRACE_MS (1 day)` | "customer is still waiting on us" |

Two rules-about-the-rules, both learned the hard way:

- **Business days, not calendar days.** A reminder sent Friday whose successor
  is due "in 2 days" legitimately arrives Tuesday.
  [`businessDaysSince()`](../backend/services/attention/time.js) walks the IST
  calendar day-by-day from a noon anchor (noon so the loop can never straddle a
  midnight edge) and caps at 30 — precision past a month is pointless.
- **Reminder tags never *hide* a ticket.** Tags are sticky: they survive the
  conversation resuming. So a tag only selects the *threshold and the wording*.
  Worst case a stale tag flags one business day early; it can never mask a
  genuinely silent ticket.

#### 🔵 On Hold — *"Waiting on CleverTap"*

```
flag when:  no org-side external message in ONHOLD_AGENT_SILENCE_DAYS (2) days
```

Pure "our side went quiet" rule. **The linked engineering issue's state is
deliberately irrelevant** — even with engineering actively working it, the
customer must hear from us every two days.

### 1.2 The two-phase pending verdict (and why it exists)

The cheap timestamp field on a ticket (`tnt__last_devu_message_ts`) only tracks
**human** agent comments. The follow-up bot posts as a `service_account` and
**moves nothing**. Naively trusting the cheap field flags tickets the automation
is handling correctly.

So pending evaluation is split
([ticketFields.js](../backend/services/attention/ticketFields.js)):

```
pendingPreVerdict(ticket, now)          ← SYNC, free, no API calls
  → null                                  = fine, done
  → { reason, timelineCheck: false }      = confidently flagged, done
  → { reason, timelineCheck: true }       = AMBIGUOUS, must confirm
                    ↓
resolvePendingBlock(ticket, pre, now)   ← ASYNC, 1+ API calls
  walks the timeline backwards for the last EXTERNAL org comment
  → null      = bot touched it recently, automation on track, drop the flag
  → reason    = confirmed, keep the flag
```

Three cheap signals feed the pre-verdict before anyone pays for an API call:

1. `tnt__last_devu_message_ts` — last human agent external message.
2. `tnt__last_revu_message_ts` — last customer message.
3. **`botFollowUpMs()`** — if a `service_account` matching `/email integration
   bot/i` was the ticket's **last modifier**, then `modified_date` *is* the last
   follow-up time. Free, straight off the work object.

Only when those three leave the answer genuinely ambiguous
(`timelineCheck: true`) does the expensive timeline walk run — and on a healthy
queue that is zero extra calls.

> **The timeline-pagination trap.** Timeline pagination covers *all* event
> types, and discussions arrive sparse — one busy ticket needed **15 forward
> pages** to reach its 53rd comment. A forward walk from ticket creation with a
> page cap therefore truncates **exactly the recent end where the answer
> lives**. Both timeline readers here walk **backwards** (`mode: "before"`,
> newest page first) and return on the first match — typically 1 page.

**Failure direction:** if the timeline API throws, the alert is **kept**
(fail-open toward nudging). An extra nudge beats silently dropping a real one,
and the hourly auto-verify clears it within the hour anyway.

### 1.3 Timing — the per-shift table

Every instant is IST-anchored and every one lands on a `*/15` cron tick. The
offsets are **not uniform** — do not try to derive them from shift hours.

```js
// backend/services/attention/config.js
ATTENTION_TIMING = {
  "SHIFT 1": { queueAt: 15.75, slackAt: 16.25, escalateAt: 8.75,  escalateNextDay: true  },
  "SHIFT 2": { queueAt: 18.75, slackAt: 19.25, escalateAt: 11.25, escalateNextDay: true  },
  "SHIFT 3": { queueAt: 21.25, slackAt: 21.75, escalateAt: 14.5,  escalateNextDay: true  },
  "SHIFT 4": { queueAt: 6.0,   slackAt: 6.75,  escalateAt: 23.25, escalateNextDay: false },
}
BUILD_WINDOW_MS = 30 * 60 * 1000   // late-tick tolerance after queueAt
```

| Shift | Hours (IST) | Queue builds | Slack summary | Follow-up if uncleared |
|---|---|---|---|---|
| 1 | 07:30–16:30 | 15:45 | 16:15 | 08:45 next day |
| 2 | 10:30–19:30 | 18:45 | 19:15 | 11:15 next day |
| 3 | 13:30–22:30 | 21:15 | 21:45 | 14:30 next day |
| 4 | 22:30–07:30 | 06:00 | 06:45 | 23:15 **same day** |

`escalateNextDay: false` for the overnight shift is not a typo: its queue posts
in the morning and the member's next shift starts that same evening. Getting
this wrong made shift-4 follow-ups land a full day late.

**Slack is Mon–Fri only.** Weekend shifts are assigned ad hoc and rarely match
the weekday roster, so *any* Slack timed off roster data is wrong on Sat/Sun.
Queues still **build** every day (the dashboard always has a list); summaries,
follow-ups and congratulations are suppressed. `isWeekendIst()` gates all three.

### 1.4 The lifecycle

```
 T-45min   BUILD ─────────────── dashboard only. No Slack.
              ├─ stream active tickets, keep only due members' tickets
              ├─ evaluateTicket() → buildItems() → sort longest-silence-first
              ├─ seed "tracked" from today's remarks / internal notes
              ├─ insert AttentionQueue doc (unique member+shift_date)
              └─ publishSocketEvent("ATTENTION_QUEUE")

 T-15min   SHIFT-END SUMMARY ─── one batched Slack post per (shift × team)
              ├─ group due queues by shift|date|channel
              ├─ CLAIM (updateMany shift_alert_sent_at) ── then post
              └─ store returned Slack ts as slack_thread_ts on every queue

 hourly    AUTO-VERIFY ───────── :30–:45 UTC tick, offset from the sync cron
              └─ re-verify every pending queue < 2 days old

 next      ONE-SHOT FOLLOW-UP ── threaded reply under that queue's own summary
 shift        ├─ shift-continuity gate (see 1.7)
              ├─ verifyAndClearQueue(member, "escalation", queue._id)
              ├─ CLAIM (findOneAndUpdate next_shift_start_at) ── then post
              └─ fires exactly once. Ever.
```

### 1.5 Item states

| State | Set by | Alerts? | Blocks clear? | Visible? |
|---|---|---|---|---|
| `pending` | build, or verify finding it still blocked and untracked | ✅ | ✅ | ✅ |
| `partial` (**"tracked"**) | a remark **or** an internal note on the queue's own IST day | ❌ same-day | ❌ | ✅ Tracked tab |
| `cleared` | verify confirming the required action happened | ❌ | ❌ | ✅ struck through |

Queue status is `pending` → `cleared` when **zero** items are `pending`
(tracked items do not block), or `empty` when the build found nothing at all.

**Tracking is a one-day snooze, not a hiding place.** The day-anchor — *not* the
queue's `created_at` — is the whole trick:

- remarks added any time during today's shift count, even though the queue only
  built 45 minutes before shift end;
- yesterday's remarks **never** count for today's queue.

So a still-blocked tracked ticket appears in the next-day follow-up thread *and*
lands back in its bucket at the next build. Nobody can park-and-forget.

Two independent tracking signals, checked cheapest-first:

1. `trackedRemarkIds()` — one Mongo query over the `Remark` collection for
   `timestamp >= <shiftDate>T00:00:00+05:30`.
2. `hasDevRevInternalNote()` — a per-ticket backwards timeline walk, run **only**
   when (1) missed *and* the item would otherwise alert. An engineer who opens
   the ticket in the ticketing UI and leaves an internal note there has done
   exactly the same thing as leaving a dashboard remark; before this existed,
   that work was invisible and they kept getting nudged for it.

> **Visibility is the point.** Only `internal` comments mark *tracking*. An
> external reply is a real customer action and clears the item **outright** via
> `itemStillBlocked` — routing it here would downgrade a full clear to "tracked".
> Note that a **missing** visibility field means internal — the API omits its
> default.

### 1.6 Verification — how an item actually clears

[verification.js](../backend/services/attention/verification.js) re-fetches each
non-cleared item live and asks `itemStillBlocked()`. It returns `null` (cleared)
for any of:

- the ticket is **solved**;
- the ticket **left its bucket** — whatever they did, it worked;
- the ticket was **reassigned** away from this member;
- the bucket's own condition is satisfied (reply today / outbound touch inside
  the window / pending re-verdict comes back clean).

Two guards on that list:

- **Reassignment only acts on a confident read.** An unresolvable owner (alias
  gap, unowned ticket) yields `null` from the resolver, and treating *that* as
  "reassigned" would silently empty everyone's queue the moment roster aliases
  drift. So: only a resolved-and-different owner counts as a handover.
- **An unverifiable item stays pending**, with `block_reason = "Could not verify
  … — try again"`. Never pass an item just because the fetch failed.

### 1.7 The shift-continuity gate

The one piece of logic that looks like over-engineering and isn't. Real
incident: an engineer finished **Friday** on shift 1 and started **Monday** on
shift 2. His Friday queue had frozen its escalation instant at build time from
shift 1 (08:45) — so the follow-up fired **105 minutes before he started work**,
and, because the retirement landed on a different document than the one the
due-query matched, it **re-fired every 15 minutes all morning**.

A "no action before your shift ends" nudge only means anything when it lands
inside the *same shift the queue was built for*. So the roster — not a value
frozen at build time — now decides whether a follow-up fires at all
([`escalationContinuity()`](../backend/services/attention/alerts.js), kept pure
and free of Mongo/HTTP so it is directly testable):

```
1. the member is rostered a working shift TODAY;                    else retire
2. today's shift === the queue's shift;                             else retire
3. the queue is from the expected day
   (yesterday, or TODAY for the overnight shift);                   else retire
4. the member was GENUINELY rostered that shift on the queue's day  else retire
   (not merely assumed via the fallback).
```

Retiring nulls the clock silently, and nothing is lost — the tickets re-flag
into the member's next build anyway.

**Monday needs no special case.** Yesterday was Sunday, when nobody is rostered
a real shift, so rule 4 fails for every member and no follow-up posts on a
Monday morning — without hardcoding a weekday anywhere.

### 1.8 Delivery — one exit point, claim-before-send

Every alert leaves through `postAlert({ kind, text, channel, threadTs })` in
[slack.js](../backend/services/attention/slack.js), which is also the only place
message wording lives.

```
POST $ATTENTION_N8N_WEBHOOK_URL
  { kind, text, channel, thread_ts }
    kind: shift_end_summary | no_action_followup | queue_cleared
← { ts: "1754392500.123456" }        ← the summary's ts anchors the thread
```

Why a workflow tool (n8n) and not an incoming webhook: **threads**. The
next-day follow-up must reply under the shift-end summary, and incoming webhooks
give you no `thread_ts` and hand back no `ts`. The plain
`ATTENTION_SLACK_WEBHOOK_URL` remains a fallback — it posts, but to its own
fixed channel, unthreaded.

`postAlert` **refuses to guess a channel**: `channel: null` drops the post with
a warn. Callers resolve it via `getTeamSlackChannel(member)` and skip entirely
when it is null. A member with no team channel still gets their queue built —
Slack is the only thing they lose.

> **The claim-before-send rule.** `ok` from `postAlert` means *"our HTTP call to
> n8n succeeded"*, **not** *"Slack received it"*. n8n can post the message and
> still fail to answer us — a timeout, a broken Respond-to-Webhook node, a
> non-2xx from a later node. Every one of those looks like a retryable failure
> while the member is already reading the message. So both alert paths **flip
> the Mongo marker first, then post**, and a genuinely failed send is logged and
> **dropped, not retried**. A missed follow-up costs nothing (the tickets
> re-flag next build); a duplicate one costs trust in the whole channel.
>
> Both claims use an **atomic predicate** (`shift_alert_sent_at: null` /
> `next_shift_start_at: { $ne: null }`) so the two schedulers in a hybrid
> API+worker topology can never both post the same alert.

Message shapes, all counts-only for the summary (the ticket list lives on the
dashboard):

| Queue state | Summary line |
|---|---|
| nothing at all | 🎉 congratulations, no tickets to be worked on! |
| only tracked | 👏 nothing to action, but *N being tracked* — action them tomorrow |
| actionable | ⏰ you have *X open*, *Y pending*, *Z on hold* — please update those |

The follow-up reply is deliberately minimal: bare clickable ticket IDs,
stage-wise, **tracked items included** — still-violating is still-violating.

### 1.9 Cost control — why the sweep is cheap

The sweep runs 96×/day but only ~12 ticks fall in a real build window. Four
decisions keep that affordable (all of them are scar tissue from an OOM-killed
512 MB instance):

1. **Decide who is due *before* touching any ticket source.** 90%+ of sweeps
   establish "nobody is due" and exit having loaded nothing. Follow-ups never
   need the ticket source at all — they verify per-ticket, live.
2. **Stream, don't blob.** `activeTicketsByMember()` streams pages from the
   ticketing API and keeps **only the due members'** tickets. The 20–60 MB
   `tickets:active` cache blob is never parsed — a full-blob parse stacked on a
   concurrently running sync in the same process is what killed the instance.
3. **Cache the roster for 10 minutes.** Shift assignments change at most daily;
   this turns 96 outbound calls into ~6. **Only a non-empty result is cached** —
   caching an API blip would pin "nobody is on shift" through a real build window.
4. **Expensive checks are last-resort.** The timeline walk runs only for
   ambiguous pending tickets; the internal-note check only when the cheap remark
   lookup missed *and* the item would otherwise alert.

> **The empty-queue guard.** A sweep with no ticket source would build **empty
> queues** — "🎉 congratulations!" for someone sitting on 20 aging tickets — and
> wedge their whole day. So when both the live stream and the cache are
> unavailable: a cron run **throws** (the job retries, and the 30-min build
> window means a later tick still covers it); a forced run may fall back to
> partial sync keys; everything empty **always throws, never builds**.

---

## 2. The files

### 2.1 The feature itself

Modules in **dependency order** — each may import only from the ones above it,
which is what keeps the feature acyclic. `index.js` is the documentation + the
public surface.

| File | Lines | Role |
|---|---|---|
| [config.js](../backend/services/attention/config.js) | 63 | Thresholds, reminder-tag sets, the per-shift timing table, ticket URL builder. **All the numbers.** |
| [time.js](../backend/services/attention/time.js) | 78 | IST calendar math: `istYmd`, `istInstant`, `istYmdShift`, `isWeekendIst`, `businessDaysSince`. Zero dependencies beyond `config`. |
| [roster.js](../backend/services/attention/roster.js) | 109 | Roster API client (per-date, Redis-cached, **never throws**). Consumes exactly 4 fields: `email`, `engineer_name`, `shift`, `slack_id`. |
| [ticketFields.js](../backend/services/attention/ticketFields.js) | 158 | Ticket field accessors + the two-phase pending verdict (`pendingPreVerdict` / `resolvePendingBlock`) + the backwards timeline walk. |
| [rules.js](../backend/services/attention/rules.js) | 122 | **The rule engine.** `evaluateTicket()` (pure) and `buildItems()`. |
| [tracking.js](../backend/services/attention/tracking.js) | 100 | "Has the member acknowledged this today?" — `trackedRemarkIds()` (Mongo) and `hasDevRevInternalNote()` (timeline). |
| [slack.js](../backend/services/attention/slack.js) | 151 | Delivery via n8n + **all** message wording. `postAlert` is the single exit point. |
| [queueBuilder.js](../backend/services/attention/queueBuilder.js) | 165 | `activeTicketsByMember()` (streaming, with the empty guard) and `buildQueueForMember()`. |
| [verification.js](../backend/services/attention/verification.js) | 180 | `verifyAndClearQueue()` + `itemStillBlocked()`. The evidence check. |
| [alerts.js](../backend/services/attention/alerts.js) | 378 | `runShiftEndAlerts()`, `runEscalations()`, `escalationContinuity()` (pure). |
| [sweep.js](../backend/services/attention/sweep.js) | 217 | The job entry point `runAttentionSweep()` + the two dashboard queries. |
| [index.js](../backend/services/attention/index.js) | 97 | Feature-level docs + re-exports the 14 public symbols. |

> **Two edits that are never the same edit.** Changing a **rule** means
> `rules.js` or `config.js`. Changing **wording** means `slack.js` only.

### 2.2 Everything else that participates

| File | What it contributes |
|---|---|
[models/AttentionQueue.js](../backend/models/AttentionQueue.js) | The schema + the `{member, shift_date}` unique index. |
[controllers/attentionController.js](../backend/controllers/attentionController.js) | 4 endpoints + the visibility model. |
[routes/attention.js](../backend/routes/attention.js) | Route table; `requireAdmin` on the manual trigger. |
[lib/queues.js](../backend/lib/queues.js) | The `attention` BullMQ queue (`attempts: 2` — lowest of all queues). |
[lib/workers.js](../backend/lib/workers.js) | Worker 7: dispatches `sweep` vs `csm-tam-alerts` by job name. |
[server.js](../backend/server.js) / [worker.js](../backend/worker.js) | The `*/15 * * * *` repeatable registration — **identical in both**, or the two topologies drift. |
[config/constants.js](../backend/config/constants.js) | `TEAMS[].slackChannel`, `TEAMLESS_MEMBERS[].slackChannel`, `getTeamSlackChannel()`, `SHIFT_HOURS`, `GST_MEMBERS`, `EMAIL_TO_NAME_MAP`, `TEAM_MAPPING`, `resolveOwnerName()`, `isSolvedStatus()`. |
[services/reconcileService.js](../backend/services/reconcileService.js) | `bucketForStage()` — stage name → `open`/`pending`/`onHold`/`other`. |
[services/devrevApi.js](../backend/services/devrevApi.js) | `fetchWorkItem()`, `fetchTimelineEntries()`. |
[services/sync/](../backend/services/sync/) | `streamActiveFromDevRev()`, `trimTicket()`. |
[models/Remark.js](../backend/models/Remark.js) | Dashboard remarks — the cheap tracking signal (30-day TTL). |
[src/api/attentionApi.js](../src/api/attentionApi.js) | 3 frontend calls. |
[src/features/attention/components/AttentionBell.jsx](../src/features/attention/components/AttentionBell.jsx) | Header bell + modal (790 lines): bucket tabs, member rail, Verify button, remark popover. |
[tests/attentionRules.test.js](../backend/tests/attentionRules.test.js) | Characterization test: 4000 deterministic generated tickets + the continuity matrix. |
[scripts/testAttentionSweep.js](../backend/scripts/testAttentionSweep.js) | Dry-run the rules against live data with **no Redis/Mongo**. The safe preview tool. |
[scripts/verifyResponseTimestamps.js](../backend/scripts/verifyResponseTimestamps.js) | The probe that proved internal notes don't move the timestamp fields. |
[scripts/probeQueueInternalNotes.js](../backend/scripts/probeQueueInternalNotes.js) | The probe that found the timeline-pagination trap. |

### 2.3 Data model

```js
AttentionItem {                        // subdoc, _id: false
  display_id, ticket_id,               // human id + full API id (the popover needs both)
  title, account, severity,
  bucket: "open" | "pending" | "onHold",
  rule,                                // "open-aging" | "pending-silent" | "onhold-stale"
  reason,                              // human-readable, shown in Slack AND the dashboard
  created_date,
  last_agent_external_ts,              // build-time snapshot; live values come fresh
  last_customer_ts,
  status: "pending" | "partial" | "cleared",
  cleared_at, partial_at,
  block_reason,                        // why the last verify kept it pending
}

AttentionQueue {
  member, member_email, slack_id,      // canonical name; "<@Uxxx>" from the roster
  shift, shift_date,                   // "SHIFT 2"; IST "YYYY-MM-DD"
  shift_end_at,
  shift_alert_at, shift_alert_sent_at, // summary schedule + the at-most-once claim
  slack_thread_ts,                     // thread anchor; null on the webhook fallback
  next_shift_start_at,                 // the follow-up instant; null = retired/no-op
  status: "pending" | "cleared" | "empty",
  items: [AttentionItem],
  created_at, cleared_at,
  escalation: { alert_count, last_alert_at },
}

index({ member: 1, shift_date: 1 }, { unique: true })
```

That unique index is load-bearing: it makes duplicate builds **impossible** even
if two sweeps race. The build path catches `E11000` and treats it as harmless.

### 2.4 API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/attention/queue` | JWT | The caller's own latest queue. |
| `GET` | `/api/attention/team-queues` | JWT | Latest queue for every member the caller may see. Powers the member rail. |
| `POST` | `/api/attention/verify-clear` | JWT | Re-verify a queue. Body `{ member? }`, permission-checked. |
| `POST` | `/api/attention/run` | **admin** | Manual sweep. Body `{ force?, member? }`. Dispatches via BullMQ when available, else runs inline. |

**Visibility model** (`resolveVisibility(email)`):

- `scope: "all"` — supervisors (`ATTENTION_SUPERVISOR_EMAILS`) see everyone.
- `scope: "team"` — a member sees self + teammates (same `TEAMS` block).
- `scope: "self"` — a teamless member sees only themselves.
- `null` → `{ visible: false }`, and the frontend renders no bell.

Letting a teammate or lead press Verify on someone else's queue is safe **because
verification is evidence-based** — it can only clear what the ticketing system
confirms was actioned. That property is what makes the permissive scope
acceptable; if you weaken verification, tighten this.

Socket events (via `publishSocketEvent`, Redis pub/sub → Socket.IO):
`ATTENTION_QUEUE` on build, `ATTENTION_QUEUE_UPDATED` on verify. The frontend
also polls every 15 min as a fallback.

---

## 3. What you need to change

To port this, work top-to-bottom. Steps 1–3 are the seams you must adapt to your
own stack; 4–10 are mechanical.

### Step 1 — Satisfy the external contracts

The feature depends on **eight** things it does not own. Provide each, or adapt
the call site. This is the whole porting effort.

| Contract | Signature the code expects | Notes |
|---|---|---|
| Per-ticket timestamps | `ticket.custom_fields.tnt__last_devu_message_ts`<br>`ticket.custom_fields.tnt__last_revu_message_ts` | Last **org-side external** message and last **customer** message, ISO strings. **Without these, nothing works.** If your system lacks them, you must derive them from the timeline — and then every ticket costs an API call, so add a cache. |
| Bot fingerprint | `ticket.modified_by.{type,display_name}` + `modified_date` | Lets `botFollowUpMs()` detect an automated follow-up for free. Optional — without it, more tickets take the timeline path. |
| Stage → bucket | `bucketForStage(stageName) → "open"\|"pending"\|"onHold"\|"other"` | Substring matching on lowercased, underscore-normalized stage names. Rewrite for your stage vocabulary. |
| Solved check | `isSolvedStatus(stageName) → bool` | Lowercase compare against `["solved","closed","resolved"]`. |
| Owner resolution | `resolveOwnerName(displayName) → canonicalName \| null` | Alias map. **Must return `null` when unresolvable** — the reassignment guard depends on that. |
| Live ticket stream | `streamActiveFromDevRev(async (pageOfTickets) => {…})` | Paged callback over all active tickets. |
| Single fetch | `fetchWorkItem(displayId) → ticket \| null` | Used per-item during verification. |
| Timeline | `fetchTimelineEntries(id, { cursor, limit, mode }) → { entries, nextCursor }`<br>entries: `{ type, visibility, created_by:{type}, created_date }` | **Must support backwards paging** (`mode: "before"`). Without it, re-implement 1.2's walk as a bounded forward walk and accept the truncation risk. |

Plus three infrastructure helpers: `redisGet/redisSet(key, val, ttlSeconds)`,
`publishSocketEvent(event, payload)`, and a pino-style `logger`.

### Step 2 — Provide identity + roster config

In your equivalent of `config/constants.js`:

```js
export const GST_MEMBERS         // Set<canonicalName>   — MEMBERSHIP LIVES HERE, not the roster
export const EMAIL_TO_NAME_MAP   // { email: canonicalName }
export const TEAM_MAPPING        // { canonicalName: { team, members[] } }
export const SHIFT_HOURS         // { "SHIFT n": { start, end, overnight? } } decimal IST hours
export const getTeamSlackChannel // (canonicalName) → channelId | null
```

Adding a member is a **one-array edit** (`TEAMS`) with everything else derived.
Set `slackChannel` per team (channel **IDs**, `C0…` — rename-proof), and per
member for teamless people who should share a channel. Empty/unset ⇒ their
queues build but post nowhere, with a log.

### Step 3 — Provide the roster API (or stub it)

The client expects `GET $ROSTER_API_URL?date=D-MMM` → rows with
`{ email, engineer_name, shift, slack_id }`, wrapped as `{data: [...]}` or a
bare array. Auth via `Authorization: Bearer` and/or `x-api-key`.

Note the date format: **`"30-Aug"`** — day **not** zero-padded, `en-US` short
month. Anything else misses the lookup. `ymdToDMmm()` builds it.

**If you have no roster:** stub `fetchRosterShiftsForDate()` to return `[]`. The
sweep degrades gracefully — every member falls back to their last known shift,
else `SHIFT 2` — and the **continuity gate then retires every follow-up**
(rules 1 and 4 fail). You get builds and summaries, no follow-ups. To keep
follow-ups without a roster, replace the gate with your own notion of "is this
member working now, on the same shift as the queue".

### Step 4 — Env vars

```bash
ROSTER_API_URL=                     # required for real shift timing
ROSTER_API_TOKEN=                   # optional — sent as Bearer
ROSTER_API_KEY=                     # optional — sent as x-api-key
ATTENTION_N8N_WEBHOOK_URL=          # primary Slack path (threads!)
ATTENTION_SLACK_WEBHOOK_URL=        # fallback incoming webhook (no threads)
ATTENTION_SLACK_MENTIONS=true       # "false" only in a test workspace
ATTENTION_SUPERVISOR_EMAILS=a@x,b@x # see-everything scope
```

Every one degrades rather than crashes: no roster URL ⇒ a warn and fallback
timing; no webhook ⇒ a warn and no post; no supervisors ⇒ the built-in default
list.

### Step 5 — Model

Copy `models/AttentionQueue.js` verbatim, re-export from your model index, and
**make sure the compound unique index actually builds** (`createIndexes`) — it
is the only thing preventing duplicate queues under a race.

### Step 6 — Queue + worker

```js
// lib/queues.js — attempts: 2 is deliberate. The sweep repeats every 15 min,
// so a failed run is retried once and then superseded by the next tick.
// Aggressive retries only risk double-posting Slack.
attentionQueue = new Queue("attention", { ...opts, defaultJobOptions: {
  attempts: 2, backoff: { type: "exponential", delay: 30000 },
  removeOnComplete: { count: 5 }, removeOnFail: { count: 10 },
}});

// lib/workers.js — concurrency: 1, lockDuration: 300000
new Worker("attention", guardProcessor("attention", async (job) =>
  runAttentionSweep(job.data || {})), { concurrency: 1, lockDuration: 300000 });
```

`concurrency: 1` matters: two concurrent sweeps would both pass the "already
built?" check before either inserted.

**No BullMQ?** Any 15-minute scheduler works — the sweep is idempotent by
construction. A bare `setInterval(runAttentionSweep, 15*60*1000)` is a valid
starting point; you lose retries and the manual-dispatch path.

### Step 7 — Cron registration

```js
await getAttentionQueue().add("sweep", {},
  { repeat: { pattern: "*/15 * * * *" }, jobId: "attention-sweep" });
```

Register it in **every** process that schedules crons (here: `server.js` for the
hybrid topology and `worker.js` for the split one) with **byte-identical
patterns**, or the two topologies drift apart. The fixed `jobId` is what keeps
repeated restarts from stacking schedulers.

The 15-minute cadence is not arbitrary — it is what makes `BUILD_WINDOW_MS`
(30 min) a *two-tick* tolerance, so a single missed tick never loses a build.

### Step 8 — Routes + controller

Copy `routes/attention.js` and `controllers/attentionController.js`, mount with
`app.use("/api", attentionRoutes)`, and check two things: your auth middleware
populates `req.user.email`, and `requireAdmin` guards `POST /attention/run`.

### Step 9 — Frontend

- `src/api/attentionApi.js` — 3 thin calls, unwrapping `res.data?.data`.
- `AttentionBell.jsx` — copy as a starting point. Two non-obvious requirements:
  - **Render through a portal to `document.body`.** The header is a `z-20` flex
    item, which creates a stacking context that traps a `fixed` overlay
    underneath the tab headers.
  - **Subscribe to both socket events** *and* poll every 15 min as a fallback.
- Drive visibility off `team-queues` returning `{ visible: false }` — never
  off a client-side role list.

### Step 10 — Slack delivery

Follow [ATTENTION_N8N_SETUP.md](ATTENTION_N8N_SETUP.md): a 3-node workflow
(**Webhook → Slack → Respond to Webhook**), a bot token with `chat:write`, and
the bot `/invite`d to **every** team channel. Channel and thread come from the
payload, so team reshuffles never touch n8n again.

Two corrections to that doc's §4, which predates the current code:

- The **summary** claims `shift_alert_sent_at` *before* posting, so a failed
  send is logged and **dropped**, not retried. The 2-hour late tolerance still
  applies to queues whose window passed while the service was down.
- The **follow-up** is **one-shot**, not hourly, and also claims before sending.
  A failed send is dropped. It has its own 2-hour tolerance
  (`ESCALATION_LATE_TOLERANCE_MS`) — a post failing for two hours is not about
  to start working, and one landing hours late is noise.

---

## 4. Gotchas worth reading before you debug

Each of these was a real incident.

| Symptom | Cause | Guard now in place |
|---|---|---|
| "🎉 Congratulations!" to someone with 20 aging tickets | Sweep ran with no ticket source and built an empty queue | Both sources empty ⇒ **throw, never build** (`queueBuilder.js`) |
| A working engineer got no queue for 3 days, silently | Roster row missing/"Data Missing" was the *membership* gate | Membership from constants; roster only picks **timing** |
| "I commented and clicked Verify but it stayed pending" — on *some* tickets only | Forward timeline walk + page cap truncated the recent end | Both readers walk **backwards** (`mode: "before"`) |
| Pending tickets flagged while the automation was working fine | The cheap timestamp field misses `service_account` bot posts | `botFollowUpMs()` + the confirming timeline walk |
| A follow-up fired 105 min *before* the member's shift, then every 15 min all morning | Escalation instant frozen at build time; retirement written to a different document | `escalationContinuity()` + verify scoped to `queue._id` |
| Duplicate Slack messages | Retried on `!ok`, but `ok` ≠ delivered | **Claim before send**, atomic predicate, drop on failure |
| Follow-up alerts for a ticket handed to someone else | Verification only looked at stage | Reassignment check on the **resolved** owner name |
| Sunday follow-up for a Saturday queue | No weekday policy | `isWeekendIst()` on all three post paths; follow-ups **slide** to Monday |
| Shift-4 follow-ups a full day late | Assumed all escalations are next-day | `escalateNextDay: false` for the overnight shift |
| Instance OOM-killed during shift 1/2 builds | Full 20–60 MB cache blob parsed alongside a running sync | Stream + filter to due members; decide due-ness before loading anything |
| Roster blip pinned "nobody on shift" for 10 min | Empty API result got cached | Cache **only non-empty** results |
| Whole sweep aborted on a roster hiccup | An axios error escaped the roster client | `fetchRosterShiftsForDate` **never throws** |

**Two accepted v1 boundaries**, so you don't chase them as bugs:

- Overnight-shift remarks made *before* midnight don't count for the morning
  queue (the day anchor is calendar-based).
- On the first day of an overnight-shift block the morning queue fires before
  the member's first night; the morning after the last day is missed.

---

## 5. Testing and operations

**Unit — the rule engine.** `backend/tests/attentionRules.test.js` is a
*characterization* test: 4000 deterministically generated tickets (a seeded LCG,
no `Math.random`) plus the continuity matrix. It asserts **shape and
distribution**, not hand-written expectations. The contract is explicit: if you
change a rule deliberately, the locked-in bucket counts change **in the same
commit**. That is what made splitting the original 1426-line service safe —
identical verdicts before and after.

**Dry run — no side effects.** `node scripts/testAttentionSweep.js` prints a
team-wide rule-match table straight off live ticket data, touching neither Redis
nor Mongo. Add `--member <Name>` for a full queue build, `--post` to preview
that member's real Slack summary in their real channel.

**Forced build.** `POST /api/attention/run { "force": true, "member": "<Name>" }`
**replaces** today's queue for that member, so repeated test runs genuinely
rebuild (and a queue built against a cold cache doesn't wedge the day). Cron
runs still build at most once per member per shift-date. A `force`+`member` run
for someone not on a working shift synthesizes a `"MANUAL"` shift — which has no
timing entry, so **no follow-up clock is ever set** for a test queue.

**Recovering a missed window.** Queues are idempotent per member per shift-date,
so re-running the sweep is always safe. Past the 30-minute build window you need
`force: true`. Past the 2-hour alert tolerance the summary is intentionally
skipped rather than posted stale — the tickets re-flag at the next build.

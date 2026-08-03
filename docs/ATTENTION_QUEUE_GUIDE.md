# Attention Queue — Manager & Team Guide

*Last updated: 4 Aug 2026*

The Attention Queue is the dashboard's shift-end nudge system. Near the end of every GST member's shift, it builds them a personal list of tickets that need action, posts it to Slack, and shows it under the 🔔 bell in the dashboard header. The queue can only be silenced by **actually actioning the tickets** — clearing is verified against live DevRev data, never against a checkbox.

---

## 1. When queues are built and escalated

| Shift | Hours (IST) | Queue posted | TL escalation if uncleared |
|-------|-------------|--------------|----------------------------|
| Shift 1 | 7:30 AM – 4:30 PM | **4:00 PM** | 8:45 AM next day |
| Shift 2 | 10:30 AM – 7:30 PM | **7:00 PM** | 11:15 AM next day |
| Shift 3 | 1:30 PM – 10:30 PM | **9:15 PM** | 2:30 PM next day |
| Shift 4 | 10:30 PM – 7:30 AM | **5:30 AM** | 11:15 PM same day |

- One queue per member per day. Members on Week Off / EL / holiday (per the roster) are skipped automatically.
- Escalations tag the member **and their team lead** in Slack and repeat **hourly** until the queue is clear.
- Every hour, the system also **auto-verifies** all open queues — a ticket actioned in DevRev disappears from the queue within the hour, without anyone pressing a button.

## 2. What lands in a queue — the rules

A "response" always means an **external** message to the customer (agent reply or the automated follow-up bot). Internal notes never count.

### 🟠 Open (Waiting on Assignee)
Flagged when the ticket is **4+ days old** and the owner has sent **no external reply today**.
Skipped when a reminder tag is present (the DevRev auto-reminder automation owns those).

### 🟡 Pending (Awaiting Customer Reply)
The DevRev automation follows up with silent customers on **business days only (Mon–Fri)**: first follow-up ~3 business days after our last message, then roughly every 2 business days, then a final reminder. Each follow-up counts as an external message.

A pending ticket is flagged **only when that automation is off track**:

| Situation | Rule | Alert says |
|---|---|---|
| No reminder sent at all | 4+ business days of silence | "automation never fired — nudge manually" |
| First or second reminder sent | Last touch was **more than 3 business days ago** (a reminder within the last 3 business days = on track, never shown) | "next follow-up is overdue — automation may be stuck" |
| Final reminder sent | 2+ business days with no reply | "close the ticket" |
| Customer replied, we went quiet | Reply is over a day old and ticket still sits in pending | "customer is still waiting on us" |

**Business days matter:** a reminder sent Friday whose successor is due "in 2 days" legitimately arrives Tuesday — weekend gaps never cause a false alert.

### 🔵 On Hold (Waiting on CleverTap)
Flagged when the customer hasn't heard from us in **2+ days** — even if engineering is actively working the linked issue, the customer must get an update every 2 days.

### 🟣 Tracked (partially verified)
If a GST member adds an **internal remark on the dashboard** to a queued ticket *after* the queue was built, the ticket becomes **Tracked**:

- It stops alerting — no Slack escalation, not counted in "tickets to clear".
- It stays visible under the queue's **Tracked** tab so managers can review what's parked and why.
- Only a **real DevRev action** (reply, stage change, solve) fully clears it. A remark alone never makes a ticket disappear.

### Ordering
Tickets are listed by **longest customer silence first** — a customer waiting 9 days appears above one waiting 4.

## 3. When is a queue "clear"?

Simple rule: **a queue is clear when nothing actionable is left in Open, Pending, or On Hold.** Tracked tickets don't block the clear. When it clears, a congratulations message goes to Slack automatically (mentioning how many tickets were actioned and how many remain tracked).

The **Verify & Clear** button re-checks every ticket against live DevRev on demand. A ticket clears only when the required action verifiably happened:

- **Open** → an external reply went out today, or the ticket left the bucket
- **Pending** → the silence clock was reset (agent nudge or automation caught up), or the ticket left the bucket
- **On Hold** → the customer heard from us within the last 2 days, or the ticket left the bucket
- **Any bucket** → ticket solved

## 4. Who sees what

| Role | Access |
|---|---|
| GST member | Their own queue **and their teammates'** (same team lead) |
| Team member without a team lead | Their own queue only |
| **Anmol, Mashnu, Rohan** | Every GST member's queue, grouped **team-wise** in the side panel |

The side panel stacks profiles by workload — heaviest queue on top. Click any profile to open that member's queue. Anyone who can *see* a queue can also press Verify on it: verification is evidence-based, so it can never wrongly clear anything.

## 5. FAQ

**Q: A ticket has "First Reminder Sent" — why isn't it in the queue?**
Because the reminder went out within the last 3 business days: the automation is doing its job. It will appear only if the next reminder fails to arrive on schedule.

**Q: Can someone hide a ticket by adding a remark?**
They can move it to Tracked (no alerts), but it never disappears — managers see the Tracked tab, and the ticket only truly clears with real DevRev action. Remarks also expire after 30 days.

**Q: The member is on leave and their queue is still escalating.**
Deliberate: escalations are personal pings in a private channel, and teammates can action the tickets. The hourly auto-verify clears the queue as soon as the work is done, whoever does it.

**Q: The queue says "Superstar" — what does that mean?**
The member ended their shift with zero tickets needing attention. That's the goal state. 🌟

# CleverTap Event Taxonomy

*Last updated: 2 Sep 2026. Source of truth: [`src/lib/analytics.js`](../src/lib/analytics.js).*

Every event the dashboard sends, what fires it, and which properties come with
it. Read this before adding an event, and before building a CleverTap segment,
funnel or dashboard on one.

---

## 1. How the layer is put together

```
call site  ──►  track(EV.X, { … })  ──►  flattenProps()  ──►  clevertap.event.push()
               lib/analytics.js         (arrays → strings)     lib/clevertap.js
                                        (+ ambient context)
```

| File | Owns |
|---|---|
| [`src/lib/analytics.js`](../src/lib/analytics.js) | The taxonomy: `EV` registry, `track()`, sanitization, ambient context, tab dwell, shared property builders. |
| [`src/lib/clevertap.js`](../src/lib/clevertap.js) | The SDK boundary only: `init`, `loginUser` (profile props), raw `trackEvent`. |

**Call sites never pass raw strings.** `track()` warns in dev when it sees a
name that isn't in `EV`, because a typo doesn't error — it silently creates a
second event that can never be merged with the first, and every segment built
on the old name quietly stops matching.

### 1.1 The array trap — the reason `track()` isn't a passthrough

`clevertap-web-sdk` (v2.3.3) validates every event with `isEventStructureFlat()`
at `clevertap.js:8026`. If **any** property value is an array or a nested
object, it reports error 512 and **drops the entire event** — not just the
offending property:

```js
if (!isEventStructureFlat(eventObj)) {
  logger.reportError(512, eventName + ' event structure invalid. Not sent.');
  continue;                                    // ← the whole event is gone
}
```

Every filter in this dashboard is a multi-select array, so the obvious call
would have sent **nothing at all**:

```js
trackEvent("Filter Applied", { Teams: ["Rohan", "Harsh"] })   // ✗ never arrives
```

So `flattenProps()` converts at the boundary:

| Input | Output |
|---|---|
| `["Rohan","Harsh","Aditya"]` | `Values: "Aditya, Harsh, Rohan"` + `Values Count: 3` |
| `[]` | `Values Count: 0` (the key is dropped, the count is not) |
| 20 values | first 12 joined + `" +8 more"`, `Values Count: 20` |
| `{ start, end }` | dropped, with a dev-console warning |
| `null` / `undefined` / `""` / `"undefined"` | dropped |
| `Date` | passed through — the SDK converts it (`isObject` tests `[object Object]`, so Dates fall through to `isDateObject`) |

**Joined values are sorted.** CleverTap segments on exact string equality, so
without sorting, picking the same two teams in a different order would produce
two different segments for one selection.

**Long lists are capped** at 12 values: past that the string stops being a
segmentable category and becomes effectively unique per user. `Values Count`
always carries the exact size.

### 1.2 Ambient context

`setAnalyticsContext()` stamps these onto **every** event, so no call site has
to thread them and everything is segmentable by them. Call-site props win on
conflict.

| Property | Set when | Values |
|---|---|---|
| `Tab` | tab change | `tickets`, `alltickets`, `csd`, `vistas`, `analytics`, `parts`, `activity`, `gamification` |
| `Role` | login | `Super Admin`, `GST Member`, `Viewer` |
| `GST Name` | login | canonical name, or `Non-GST` |
| `Theme` | theme toggle | `light`, `dark` |

### 1.3 Profile properties

Set by `loginUser()` on `onUserLogin.push`. Event properties answer *what
happened*; profile properties answer *to whom* — and they apply retroactively,
so every historical event becomes filterable the moment the profile updates.

| Property | Notes |
|---|---|
| `Identity`, `Email`, `Name` | `Identity` is the email — the unique id |
| `GST Name` | canonical name resolved from email |
| `Team` | team lead's name, or `Teamless` |
| `Is GST Member`, `Is Team Lead` | booleans |

---

## 2. Event reference

`Tab`, `Role`, `GST Name` and `Theme` are on every event (§1.2) and are not
repeated below.

### 2.1 Shell & navigation — every tab

| Event | Fires when | Properties |
|---|---|---|
| `Tab Viewed` | a tab becomes active | `Tab Label`, `Entry Method` (`click` / `url`), `Previous Tab` |
| `Tab Exited` | leaving a tab, or the page is hidden | `Tab Label`, **`Dwell Seconds`**, `Exit Reason` (`page hidden`, when applicable) |
| `Theme Toggled` | theme button | `Switched To` |
| `Sync Triggered` | any manual refresh | `Source` (`header button`, `parts refresh`, `activity intel`, `analytics refresh`), `Quarter`, `Group By` |

`Tab Viewed` + `Tab Exited` is a **pair**: view counts alone can't tell a tab
people land on and abandon in 2 seconds from one they work in for 20 minutes.
`Dwell Seconds` is what makes tab usage answerable.

> **Fixed here:** two effects used to fire `"Tab Visited"` and `"Tab Viewed"`
> off the identical `[activeTab]` dependency, so every switch counted twice
> under two names and neither matched reality. There is now one
> `trackTabChange()` effect. **`"Tab Visited"` is retired — drop it from any
> existing CleverTap report.**

### 2.2 Data shaping — cross-tab

| Event | Fires when | Properties |
|---|---|---|
| `Filter Applied` | a filter changes | `Filter` (key), `Values`, `Values Count`, `Active Filter Count`, `Source` |
| `Filters Cleared` | a filter is removed | `Filter`, `Scope` (`single` / `all`), `Values Dropped` |
| `Search Performed` | 1.5s after typing stops, 3+ chars | `Query`, `Query Length`, `Query Kind` (`ticket id` / `text`), **`Result Count`**, `Found Results` |
| `Date Range Changed` | a date range changes | `Range Start`, `Range End`, **`Span Days`**, `Preset` |
| `Report Downloaded` | a CSV is generated | `Ticket Count`, `Workspace`, `Format`, `Report`, `Active Filter Count`, `Had Search`, `Group By`, range props |
| `Ticket Opened` | a DevRev link is clicked | `Ticket ID`, `Account`, `Stage`, `Severity`, `Owner`, `Age Days`, `Source`, plus per-surface extras |

Three properties here carry most of the value:

- **`Source` on `Filter Applied`** is `user` or `auto`. The dashboard
  auto-applies filters on login (CSM/TAM role scoping, the Adish→regions
  cascade) — counting those would inflate filter usage for exactly the people
  who never touched a filter.
- **`Result Count` on `Search Performed`.** A zero-result search is a product
  signal (missing data, wrong id format, hunting for something the board can't
  show) and is otherwise indistinguishable from a successful one.
- **`Span Days` on `Date Range Changed`.** Span drives query cost — a 90-day
  range hits Mongo, a 1-day range doesn't.

`Ticket Opened` `Source` values: `tickets table`, `csd table`, `grouped list`,
`parts drilldown`, `attention queue`.

### 2.3 Ongoing Tickets · CSD Highlighted

| Event | Fires when | Properties |
|---|---|---|
| `KPI Card Clicked` | a health/status KPI card | `Status`, `Board Size`, `Count`, `Surface` |
| `Profile Card Opened` | a member avatar/name | `Member`, `Is Self` |

The health filter the KPI click applies is marked `Source: "auto"` so one click
doesn't report as both a card click and a deliberate filter application.

### 2.4 All Tickets

| Event | Fires when | Properties |
|---|---|---|
| `Group By Changed` | GST / CSM / TAM / Region tab | `Group By`, `Previous Group By` |
| `Chart Slice Clicked` | a pie slice or distribution bar | `Chart`, `Slice`, `Status`, `Group By`, **`Result Count`** |
| `KPI Card Clicked` | a status summary card | `Status`, `Count`, `Surface: "all tickets summary card"` |
| `Report Downloaded` | full report button | `Report: "All Tickets full report"`, `Ticket Count`, `Group By` |

### 2.5 Analytics

| Event | Fires when | Properties |
|---|---|---|
| `Analytics Period Changed` | quarter / group-by / week / month | **`Period Kind`** (`quarter`/`group by`/`week`/`month`), `Quarter`, `Previous Quarter`, `Group By`, `Week`, `Is Current`, `Surface` |
| `Metric Expanded` | a metric card is expanded | `Metric`, `Quarter`, `Group By` |
| `Chart Drill Down` | a chart data point | `Metric`, `Data Point`, `Data Point Label`, `Group By`, `Quarter` |

`Period Kind` collapses what would have been four event names into one funnel
step. Four separate names made *"how do people scope analytics?"* unanswerable
without joining four reports.

> **Fixed here:** the old `"Analytics Quarter Changed"` call lived in
> `PerformanceOverview.handleQuarterChange`, which **ESLint proves is
> unreferenced dead code** — the quarter selector lives in `AnalyticsDashboard`
> and arrives as a prop. **That event never fired.** The live path is now
> instrumented. `"Analytics Quarter Changed"` is retired.

### 2.6 Parts View

Previously **zero** events. Now:

| Event | Fires when | Properties |
|---|---|---|
| `Parts Tree Loaded` | the tree finishes loading (or fails) | `Total Tickets`, `Root Count`, `Filter Count`, `Fresh`, **`Load Ms`**, `Outcome` (`success`/`error`), `Error Message` |
| `Part Node Toggled` | a tree row is clicked | `Part Name`, **`Part Depth`**, `Ticket Count`, `Has Children`, `Action` (`expand`/`collapse`), `Trigger` |
| `Part Tree Bulk Toggled` | Expand-to-capability / Collapse-all | `Action`, `Node Count` |
| `Part Slice Clicked` | a composition donut slice | `Part Name`, `Part Depth`, `Ticket Count`, `Context Name`, **`Share Pct`** |
| `Part Drilldown Opened` | the inline ticket table loads a page | `Part Id`, `Page`, `Result Count`, `Rows Loaded`, `Has More`, `Empty` |
| `Parts Panel Toggled` | Trend / Breakdown buttons | `Panel`, `Now Visible` |
| `Ticket Opened` | a drilldown row | standard ticket props + `Part Id`, `Source: "parts drilldown"` |

Why these properties:

- **`Part Depth`** — are people living at the product level, or drilling to
  capabilities and features? That one number decides whether the tree needs
  deeper defaults.
- **`Load Ms` + `Fresh`** — is the tab slow because the aggregation is slow, or
  because people keep bypassing the 10-minute cache with Refresh?
- **`Share Pct`** — clicking the dominant slice confirms what you knew;
  clicking the long tail is real exploration. Which one happens says whether
  the donut earns its screen space.
- **`Page`** on the drilldown — page 1 *is* the drilldown opening (the
  component mounts and immediately loads), so one event covers both the open
  and every subsequent "Load more".

### 2.7 Activity Intel

| Event | Fires when | Properties |
|---|---|---|
| `Activity Member Selected` | rail / leaderboard row / dependency row | `Member`, `Is Self`, `Date`, **`Source`**, `Member Count` |
| `Activity Date Changed` | picker, arrows, or Today | range props + **`Method`** (`range picker` / `step back` / `step forward`) |
| `Activity Drilldown Opened` | an hourly bar | `Member`, `Is Self`, `Date`, `Hour`, `Visibility Scope` |

The mount-time auto-select of yourself deliberately does **not** fire
`Activity Member Selected` — pre-selection isn't a choice, and counting it
would make every session look like a member switch. `Method` matters because if
arrow-stepping dominates the picker, the default range is wrong.

### 2.8 Gamification

| Event | Fires when | Properties |
|---|---|---|
| `Leaderboard Sorted` | a column header | **`Sort By`**, `Direction`, `Cohort`, `Quarter` |
| `Gamification View Switched` | Admin / My Stats / L1 / L2 | `View` (`admin`/`my stats`/`cohort`), `Cohort`, `Quarter`, `Member Count` |
| `Analytics Period Changed` | quarter toggle | `Quarter`, `Quarter Label`, `Is Current`, `Surface: "gamification"` |

Which column people sort by *is* the answer to "what do they think the
leaderboard is for" — rank, throughput and CSAT are three different stories
about how the team reads its own performance.

### 2.9 My Views

| Event | Fires when | Properties |
|---|---|---|
| `View Saved` | Save View | `View Name`, **`Filter Count`**, `Total Views` |
| `View Selected` | a view in the sidebar | `View Name`, `Filter Count`, `Total Views` |
| `View Deleted` | the trash icon | `View Name`, `Filter Count`, `Total Views` |

`Filter Count` is what makes these analysable: a saved view with 6 filters is a
workflow someone codified; a 0-filter one is a misclick.

### 2.10 Attention Queue

| Event | Fires when | Properties |
|---|---|---|
| `Attention Queue Opened` | the header bell, or a member in the rail | `Member`, `Is Self`, `Scope`, **`Badge Count`**, `Trigger` |
| `Attention Bucket Switched` | All / Open / Pending / On Hold / Tracked | `Bucket`, `Item Count` |
| `Attention Verify Clicked` | Verify & Clear **completes** | `Member`, `Is Self`, `Shift`, `Shift Date`, `Pending Before`, `Pending After`, **`Outcome`** |
| `Ticket Opened` | a queue item's DevRev link | ticket props + **`Bucket`, `Rule`, `Reason`**, `Item Status`, `Member`, `Link` |

Two deliberate choices:

- **`Attention Verify Clicked` is tracked on the *result*, not the click.**
  Verification is evidence-based, so "pressed Verify" and "Verify actually
  cleared something" are different facts, and only the second says whether
  people use the button to confirm real work.
- **`Rule` on `Ticket Opened`** is the single most useful signal for tuning the
  attention thresholds: it shows which rule drives real action and which one
  people ignore. See
  [ATTENTION_QUEUE_IMPLEMENTATION.md](ATTENTION_QUEUE_IMPLEMENTATION.md) for
  the rules themselves.

### 2.11 DevRev AI Agent

| Event | Fires when | Properties |
|---|---|---|
| `Agent Query Sent` | a query is submitted | `Query Length`, **`Turn Index`**, `Source` (`typed`/`suggestion chip`) |
| `Agent Response Received` | the poll loop settles | `Outcome` (`success`/`error`), `Response Type`, `Response Length`, **`Duration Ms`**, **`Retries`**, `Turn Index`, `Error Message` |

`Turn Index` separates "asked one thing and left" from a real conversation —
the difference between a novelty and a tool people rely on. `Duration Ms` +
`Retries` are the operational half: a "successful" answer after 3 attempts and
40s is a very different experience from a 4s one.

### 2.12 Remarks

| Event | Fires when | Properties |
|---|---|---|
| `Comment Added` | a remark syncs to DevRev | `Ticket ID`, `Comment Length`, **`Has Mention`**, `Synced To DevRev` |

`Has Mention` matters because @tagging turns a remark into a handoff rather
than a private note — two different features sharing one input box.

---

## 3. Adding an event

1. **Try a property first.** Few names with rich properties beats one name per
   surface: `Filter Applied` segmented by `Tab` answers far more than eight
   per-tab filter events, and CleverTap caps distinct event names per account.
2. Add the name to `EV` in [`src/lib/analytics.js`](../src/lib/analytics.js).
   Dev-mode `track()` warns on anything unregistered.
3. Call `track(EV.YOUR_EVENT, { … })`. Pass arrays freely — `flattenProps`
   handles them. Never pass a nested object.
4. **Never rename an existing event or property key.** Renaming orphans every
   segment, funnel and campaign built on it. Add a new name and deprecate.
5. Add a row to §2 in this file, in the same commit.

### Property naming conventions

| Convention | Example | Why |
|---|---|---|
| `Title Case With Spaces` | `Ticket Count` | Matches what the CleverTap UI displays |
| Booleans read as questions | `Is Self`, `Has Mention`, `Found Results` | Filterable without remembering the polarity |
| Counts end in `Count` | `Result Count`, `Values Count` | One numeric convention across tabs |
| Durations end in `Ms` / `Seconds` | `Load Ms`, `Dwell Seconds` | The unit is in the name |
| `Source` = where it was triggered | `header bell`, `member rail` | One event, many surfaces |
| `Outcome` = what happened | `success`, `error`, `cleared` | Success/failure never needs a second event |

Use the shared builders in `analytics.js` — `dateRangeProps()`,
`ticketProps()`, `activeFilterCount()`, `rangeSpanDays()` — so the same
question is phrased identically everywhere. One segment (`Span Days > 90`) then
works regardless of which tab produced the event.

---

## 4. Retired events

Remove these from existing CleverTap reports.

| Event | Why |
|---|---|
| `Tab Visited` | Duplicate of `Tab Viewed` — both fired on the same state change. |
| `Analytics Quarter Changed` | Lived in unreferenced dead code; it never fired. Replaced by `Analytics Period Changed` with `Period Kind: "quarter"`. |

Property renames on surviving events (update any saved segment):

| Event | Old key | New key |
|---|---|---|
| `View Saved` / `View Deleted` | `Name`, `ID` | `View Name` (plus `Filter Count`, `Total Views`) |
| `Chart Drill Down` | `Date` | `Data Point` (plus `Data Point Label`) |

---

## 5. Verifying instrumentation

1. **Dev console.** `track()` warns on unregistered event names; `flattenProps`
   warns on dropped nested objects. Both are dev-only.
2. **Network.** Look for requests to `clevertap-prod.com` / `wzrkt.com`; the
   event payload rides in the `d` query parameter.
3. **Error 512** in the console means an event was rejected as non-flat and
   **was not sent**. That should be impossible through `track()` — if you see
   it, something is calling `trackEvent` from `lib/clevertap.js` directly.
4. **CleverTap dashboard.** Events appear under Analytics → Events within a few
   minutes. A name that shows up misspelled cannot be merged — fix the code and
   abandon the bad name.

Account id `R57-875-KK7Z`, hardcoded in `lib/clevertap.js`. There is currently
**no separate dev/prod project**, so local development writes into the same
account as production — worth splitting via an env var before doing heavy
instrumentation work.

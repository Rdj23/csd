# Code Map — where does this functionality live?

The other documents explain **what** each feature does and **why** it was built
that way. This one answers the question you have when a ticket comes in:
*"I need to change X — which file do I open?"*

Read this alongside [README.md](README.md) (feature index) and
[developer-guide.md](developer-guide.md) (step-by-step how-tos).

---

## The one rule

**Every folder is either a LAYER or a FEATURE, never both.**

- A **layer** answers *"what kind of thing is this?"* — a route, a controller, a
  model, a React component.
- A **feature** answers *"what part of the product is this?"* — attention queue,
  roster, parts, analytics.

The backend is organised by layer at the top and by feature inside `services/`.
The frontend is organised by feature at the top and by layer inside each
feature. Both end up at the same place: one folder per thing a person can change.

---

## Backend

```
backend/
├── server.js            API process — Express, Socket.IO, cron registration
├── worker.js            Worker process — BullMQ consumers only
│
├── routes/              WHICH URL exists          (one file per domain)
├── controllers/         REQUEST -> RESPONSE       (parse, call a service, format)
├── services/            THE BUSINESS LOGIC        (one FOLDER per feature)
├── models/              THE DATA SHAPE            (one FILE per collection)
├── validations/         WHAT INPUT IS LEGAL       (Zod schema per domain)
│
├── config/              Connections + constants
├── middleware/          Cross-cutting request handling
├── lib/                 Infrastructure that is not a "service"
├── utils/               Small pure helpers
├── scripts/             One-off / manual operations
└── tests/               Vitest
```

### Following a request

```
HTTP  ->  middleware/http.js       CORS, helmet, compression, body parsing
      ->  middleware/security/     who are you? are you allowed? not too fast?
      ->  routes/<domain>.js       which handler owns this URL
      ->  middleware/validate.js   is the input legal? (validations/<domain>Schemas.js)
      ->  controllers/<domain>.js  unwrap the request, call a service
      ->  services/<feature>/      the actual work
      ->  models/                  read/write Mongo
      ->  lib/cache.js             read/write Redis
```

If a response is **wrong**, the bug is in a service. If a response is
**malformed, unauthorised or rejected**, it is in a controller, middleware or
validation schema. That split is the whole point of the layering.

### The five feature modules

Each was a single file over 650 lines. Each is now a folder whose `index.js`
carries the feature documentation and re-exports the same public surface it
always had — so existing imports were never broken.

| Feature | Folder | Start reading at |
|---|---|---|
| Attention Queue | `services/attention/` | `index.js` — the rules, then `rules.js` |
| Roster | `services/roster/` | `index.js`, then `snapshot.js` |
| Sync (DevRev ingest) | `services/sync/` | `index.js` — two pipelines |
| Parts hierarchy | `services/parts/` | `index.js`, then `ancestry.js` |
| Activity Intel | `services/activity/` | `index.js` — the pipeline |

**Attention Queue** — `services/attention/` *(was attentionService.js, 1426 lines)*

Modules in dependency order; each may only import from the ones above it.

| File | Owns |
|---|---|
| `config.js` | thresholds, reminder tags, per-shift timing table |
| `time.js` | IST calendar math — every decision here is IST-relative |
| `roster.js` | who is on shift and when it ends |
| `ticketFields.js` | reading DevRev fields; is a pending ticket off-track? |
| `rules.js` | **the rule engine** — `evaluateTicket` / `buildItems` |
| `tracking.js` | has the member acknowledged this today? (remark OR internal note) |
| `slack.js` | n8n delivery **and the exact message wording** |
| `queueBuilder.js` | assembling one member's queue |
| `verification.js` | re-checking against DevRev before a queue may clear |
| `alerts.js` | shift-end summary + next-day escalation |
| `sweep.js` | the repeatable job entry point + dashboard queries |

> Changing a **rule** means `rules.js` or `config.js`. Changing **wording**
> means `slack.js`. They are never the same edit.
> `rules.js` is covered by `tests/attentionRules.test.js` — a characterization
> test over 4000 generated tickets. If you change a rule deliberately, the
> locked-in bucket counts there change with it, in the same commit.

**Roster** — `services/roster/` *(was rosterService.js, 1157 lines)*

| File | Owns |
|---|---|
| `snapshot.js` | the in-memory roster **and its only writer** (Sheets → Redis) |
| `shifts.js` | reading one cell: working? which shift? when? |
| `backup.js` | the backup-resolution ladder |
| `workingDays.js` | which days a person works |
| `queries.js` | the read models the API serves |

> `snapshot.js` owns `ROSTER_ROWS` / `DATE_COL_MAP` / `LEVEL_COL_IDX`. Nothing
> else may assign to them — readers call `getRosterRows()` and friends. One
> owner of mutable state is what makes the rest of the folder safe to reason about.

**Sync** — `services/sync/` *(was syncService.js, 988 lines)*

Two pipelines with different destinations and cadences:

| File | Owns |
|---|---|
| `ticketShape.js` | the vocabulary **both** pipelines share |
| `devrevFetch.js` | reading active tickets out of DevRev |
| `activeSync.js` | DevRev → **Redis**, per webhook + hourly safety net |
| `historicalSync.js` | DevRev → **Mongo**, nightly solved backfill |

> A ticket wrong in **both** the live board and analytics points at
> `ticketShape.js`. Wrong in only one points at that pipeline.

**Parts** — `services/parts/` *(was partsService.js, 726 lines)*

| File | Owns |
|---|---|
| `config.js` | cache keys, unresolved sentinel, DevRev URL, stage matchers |
| `ancestry.js` | the `is_part_of` link-walking resolver (DI'd, unit-tested) |
| `sync.js` | the daily tag-and-cache cron |
| `queries.js` | tree, tickets and trend for the API |

> Wrong **parent** → `ancestry.js`. Ticket tagged with the wrong part →
> `sync.js`. Wrong counts on a correct tree → `queries.js`.

**Activity Intel** — `services/activity/` *(was activityService.js, 653 lines)*

| File | Owns |
|---|---|
| `config.js` | ingest window (Jan 1 2026 IST), concurrency, cooldowns |
| `resolve.js` | WHO wrote it, WHICH account, **how many POINTS** |
| `entries.js` | one entry document + its daily rollup |
| `sync.js` | the batch/backfill worker (the cron body) |
| `webhook.js` | the live single-entry path |

> Wrong **points** → `resolve.js`. Wrong **totals** over correct entries →
> `entries.js`. A whole day **missing** → `sync.js`; there is no automatic
> backfill when the worker is down, so that needs a `fullBackfill` resync.

### Services that are not feature folders

| File | Owns |
|---|---|
| `services/dependencies.js` | which linked NOC/ISS blocks a ticket, and the per-ticket cache keyed on `modified_date` — read the header before changing the caching |
| `services/devrevApi.js` | the DevRev HTTP client, retry and rate-limit handling |
| `services/reconcileService.js` | the daily count reconciliation vs DevRev |
| `services/slackService.js` | Slack/n8n delivery shared across features |
| `services/csmTamAlertService.js` | the 11:00 IST CSM/TAM stale-ticket DMs |
| `services/agentService.js` | the DevRev AI agent async poll |
| `services/analyticsService.js` | analytics aggregation helpers |

### Config, middleware and lib

| Path | Owns | Open it when |
|---|---|---|
| `config/mongo.js` | Mongo connection + retry | changing pool size or timeouts |
| `config/redis.js` | the Redis **client** lifecycle | changing connection behaviour |
| `config/bullmq.js` | BullMQ's separate shared connection | queue connection counts |
| `lib/cache.js` | the **cache API** — TTLs, get/set/hash/lock | changing a TTL or adding a helper |
| `config/constants.js` | teams, shifts, IST helpers, quarters | onboarding someone |
| `middleware/http.js` | CORS, helmet, compression, parsers, readiness | request-pipeline behaviour |
| `middleware/security/identity.js` | secrets + `ADMIN_EMAILS` | **adding an admin** |
| `middleware/security/apiKey.js` | key hashing + scopes | **adding a scope** |
| `middleware/security/auth.js` | `verifyToken`, `requireAdmin` | changing who may call what |
| `middleware/security/rateLimit.js` | the three limiters | **loosening a limit** |
| `lib/queues.js` / `lib/workers.js` | BullMQ queue + consumer definitions | adding a background job |
| `lib/pubsub.js` | cross-process Redis pub/sub | adding a broadcast event |
| `lib/egressMeter.js` | bandwidth accounting | investigating Render egress |
| `lib/memoryGuard.js` | heap watchdog | investigating OOM |

> `config/redis.js` vs `lib/cache.js` is a deliberate split: one owns the
> **client**, the other owns the **cache contract**. Changing a TTL should never
> mean opening connection code.

---

## Frontend

```
src/
├── main.jsx              entry
├── App.jsx               shell: auth, tabs, filter bar, layout
├── store.js              zustand — server state, sockets, bandwidth guards
│
├── api/                  EVERY network call        (one file per domain)
├── lib/                  cross-feature pure logic  (no React in here)
├── hooks/                cross-feature hooks
├── components/           cross-feature UI  (ui/ = primitives, common/ = widgets)
└── features/<name>/
    ├── components/       that feature's UI
    ├── lib/              that feature's pure logic
    └── hooks/            that feature's hooks
```

### Where does my code go?

| It is… | It goes in |
|---|---|
| a network call | `src/api/<domain>Api.js` — **never** inline in a component |
| pure logic used by 2+ features | `src/lib/` |
| pure logic used by 1 feature | `src/features/<name>/lib/` |
| a component used by 2+ features | `src/components/` |
| a component used by 1 feature | `src/features/<name>/components/` |

### Shared modules

| File | Owns |
|---|---|
| `api/apiClient.js` | **which HTTP client to use, and why there are two** |
| `api/authAxios.js` | the default client — token + 401 logout via interceptors |
| `api/authFetch.js` | the fetch client, for raw-`Response` needs (ETag/304) |
| `lib/teams.js` | team config — **mirrors `backend/config/constants.js`** |
| `lib/ticketStatus.js` | status labels, SLA age, CSAT display |
| `lib/dependencies.js` | linked-issue helpers, incl. the "Not checked" state |
| `lib/csv.js` | **all** CSV download mechanics — every exporter calls this |
| `lib/clevertap.js` | product analytics events |

### Feature logic worth knowing about

| File | Owns |
|---|---|
| `features/tickets/lib/filterOngoingTickets.js` | the ongoing board's whole filter pipeline |
| `features/tickets/lib/filterAllTickets.js` | the All Tickets pipeline (live + solved) |
| `features/analytics/lib/computeStats.js` | the headline analytics KPIs |
| `features/analytics/lib/smallChartData.js` | the four overview charts |
| `features/analytics/lib/expandedChartData.js` | the full-screen metric chart |
| `features/analytics/lib/aggregate.js` | daily → weekly/monthly bucketing |
| `features/analytics/lib/analyticsConfig.js` | `METRICS`, `CHART_COLORS`, quarters |
| `features/parts/lib/treeUtils.js` | part-tree flattening/rollup |

> These are **pure functions**: same arguments in, same value out. They were
> extracted out of `useMemo` bodies so they can be read, reused and tested
> without mounting a component. Their call sites keep the original dependency
> arrays, so when they recompute is unchanged.

### Naming gotcha: three different drill-downs

`DrillDownModal` used to name three unrelated components. They are:

| File | Which drill-down |
|---|---|
| `features/tickets/components/TicketDrillDownModal.jsx` | All Tickets — click a state card or chart slice |
| `features/analytics/components/DrillDownModal.jsx` | Analytics — click a KPI or trend point |
| `features/activity/components/DrillDownModal.jsx` | Activity — click an hour or day |

---

## Verifying a change did not break anything

```bash
# backend
cd backend && npx vitest run          # 67 tests
npx eslint backend --quiet

# frontend
npx vite build                        # must succeed
npx eslint src                        # see the note below
```

**`vite build` passing is not sufficient for a component refactor.** Bundlers
resolve *module imports*, not free identifiers — JSX referencing a variable
that no longer exists compiles cleanly and throws at runtime. `eslint`'s
`no-undef` is the check that catches it. Run it after moving any component.

Known pre-existing `no-undef` in `src/`, both unrelated to layout:
- `process` in a browser-globals file
- `calculateAge` in `Allticketsview.jsx` — see the Known Issues below

---

## Known issues (pre-existing, deliberately not changed)

| Issue | Where | Effect |
|---|---|---|
| `downloadFullReport` is defined but never called, and its body references `calculateAge`, which is not in its scope | `features/tickets/components/Allticketsview.jsx:632` | **none today** — it is unreachable. Wiring it to a button without moving `calculateAge` to module scope would throw `ReferenceError` |
| duplicate Mongo index on `{date_bucket:1}` (`index: true` *and* `schema.index()`) | `models/UserActivityDaily.js` | Mongoose startup warning; wasted write throughput |

Both predate the restructure and were left alone because fixing them changes
behaviour. Neither is a live user-facing fault: the first is dead code with a
scope bug waiting inside it, so the decision to make is whether that export was
meant to ship at all.

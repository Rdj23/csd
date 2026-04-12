# Support Dashboard — Technical Documentation

## Overview

The Support Dashboard (CSD) is a real-time analytics platform for the CleverTap Global Support Team (GST). It syncs ticket data from DevRev's API, caches it across Redis and MongoDB, and serves 70+ concurrent users with sub-200ms response times.

**Tech Stack**: React 19 + Vite | Express + Socket.IO | MongoDB Atlas | Redis | BullMQ

---

## Documentation Index

### Feature Documents (Section 1)

Each feature has its own document with user-facing description, backend mapping, data flow, and reference files.

| # | Feature | Document | Key Backend Files |
|---|---------|----------|-------------------|
| 01 | [Ongoing Tickets](features/01-ongoing-tickets.md) | Active ticket queue with KPI cards, sorting, real-time updates | `ticketController.js`, `syncService.js` |
| 02 | [All Tickets View](features/02-all-tickets-view.md) | Historical view with pie charts, cursor pagination, server-side filters | `ticketController.js`, `queryBuilders.js` |
| 03 | [CSD Highlighted](features/03-csd-highlighted.md) | Escalated tickets with stricter aging thresholds | `TicketList.jsx` (isCSDView=true) |
| 04 | [Filters System](features/04-filters.md) | Multi-select filters (client-side + server-side query builders) | `queryBuilders.js`, `MultiSelectFilter.jsx` |
| 05 | [CSV Export](features/05-csv-export.md) | Client-side CSV generation from filtered ticket data | `App.jsx` (handleExportCSV) |
| 06 | [Remarks](features/06-remarks.md) | Internal notes with @mentions, auto-sync to DevRev, 30-day TTL | `remarkController.js`, `RemarkPopover.jsx` |
| 07 | [My Views](features/07-my-views.md) | Saved filter presets with flexible schema | `viewController.js`, `GroupedTicketList.jsx` |
| 08 | [Analytics](features/08-analytics.md) | KPIs, trends, leaderboard, DSAT alerts, 3-tier caching | `analyticsController.js`, `aggregationStages.js` |
| 09 | [Roster & Backup](features/09-roster-backup.md) | Google Sheets sync, shift detection, backup resolution | `rosterService.js`, `rosterController.js` |
| 10 | [DevRev AI Agent](features/10-devrev-ai-agent.md) | Natural-language queries via async poll pattern | `agentService.js`, `AgentModal.jsx` |
| 11 | [Cron Jobs](features/11-cron-jobs.md) | 5 BullMQ queues, 4 cron schedules, job deduplication | `queues.js`, `workers.js`, `server.js` |
| 12 | [DevRev Data Access](features/12-devrev-data-access.md) | Multi-layer caching, rate-limit handling, cache stampede prevention | `database.js`, `devrevApi.js`, `syncService.js` |

### Architecture & Decisions (Section 2)

- [**Architecture Decisions**](architecture-decisions.md) — Why BullMQ, why Redis raw strings, why cursor pagination, why denormalized schemas

### Developer Guide (Section 3)

- [**Developer Guide**](developer-guide.md) — Step-by-step "How to modify" scenarios:
  - Add a new analytics metric
  - Add a new BullMQ queue
  - Add a new filter
  - Add a new tab/page
  - Add a new DevRev field
  - Modify gamification weights
  - Debug failed sync jobs

### Scaling (Section 4)

- [**Scaling Considerations**](scaling-considerations.md) — What breaks at 100+ users and 100K+ tickets, with prioritized fix roadmap

---

## Deferred Documentation

The following features are documented at a high level but will receive dedicated deep-dive documents later:

- **Gamification** — Scoring pipeline (percentile → normalization → weighting), L1/L2 split, quarter-based leaderboard
- **Activity Intel** — Comment tracking, co-op detection, IST bucketing, daily rollups, points system

# CSD - Customer Support Dashboard

A real-time support ticket management and analytics dashboard built with React, Node.js, MongoDB, and Redis.

## Overview

The CSD (Customer Support Dashboard) is a comprehensive tool for tracking support tickets, performance metrics, and team gamification. It integrates with DevRev for ticket management and provides real-time updates via WebSocket.

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB (or MongoDB Atlas)
- Redis (Upstash or local)
- DevRev API access

### Environment Setup

**Backend (.env)**
```bash
MONGO_URI=mongodb+srv://...
REDIS_URL=redis://...
VITE_DEVREV_PAT=your_devrev_token
GOOGLE_CLIENT_ID=your_google_client_id
PORT=5000
```

**Frontend (.env)**
```bash
VITE_API_URL=http://localhost:5000
VITE_GOOGLE_CLIENT_ID=your_google_client_id
```

### Installation

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd backend && npm install

# Start backend
npm run start

# Start frontend (in root directory)
cd .. && npm run dev
```

## Architecture

### Tech Stack

- **Frontend**: React 18 + Vite + Tailwind CSS
- **State Management**: Zustand
- **Backend**: Node.js + Express
- **Database**: MongoDB (warm/cold data)
- **Cache**: Redis (hot data)
- **Real-time**: Socket.io
- **Charts**: Recharts

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT (React + Zustand)                  │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐          │
│  │ Ongoing    │  │ Analytics  │  │ Gamification │          │
│  │ Tickets    │  │ Dashboard  │  │ View         │          │
│  └─────┬──────┘  └─────┬──────┘  └──────┬───────┘          │
│        └───────────────┴────────────────┘                   │
│                        │                                     │
│                ┌───────▼────────┐                           │
│                │  REST API +    │                           │
│                │  WebSocket     │                           │
│                └───────┬────────┘                           │
└────────────────────────┼────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    SERVER (Node.js + Express)                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐              │
│  │  Redis   │  │ Socket.io│  │  DevRev API  │              │
│  │  Cache   │  │          │  │  Connector   │              │
│  └─────┬────┘  └────┬─────┘  └───────┬──────┘              │
│        └────────────┴────────────────┘                      │
│                         │                                    │
│                 ┌───────▼───────┐                           │
│                 │    MongoDB    │                           │
│                 │  (Permanent)  │                           │
│                 └───────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

### Data Strategy

| Tier | Storage | TTL | Use Case |
|------|---------|-----|----------|
| **Hot** | Redis | 5 min | Active tickets, real-time dashboard |
| **Warm** | MongoDB (indexed) | - | Recent analytics (3 months) |
| **Cold** | MongoDB (archived) | - | Historical data (>3 months) |

## Project Structure

```
csd/
├── src/                          # React Frontend
│   ├── components/
│   │   ├── analytics/            # Analytics sub-components
│   │   │   ├── analyticsConfig.js    # Configuration & constants
│   │   │   ├── analyticsUtils.js     # Utility functions
│   │   │   ├── PerformanceOverview.jsx
│   │   │   ├── CSATSection.jsx
│   │   │   ├── DSATSection.jsx
│   │   │   ├── NOCAnalytics.jsx
│   │   │   ├── DrillDownModal.jsx
│   │   │   ├── SmartInsights.jsx
│   │   │   ├── ThisWeekStats.jsx
│   │   │   └── index.js              # Central exports
│   │   ├── AnalyticsDashboard.jsx    # Main analytics view
│   │   ├── Allticketsview.jsx        # Ongoing tickets view
│   │   ├── GamificationView.jsx      # Leaderboard view
│   │   ├── SmartDateRangePicker.jsx
│   │   └── MultiSelectFilter.jsx
│   ├── store.js                  # Zustand state management
│   ├── utils.js                  # Team configs & utilities
│   ├── App.jsx                   # Root component
│   └── main.jsx
├── backend/
│   ├── server.js                 # Express API & business logic
│   └── package.json
├── docs/                         # Documentation
└── package.json
```

## Features

### Ongoing Tickets Tab
- Real-time ticket tracking (Open, Pending, On-Hold, Solved)
- Multi-select filtering (region, assignee, account, dependency)
- Ticket grouping and health indicators
- Dependency tracking (NOC, WhatsApp, Billing, etc.)

### Analytics Dashboard
- Performance metrics (RWT, FRT, CSAT, FRR, Iterations)
- Trend charts (daily/weekly/monthly views)
- Owner/Team filtering
- Drill-down on chart data points
- CSAT Leaderboard
- DSAT Alerts

### Gamification
- Tier-based leaderboard (L1, L2, L3)
- Normalized scoring algorithm
- Privacy mode for non-admin users

## Date Ranges

### Quarter Definitions

| Quarter | Start Date | End Date |
|---------|------------|----------|
| Q4 2025 | Oct 1, 2025 | Dec 28, 2025 |
| Q1 2026 | Dec 29, 2025 (ISO Week 1) | Mar 31, 2026 |
| Q2 2026 | Apr 1, 2026 | Jun 30, 2026 |

> **Note**: Q1 2026 starts from Dec 29, 2025 to align with ISO Week 1.

### "All Time" Range
- Starts from: Dec 29, 2025
- Ends: Current date

## API Endpoints

### Tickets

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tickets` | GET | Fetch active tickets (cached) |
| `/api/tickets/analytics` | GET | Aggregated analytics |
| `/api/tickets/by-date` | GET | Tickets for specific date |
| `/api/tickets/by-range` | GET | Tickets for date range |
| `/api/tickets/live-stats` | GET | Real-time stats |

### Query Parameters (Analytics)

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `quarter` | string | Q1_26 | Quarter filter |
| `excludeZendesk` | boolean | false | Exclude Zendesk tickets |
| `excludeNOC` | boolean | false | Exclude NOC tickets |
| `owner` | string | All | Filter by owner |
| `groupBy` | string | daily | Grouping (daily/weekly/monthly) |

## Configuration

### Team Structure

Teams are defined in `src/utils.js`:

```javascript
TEAM_GROUPS = {
  "Mashnu": ["Rohan", "Archie", "Neha", ...],
  "Debashish": ["Shubhankar", "Musaveer", ...],
  "Shweta": ["Aditya", "Shweta", "Nikita"],
  "Tuaha": ["Tuaha Khan", "Harsh", ...],
  "Adish": ["Adish"]
}
```

### Hidden Users

Users excluded from analytics (system accounts):
- System
- DevRev Bot
- Anmol (Admin)

### Admin Access

Super admin emails with elevated access:
- rohan.jadhav@clevertap.com
- anmol.sawhney@clevertap.com

## Performance Optimizations

1. **Redis Caching**: Sub-millisecond response for cached data
2. **Debounced Fetching**: 150ms debounce on filter changes
3. **Retry with Backoff**: Max 3 retries with exponential backoff
4. **Pre-computed Analytics**: Background job refreshes every 15 minutes
5. **Lightweight WebSocket Signals**: 200 bytes per update vs 5MB full push

## Recent Fixes (Jan 2026)

1. **Date Logic**: Updated "All Time" to start from Dec 29, 2025 (ISO Week 1)
2. **Filtering**: Fixed excludeNOC filter not applying to DSAT query
3. **Performance**: Added debouncing to prevent constant refreshes
4. **Modularity**: Extracted components (DrillDownModal, SmartInsights, etc.)

## Documentation

- [Technical Architecture](./TECHNICAL_ARCHITECTURE.md) - Detailed system design
- [Developer Guide](./DEVELOPER_GUIDE.md) - Development guidelines
- [Optimization Summary](./OPTIMIZATION_SUMMARY.md) - Performance improvements
- [Deployment Checklist](./DEPLOYMENT_CHECKLIST.md) - Production deployment

## Contributing

1. Create a feature branch
2. Make changes following the existing code style
3. Test thoroughly with different filter combinations
4. Submit a PR with clear description

## License

Internal use only - CleverTap Support Team

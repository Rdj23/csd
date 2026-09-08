import React, {
  useMemo,
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import {
  format,
  subDays,
  isSameDay,
  parseISO,
  differenceInHours,
  differenceInDays,
  getHours,
  endOfDay,
} from "date-fns";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  Line,
  Cell,
} from "recharts";
import {
  CheckCircle,
  Maximize2,
  X,
  ArrowUpRight,
  Activity,
  Trophy,
  Users,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  TrendingUp,
  TrendingDown,
  ArchiveRestore,
  Layers,
  AlertCircle,
  ExternalLink,
  Frown,
  Smile,
  Crown,
  Medal,
  Globe,
  ListFilter,
  RefreshCw,
  Zap,
  Eye,
  EyeOff,
  Search,
  Table,
  Download,
  ChevronLeft,
  ChevronRight,
  Edit3,
} from "lucide-react";
import { DEPENDENCY_TEAMS, getTicketDepInfo } from "../../../lib/dependencies";
import { FLAT_TEAM_MAP, TEAM_GROUPS } from "../../../lib/teams";
import { getCSATStatus } from "../../../lib/ticketStatus";
import { useTicketStore } from "../../../store";
import SmartDateRangePicker from "../../../components/common/SmartDateRangePicker";
import MultiSelectFilter from "../../../components/common/MultiSelectFilter";
import { EV, track } from "../../../lib/analytics";
import { authFetch } from "../../../api/authFetch";

// Import split analytics components
import {
  CSATLeaderboard,
  DSATAlerts,
  PerformanceMetricsCards,
  NOCAnalytics,
  DrillDownModal,
  SmartInsights,
  ThisWeekStats,
} from "./index";
import {
  METRICS,
  OVERVIEW_METRICS,
  CHART_COLORS,
  HIDDEN_USERS,
  SUPER_ADMIN_EMAILS,
} from "../lib/analyticsConfig";
import { processChartData, processMultiUserData } from "../lib/analyticsUtils";
import {
  getCurrentQuarterKey,
  getAvailableQuarters,
  getQuarterDates as getQuarterDatesFromConfig,
  getQuarterKeyForDate,
} from "../lib/analyticsConfig";

// Import skeleton loaders for better perceived performance
import {
  PerformanceOverviewSkeleton,
  ChartSkeleton,
  LeaderboardSkeleton,
  LoadingSpinner,
} from "../../../components/ui/SkeletonLoader";
import { aggregateData as aggregateDataFn } from "../lib/aggregate";
import { buildSmallChartData } from "../lib/smallChartData";
import { computeFilteredStats } from "../lib/computeStats";
import { buildExpandedData } from "../lib/expandedChartData";

const QUARTERS = getAvailableQuarters();

const StatCard = ({ label, value, unit = "", color, isPositive }) => (
  <div className="bg-white dark:bg-slate-900 rounded-xl px-4 py-3.5 border border-slate-200 dark:border-slate-800"
       style={{ boxShadow: 'var(--shadow-card)' }}>
    <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">
      {label}
    </div>
    <div className="text-[22px] font-bold tracking-tight leading-none" style={{ color }}>
      {value}
      {unit && (
        <span className="text-sm font-normal text-slate-400 dark:text-slate-500 ml-1">{unit}</span>
      )}
    </div>
  </div>
);

// ============================================================================
// MAIN DASHBOARD
// ============================================================================
const AnalyticsDashboard = ({
  tickets = [],
  filters = {},
  filterOptions = {},
  onFilterChange,
  dependencies = {},
  filterOwner,
  isDark: propIsDark,
}) => {
  const {
    theme,
    currentUser,
    analyticsData,
    analyticsLoading,
    fetchAnalyticsData,
  } = useTicketStore();
  const [currentQuarter, setCurrentQuarter] = useState(getCurrentQuarterKey());
  const [expandedTimeRange, setExpandedTimeRange] = useState(30);
  const [expandedGroupBy, setExpandedGroupBy] = useState("daily");
  const [expandedAllTrends, setExpandedAllTrends] = useState([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

  const [expandedOverviewMetric, setExpandedOverviewMetric] = useState(null);

  const [excludeZendesk, setExcludeZendesk] = useState(false);
  const [excludeNOC, setExcludeNOC] = useState(true);

  // Drill-down state
  const [drillDownData, setDrillDownData] = useState(null);

  // Expanded chart date range - syncs with global but can be overridden
  const [expandedDateRange, setExpandedDateRange] = useState(null);

  const effectiveDateRange = useMemo(() => {
    const dateRange = filters?.dateRange;

    // Valid date range provided
    if (
      dateRange?.start &&
      dateRange?.end &&
      dateRange.start.length > 0 &&
      dateRange.end.length > 0
    ) {
      try {
        const startDate = parseISO(dateRange.start);
        const endDate = endOfDay(parseISO(dateRange.end));

        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
          return {
            start: startDate,
            end: endDate,
            days: differenceInDays(endDate, startDate) + 1,
            isAllTime: false,
          };
        }
      } catch (e) {
        // invalid date range, fall through to default
      }
    }

    // 2. "All Time" - Start from Jan 1, 2026
    if (dateRange && dateRange.start === "" && dateRange.end === "") {
      return {
        start: new Date("2026-01-01"),
        end: new Date(),
        days: 999,
        isAllTime: true,
      };
    }

    // Dynamic quarter date resolution — no hardcoded quarters
    const { start, end } = getQuarterDatesFromConfig(currentQuarter);
    return {
      start,
      end,
      days: differenceInDays(end, start) + 1,
      isAllTime: false,
    };
  }, [filters?.dateRange, currentQuarter]);

  // Sync currentQuarter when the date picker selection falls within a quarter.
  // The backend fetch is keyed by quarter, so we must translate any chosen date
  // range into the quarter that holds it — otherwise the fetched data won't
  // overlap the range and the view renders zeros (e.g. a custom Jan–Mar range
  // while currentQuarter is still Q3).
  useEffect(() => {
    const dateRange = filters?.dateRange;
    if (!dateRange?.start || !dateRange?.end) return;

    // 1. Exact quarter-preset match (keeps preset selections crisp).
    for (const q of QUARTERS) {
      const qd = getQuarterDatesFromConfig(q.id);
      const qStart = format(qd.start, "yyyy-MM-dd");
      const qEnd = format(qd.end, "yyyy-MM-dd");
      if (dateRange.start === qStart && dateRange.end === qEnd) {
        if (currentQuarter !== q.id) setCurrentQuarter(q.id);
        return;
      }
    }

    // 2. Custom range: resolve to the quarter containing the range's start.
    // Handles Jan–Mar and any sub-range within a single quarter. Cross-quarter
    // custom ranges resolve to the start quarter (a single-quarter fetch limit).
    const resolved = getQuarterKeyForDate(parseISO(dateRange.start));
    if (resolved && currentQuarter !== resolved) {
      setCurrentQuarter(resolved);
    }
  }, [filters?.dateRange]);

  // Use global date range for expanded charts unless overridden
  const expandedEffectiveDateRange = useMemo(() => {
    if (expandedDateRange) {
      // Handle "All Time" (empty strings) - Start from Jan 1, 2026
      if (expandedDateRange.start === "" && expandedDateRange.end === "") {
        const allTimeStart = new Date("2026-01-01");
        const allTimeEnd = new Date();
        return {
          start: allTimeStart,
          end: allTimeEnd,
          days: differenceInDays(allTimeEnd, allTimeStart) + 1,
          isAllTime: true,
        };
      }

      // Handle valid date range - PARSE STRINGS TO DATE OBJECTS
      if (
        expandedDateRange.start &&
        expandedDateRange.end &&
        expandedDateRange.start.length > 0 &&
        expandedDateRange.end.length > 0
      ) {
        try {
          const start =
            typeof expandedDateRange.start === "string"
              ? parseISO(expandedDateRange.start)
              : expandedDateRange.start;
          const end =
            typeof expandedDateRange.end === "string"
              ? endOfDay(parseISO(expandedDateRange.end))
              : expandedDateRange.end;

          // Validate parsed dates
          if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            return {
              start,
              end,
              days: differenceInDays(end, start) + 1,
              isAllTime: false,
            };
          }
        } catch (e) {
          // invalid expanded date range, fall through
        }
      }
    }
    return effectiveDateRange;
  }, [expandedDateRange, effectiveDateRange]);

  // Fetch analytics data when EXPANDED date range changes
  useEffect(() => {
    if (!expandedOverviewMetric) return; // Only when modal is open

    const range = expandedEffectiveDateRange;
    if (!range?.start || !range?.end) return;

    if (range.isAllTime) {
      // Fetch both previous and current quarters for "All Time"
      QUARTERS.forEach((q) => {
        fetchAnalyticsData({ quarter: q.id, excludeZendesk, excludeNOC, resolvedBy: filters?.resolvedBy });
      });
    } else {
      // Fetch current quarter's data
      fetchAnalyticsData({ quarter: currentQuarter, excludeZendesk, excludeNOC, resolvedBy: filters?.resolvedBy });
    }
  }, [
    expandedEffectiveDateRange,
    expandedOverviewMetric,
    excludeZendesk,
    fetchAnalyticsData,
    excludeNOC,
    filters?.resolvedBy,
  ]);

  // A dependency filter is "active" (narrowing the view) whenever the user's
  // selection is NOT the default "both Has + No" (the only no-op state). That
  // includes selecting exactly one box AND deselecting both — the latter must
  // yield zero results, not everything. It's also active for a strict subset of
  // dependency teams. The backend daily rollups (analyticsData.trends /
  // individualTrends) carry no per-ticket dependency dimension, so when this is
  // active we recompute stats AND charts client-side from the already-filtered
  // ticket arrays (solvedTickets / volumeTickets).
  const hasDependencyFilter = useMemo(() => {
    const dep = filters?.dependency || [];
    // Both boxes selected (length 2) is the only no-op; 0 or 1 selected narrows.
    if (dep.length < 2) return true;
    // Any non-full team selection narrows — INCLUDING zero teams selected,
    // which must yield zero dependency tickets (not "ignore the filter").
    return (
      dep.includes("with_dependency") &&
      Array.isArray(filters?.dependencyTeams) &&
      filters.dependencyTeams.length < DEPENDENCY_TEAMS.length
    );
  }, [filters]);

  // ── Mongo-sourced solved history for dependency-filtered views ──────────
  // The Redis active cache loses solved tickets over time, so KPIs/trends
  // computed from it undercount when a dependency filter is active (the
  // drill-downs already read Mongo). While the filter is on, fetch the range's
  // complete solved history — those rows carry the sync-time dependency
  // fields — and use IT as the solved source so every card, trend, and
  // drill-down reconciles. Falls back to the active cache on fetch failure.
  const [mongoSolved, setMongoSolved] = useState({
    key: null,
    tickets: [],
    loading: false,
    loaded: false,
  });
  const mongoSolvedKeyRef = useRef(null);
  useEffect(() => {
    if (
      !hasDependencyFilter ||
      !effectiveDateRange?.start ||
      !effectiveDateRange?.end
    )
      return;
    const start = format(effectiveDateRange.start, "yyyy-MM-dd");
    const end = format(effectiveDateRange.end, "yyyy-MM-dd");
    const key = `${start}:${end}`;
    if (mongoSolvedKeyRef.current === key) return;
    mongoSolvedKeyRef.current = key;
    let cancelled = false;
    setMongoSolved({ key, tickets: [], loading: true, loaded: false });
    const API_BASE = import.meta.env.VITE_API_URL || "";
    authFetch(`${API_BASE}/api/tickets/all-solved?start=${start}&end=${end}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setMongoSolved({
          key,
          tickets: data?.tickets || [],
          loading: false,
          loaded: true,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Allow a retry on the next filter toggle / range change; callers fall
        // back to the active-cache arrays meanwhile.
        mongoSolvedKeyRef.current = null;
        setMongoSolved({ key, tickets: [], loading: false, loaded: false });
      });
    return () => {
      cancelled = true;
    };
  }, [hasDependencyFilter, effectiveDateRange]);

  // Shared core-filter predicate (Zendesk / Team / Owner / Region) — applied to
  // BOTH the active-cache tickets and the Mongo all-solved rows (reshaped rows
  // carry `isZendesk` instead of raw DevRev tags, hence the dual check).
  const passesCoreFilters = useCallback(
    (t) => {
      // Exclude Zendesk if toggle is on
      if (excludeZendesk) {
        const isZendesk =
          t.isZendesk === true ||
          t.tags?.some((tagObj) => tagObj.tag?.name === "Zendesk import");
        if (isZendesk) return false;
      }

      // Team Filter
      if (filters?.teams?.length > 0) {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "";
        const ownerTeams = Object.keys(TEAM_GROUPS).filter((teamKey) =>
          Object.values(TEAM_GROUPS[teamKey]).includes(owner),
        );
        if (!filters.teams.some((team) => ownerTeams.includes(team)))
          return false;
      }

      // Owner Filter
      if (filters?.owners?.length > 0) {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "";
        if (!filters.owners.includes(owner)) return false;
      }

      // Region Filter
      if (filters?.regions?.length > 0) {
        const region = t.custom_fields?.tnt__region_salesforce || "Unknown";
        if (!filters.regions.includes(region)) return false;
      }

      return true;
    },
    [filters, excludeZendesk],
  );

  // 1. Core Filters WITHOUT the dependency dimension (Team, Owner, Region,
  // Zendesk). Split out from the dependency narrowing so we can tell whether the
  // (async, live-fetched) dependency map has loaded for every ticket the
  // dependency filter would examine — see dependencyDataReady below.
  const nonDepFilteredTickets = useMemo(
    () => tickets.filter(passesCoreFilters),
    [tickets, passesCoreFilters],
  );

  // Is the dependency map loaded for every ticket the filter would examine?
  // The map is fetched asynchronously (App.jsx, batched) — until a ticket's entry
  // exists, `dependencies[id]` is undefined and we CANNOT tell if it has a
  // dependency. We only wait on tickets that fall in the date range (created OR
  // closed), i.e. those the volume/solved arrays actually use — not the whole
  // active cache. `pendingDependencyCount` drives the "loading" banner.
  const pendingDependencyCount = useMemo(() => {
    if (!hasDependencyFilter) return 0;
    const { start, end } = effectiveDateRange;
    return nonDepFilteredTickets.reduce((count, t) => {
      const created = t.created_date ? parseISO(t.created_date) : null;
      const closedRaw = t.actual_close_date || t.closed_date;
      const closed = closedRaw ? parseISO(closedRaw) : null;
      const inRange =
        (created && created >= start && created <= end) ||
        (closed && closed >= start && closed <= end);
      if (!inRange) return count;
      // Known via either the sync-time Mongo snapshot or the live map.
      return getTicketDepInfo(dependencies, t).known ? count : count + 1;
    }, 0);
  }, [hasDependencyFilter, nonDepFilteredTickets, dependencies, effectiveDateRange]);

  const dependencyDataReady = pendingDependencyCount === 0;

  // Shared dependency-narrowing predicate (bucket + team subset). Every ticket
  // falls into exactly one bucket (has a dependency, or doesn't), so keep it
  // only when its bucket is among the selected checkboxes. Both selected
  // (length 2) = default no-op; one selected narrows; NONE selected correctly
  // yields zero results. Team subset: any non-full selection narrows — a
  // ZERO-team selection matches no dependency ticket (never "show all"), and
  // the length check must compare against DEPENDENCY_TEAMS.length (8), never a
  // hardcoded number (a hardcoded 6 once silently skipped the filter).
  const passesDependencyNarrowing = useCallback(
    (t) => {
      const depSel = filters?.dependency || [];
      const depInfo = getTicketDepInfo(dependencies, t);
      if (depSel.length < 2) {
        // Rows never checked by either source (pre-backfill Mongo rows) can't
        // prove membership in either bucket — exclude rather than guess. The
        // active-cache chain never hits this: it waits on dependencyDataReady.
        if (!depInfo.known) return false;
        const matchesSelection =
          (depInfo.hasDependency && depSel.includes("with_dependency")) ||
          (!depInfo.hasDependency && depSel.includes("no_dependency"));
        if (!matchesSelection) return false;
      }

      if (
        filters?.dependency?.includes("with_dependency") &&
        Array.isArray(filters?.dependencyTeams) &&
        filters.dependencyTeams.length < DEPENDENCY_TEAMS.length
      ) {
        if (depInfo.hasDependency) {
          const hasMatchingTeam = filters.dependencyTeams.some((team) =>
            depInfo.teams.includes(team),
          );
          if (!hasMatchingTeam) return false;
        }
      }

      return true;
    },
    [filters, dependencies],
  );

  // 1a. Apply the dependency narrowing on top of the non-dependency filters.
  // While a dependency filter is active but its data is still loading, we HOLD
  // the narrowing (pass everything through) so tickets like TKT-315055 aren't
  // wrongly dropped before their links resolve. The banner tells the user.
  const coreFilteredTickets = useMemo(() => {
    if (!hasDependencyFilter || !dependencyDataReady) {
      return nonDepFilteredTickets;
    }
    return nonDepFilteredTickets.filter(passesDependencyNarrowing);
  }, [
    nonDepFilteredTickets,
    passesDependencyNarrowing,
    hasDependencyFilter,
    dependencyDataReady,
  ]);

  // NOC-linked tickets are excluded via the dependency team list ("NOC" =
  // PSN-Task-linked) — works for active-cache tickets (live map) AND Mongo
  // rows (sync-time dependency_teams).
  const passesNocExclusion = useCallback(
    (t) => {
      const depInfo = getTicketDepInfo(dependencies, t);
      return !(depInfo.hasDependency && depInfo.teams.includes("NOC"));
    },
    [dependencies],
  );

  // 1b. Apply NOC filter on top of core filters (for non-CSAT metrics)
  const baseFilteredTickets = useMemo(() => {
    if (!excludeNOC) return coreFilteredTickets;
    return coreFilteredTickets.filter(passesNocExclusion);
  }, [coreFilteredTickets, excludeNOC, passesNocExclusion]);

  // The range's Mongo solved rows, run through the SAME core + dependency
  // narrowing as the active-cache chain (their dependency info is embedded, so
  // there is nothing to wait for). null = dependency filter off or rows not
  // loaded yet — callers then use the active-cache arrays as before.
  // Unlike the active cache (engineer-owned only), Mongo rows include
  // agent-resolved tickets, so the dashboard's Resolved-By filter must be
  // applied here too (same single-selection rule as the backend rollups).
  const mongoDepSolvedAll = useMemo(() => {
    if (!hasDependencyFilter || !mongoSolved.loaded) return null;
    let rows = mongoSolved.tickets
      .filter(passesCoreFilters)
      .filter(passesDependencyNarrowing);
    const resolvedBySel = filters?.resolvedBy;
    if (Array.isArray(resolvedBySel) && resolvedBySel.length === 1) {
      rows = rows.filter((t) => {
        const ticketResolvedBy =
          t.custom_fields?.tnt__agent_resolved === true &&
          t.custom_fields?.tnt__support_engineer_handled !== true
            ? "agent"
            : "engineer";
        return resolvedBySel.includes(ticketResolvedBy);
      });
    }
    return rows;
  }, [
    hasDependencyFilter,
    mongoSolved,
    passesCoreFilters,
    passesDependencyNarrowing,
    filters?.resolvedBy,
  ]);

  // 2. Volume Tickets: Strictly CREATED in the date range
  const volumeTickets = useMemo(() => {
    return baseFilteredTickets.filter((t) => {
      if (!t.created_date) return false;
      const created = parseISO(t.created_date);
      return (
        created >= effectiveDateRange.start && created <= effectiveDateRange.end
      );
    });
  }, [baseFilteredTickets, effectiveDateRange]);

  // Shared "closed in range + actually solved" check for the solved arrays.
  const isSolvedInRange = useCallback(
    (t) => {
      const closedDate = t.actual_close_date || t.closed_date;
      if (!closedDate) return false;
      const closed = parseISO(closedDate);

      // Must be solved in range
      if (closed < effectiveDateRange.start || closed > effectiveDateRange.end)
        return false;

      // Must actually be solved/closed status
      const stage = t.stage?.name?.toLowerCase() || "";
      return (
        stage.includes("solved") ||
        stage.includes("closed") ||
        stage.includes("resolved")
      );
    },
    [effectiveDateRange],
  );

  // 3. Solved Tickets: Strictly SOLVED in the date range (ignores created date).
  // Dependency filter active → sourced from the complete Mongo history so KPI
  // cards, trends, and the Mongo-backed drill-downs all count the same tickets;
  // otherwise from the active cache as before.
  const solvedTickets = useMemo(() => {
    const source = mongoDepSolvedAll
      ? excludeNOC
        ? mongoDepSolvedAll.filter(passesNocExclusion)
        : mongoDepSolvedAll
      : baseFilteredTickets;
    return source.filter(isSolvedInRange);
  }, [
    mongoDepSolvedAll,
    excludeNOC,
    passesNocExclusion,
    baseFilteredTickets,
    isSolvedInRange,
  ]);

  // 3b. Solved tickets INCLUDING NOC (for CSAT/DSAT computation - NOC never excluded from CSAT)
  const solvedTicketsForCSAT = useMemo(() => {
    if (!excludeNOC) return solvedTickets;
    const source = mongoDepSolvedAll ?? coreFilteredTickets;
    return source.filter(isSolvedInRange);
  }, [
    coreFilteredTickets,
    solvedTickets,
    excludeNOC,
    isSolvedInRange,
    mongoDepSolvedAll,
  ]);

  const handleDrillDown = useCallback(
    async (metricKey, dateKey, dataPointName, chartData) => {
      track(EV.CHART_DRILL_DOWN, {
        Metric: metricKey,
        "Data Point": dateKey,
        "Data Point Label": dataPointName,
        "Group By": groupBy,
        Quarter: currentQuarter,
      });
      // For VOLUME - use DevRev tickets (has created_date)
      if (metricKey === "volume") {
        const ticketsForDate = volumeTickets.filter((t) => {
          if (!t.created_date) return false;
          return format(parseISO(t.created_date), "yyyy-MM-dd") === dateKey;
        });

        setDrillDownData({
          title: `Incoming Volume - ${dataPointName}`,
          tickets: ticketsForDate,
          metricKey,
          summary: `${ticketsForDate.length} tickets`,
        });
        return;
      }

      // For SOLVED metrics - ALWAYS fetch from MongoDB. When a dependency
      // filter is active, the rows are narrowed client-side below using the
      // sync-time dependency fields each row carries (live-map fallback) —
      // serving these from the active cache instead would silently drop
      // tickets that aged out of it (the TKT-315055 bug).
      const API_BASE = import.meta.env.VITE_API_URL || "";

      // Build owner filter
      let ownerFilter = [];
      if (filters?.owners?.length > 0) {
        ownerFilter = filters.owners;
      } else if (filters?.teams?.length > 0) {
        filters.teams.forEach((teamKey) => {
          if (TEAM_GROUPS[teamKey]) {
            ownerFilter.push(...Object.values(TEAM_GROUPS[teamKey]));
          }
        });
      }

      // Build query params
      const queryParams = new URLSearchParams({
        date: dateKey,
        owners: ownerFilter.join(","),
        metric: metricKey,
        excludeZendesk: excludeZendesk ? "true" : "false",
        excludeNOC: excludeNOC ? "true" : "false",
      });

      // Add region filter if set
      if (filters?.regions?.length > 0) {
        queryParams.set("region", filters.regions.join(","));
      }

      try {
        const response = await authFetch(
          `${API_BASE}/api/tickets/by-date?${queryParams}`,
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        let ticketsForDate = data.tickets || [];

        // Dependency narrowing — the by-date endpoint can't scope by
        // dependency, so filter the returned rows with the SAME predicate the
        // KPI/trend arrays use; the drill-down list and the cards can't drift.
        if (hasDependencyFilter) {
          ticketsForDate = ticketsForDate.filter(passesDependencyNarrowing);
        }

        let summary = `${ticketsForDate.length} tickets`;

        if (metricKey === "frrPercent" || metricKey === "frr") {
          const frrMetCount = ticketsForDate.filter(
            (t) => t.frr === 1,
          ).length;
          const totalCount = ticketsForDate.length;
          const pct =
            totalCount > 0
              ? Math.round((frrMetCount / totalCount) * 100)
              : 0;
          summary = `FRR Met: ${frrMetCount} of ${totalCount} (${pct}%) | Total: ${ticketsForDate.length} tickets`;
        } else if (metricKey === "csat" || metricKey === "positiveCSAT") {
          const good = ticketsForDate.filter((t) => t.csat === 2).length;
          const bad = ticketsForDate.filter((t) => t.csat === 1).length;
          summary = `Good: ${good} 👍 | Bad: ${bad} 👎 | Total: ${ticketsForDate.length}`;
        } else if (metricKey === "rwt" || metricKey === "avgRWT") {
          const rwtValues = ticketsForDate
            .map((t) => t.rwt)
            .filter((v) => v != null && !isNaN(v));
          const avg =
            rwtValues.length > 0
              ? (
                  rwtValues.reduce((a, b) => a + b, 0) / rwtValues.length
                ).toFixed(1)
              : 0;
          summary = `Avg RWT: ${avg} hrs | ${ticketsForDate.length} tickets`;
        } else if (metricKey === "frt" || metricKey === "avgFRT") {
          const frtValues = ticketsForDate
            .map((t) => t.frt)
            .filter((v) => v != null && !isNaN(v));
          const avg =
            frtValues.length > 0
              ? (
                  frtValues.reduce((a, b) => a + b, 0) / frtValues.length
                ).toFixed(1)
              : 0;
          summary = `Avg FRT: ${avg} hrs | ${ticketsForDate.length} tickets`;
        } else if (
          metricKey === "iterations" ||
          metricKey === "avgIterations"
        ) {
          const iterValues = ticketsForDate
            .map((t) => t.iterations)
            .filter((v) => v != null && !isNaN(v));
          const avg =
            iterValues.length > 0
              ? (
                  iterValues.reduce((a, b) => a + b, 0) / iterValues.length
                ).toFixed(1)
              : 0;
          summary = `Avg Iterations: ${avg} | ${ticketsForDate.length} tickets`;
        }

        // Map MongoDB fields to expected format
        const mappedTickets = ticketsForDate.map((t) => ({
          ...t,
          display_id: t.display_id || t.ticket_id,
          custom_fields: {
            tnt__rwt_business_hours: t.rwt,
            tnt__frt_hours: t.frt,
            tnt__iteration_count: t.iterations,
            tnt__csatrating: t.csat,
            tnt__frr: t.frr === 1,
            tnt__instance_account_name: t.account_name,
            tnt__region_salesforce: t.region,
          },
          stage: { name: "Solved" },
          owned_by: [{ display_name: t.owner }],
          actual_close_date: t.closed_date,
        }));

        setDrillDownData({
          title: `${getMetricLabel(metricKey)} - ${dataPointName}`,
          tickets: mappedTickets,
          metricKey,
          summary,
        });
      } catch (error) {
        // Show error - don't fall back to cache (it doesn't have old data)
        setDrillDownData({
          title: `${getMetricLabel(metricKey)} - ${dataPointName}`,
          tickets: [],
          metricKey,
          summary: `Error: ${error.message}`,
        });
      }
    },
    [
      volumeTickets,
      filters,
      excludeZendesk,
      excludeNOC,
      hasDependencyFilter,
      passesDependencyNarrowing,
      // Read by the Chart Drill Down event so it can report the scope the
      // drill-down happened in, not just which point was clicked.
      currentQuarter,
      groupBy,
    ],
  );

  // Helper function for metric labels
  const getMetricLabel = (metricKey) => {
    const labels = {
      volume: "Incoming Volume",
      solved: "Solved Tickets",
      rwt: "Avg Resolution Time",
      avgRWT: "Avg RWT",
      frt: "Avg First Response",
      avgFRT: "Avg FRT",
      backlog: "Backlog Cleared",
      csat: "CSAT",
      positiveCSAT: "Positive CSAT",
      frrPercent: "FRR Met",
      frr: "FRR Met",
      iterations: "Iterations",
      avgIterations: "Avg Iterations",
    };
    return labels[metricKey] || metricKey;
  };

  const [viewMode, setViewMode] = useState("gst");
  const [expandedMetric, setExpandedMetric] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [showTeam, setShowTeam] = useState(false);
  const [showGST, setShowGST] = useState(false);
  const [timeRange, setTimeRange] = useState(30);
  const [groupBy, setGroupBy] = useState("daily"); // daily, weekly, monthly
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const userDropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target)) {
        setUserDropdownOpen(false);
      }
    };
    if (userDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [userDropdownOpen]);

  const isDark = propIsDark !== undefined ? propIsDark : theme === "dark";




  const filteredTrends = useMemo(() => {
    const trends = analyticsData?.trends || [];
    return trends.filter((t) => {
      if (!t.date) return false;
      const trendDate = parseISO(t.date);
      return (
        trendDate >= effectiveDateRange.start &&
        trendDate <= effectiveDateRange.end
      );
    });
  }, [analyticsData, effectiveDateRange]);

  const serverTrends = analyticsData?.trends || [];

  const getExpandedOverviewData = useCallback(
    (metricKey) => {
      if (!filteredTrends.length) return [];

      const dataKeyMap = {
        avgRWT: "avgRWT",
        csat: "positiveCSAT",
        frrPercent: "frrPercent", // ✅ FIX: Use frrPercent instead of frrMet
        avgIterations: "avgIterations",
        avgFRT: "avgFRT",
      };

      const dataKey = dataKeyMap[metricKey] || "solved";

      return filteredTrends.map((t) => ({
        name: format(parseISO(t.date), "MMM dd"),
        date: t.date,
        value: t[dataKey] || 0,
      }));
    },
    [filteredTrends],
  );

  // Resolve current user to GST roster name
  // Resolve current user to GST roster name
  const resolvedCurrentUser = useMemo(() => {
    if (!currentUser?.name) return null;
    const cleanName = currentUser.name.toLowerCase().trim().split(" ")[0]; // Get first name only

    // First try exact match
    const exactMatch = Object.values(FLAT_TEAM_MAP).find(
      (name) => name.toLowerCase() === cleanName,
    );
    if (exactMatch) return exactMatch;

    // Then try partial match, but prefer longer matches to avoid Shreya matching Shreyas
    const matches = Object.values(FLAT_TEAM_MAP).filter(
      (name) =>
        cleanName.includes(name.toLowerCase()) ||
        name.toLowerCase().includes(cleanName),
    );

    // Sort by length descending - longer name = more specific match
    matches.sort((a, b) => b.length - a.length);

    return matches[0] || currentUser.name;
  }, [currentUser]);

  const isGSTUser = useMemo(
    () =>
      resolvedCurrentUser &&
      Object.values(FLAT_TEAM_MAP).includes(resolvedCurrentUser),
    [resolvedCurrentUser],
  );

  const isSuperAdmin = useMemo(() => {
    const email = currentUser?.email?.toLowerCase();
    return email
      ? SUPER_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email)
      : false;
  }, [currentUser]);

  const myTeamName = useMemo(() => {
    if (!resolvedCurrentUser) return null;

    const foundTeamKey = Object.keys(TEAM_GROUPS).find((groupKey) => {
      const members = Object.values(TEAM_GROUPS[groupKey]);
      return members.includes(resolvedCurrentUser);
    });

    // IMPORTANT: return null if no team found
    return foundTeamKey ? `Team ${foundTeamKey}` : null;
  }, [resolvedCurrentUser]);

  const selectedUserTeamName = useMemo(() => {
    if (selectedUsers.length === 0) return myTeamName;

    const firstUser = selectedUsers[0];
    const foundTeamKey = Object.keys(TEAM_GROUPS).find((groupKey) => {
      const members = Object.values(TEAM_GROUPS[groupKey]);
      return members.includes(firstUser);
    });

    return foundTeamKey ? `Team ${foundTeamKey}` : myTeamName;
  }, [selectedUsers, myTeamName]);
  // GST-only user list for dropdowns
  const gstUserNames = useMemo(() => Object.values(FLAT_TEAM_MAP).sort(), []);

  // Helper: format hour to 12-hour label
  const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => {
    if (h === 0) return "12 AM";
    if (h < 12) return `${h} AM`;
    if (h === 12) return "12 PM";
    return `${h - 12} PM`;
  });

  // When a dependency filter is active, the MongoDB rollups feeding the expanded
  // chart (individualTrends / trends) carry NO per-ticket dependency dimension, so
  // they'd render unfiltered totals. Rebuild a daily "trends"-shaped series from the
  // already-dependency-filtered ticket arrays (solvedTickets / volumeTickets) so the
  // expanded chart matches the KPI cards. Field/threshold definitions mirror the
  // Scenario-0 client-side stat calc (see filteredStats).
  const buildDepDailyTrends = useCallback(
    (metricKey) => {
      const start = expandedEffectiveDateRange.start;
      const end = expandedEffectiveDateRange.end;
      const byDate = {};
      const ensure = (key) =>
        (byDate[key] ||= {
          date: key,
          solved: 0,
          volume: 0,
          backlogCleared: 0,
          rwtSum: 0,
          rwtCount: 0,
          frtSum: 0,
          frtCount: 0,
          iterSum: 0,
          iterCount: 0,
          positiveCSAT: 0,
          negativeCSAT: 0,
          frrMet: 0,
        });

      if (metricKey === "volume") {
        // Volume is keyed by CREATED date (uses the created-in-range array).
        volumeTickets.forEach((t) => {
          if (!t.created_date) return;
          const d = parseISO(t.created_date);
          if (d < start || d > end) return;
          ensure(format(d, "yyyy-MM-dd")).volume += 1;
        });
      } else {
        // All other metrics are keyed by CLOSE date.
        solvedTickets.forEach((t) => {
          const closedDate = t.actual_close_date || t.closed_date;
          if (!closedDate) return;
          const d = parseISO(closedDate);
          if (d < start || d > end) return;
          const agg = ensure(format(d, "yyyy-MM-dd"));
          const cf = t.custom_fields || {};

          agg.solved += 1;
          if (cf.tnt__rwt_business_hours > 0) {
            agg.rwtSum += cf.tnt__rwt_business_hours;
            agg.rwtCount += 1;
          }
          if (cf.tnt__frt_hours > 0) {
            agg.frtSum += cf.tnt__frt_hours;
            agg.frtCount += 1;
          }
          if (cf.tnt__iteration_count > 0) {
            agg.iterSum += cf.tnt__iteration_count;
            agg.iterCount += 1;
          }
          if (Number(cf.tnt__csatrating) === 2) agg.positiveCSAT += 1;
          if (Number(cf.tnt__csatrating) === 1) agg.negativeCSAT += 1;
          if (cf.tnt__frr === true || cf.tnt__iteration_count === 1)
            agg.frrMet += 1;
          if (t.created_date) {
            const ageDays =
              (d.getTime() - parseISO(t.created_date).getTime()) /
              (1000 * 60 * 60 * 24);
            if (ageDays >= 15) agg.backlogCleared += 1;
          }
        });
      }

      // Emit trend objects in the exact shape the shared daily/weekly/monthly
      // grouping below expects. `solved` doubles as the generic value carrier for
      // the sum metrics whose dataKey resolves to "solved" (volume, solved, backlog).
      return Object.values(byDate)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map((a) => ({
          date: a.date,
          solved:
            metricKey === "volume"
              ? a.volume
              : metricKey === "backlog"
                ? a.backlogCleared
                : a.solved,
          avgRWT: a.rwtCount > 0 ? a.rwtSum / a.rwtCount : 0,
          avgFRT: a.frtCount > 0 ? a.frtSum / a.frtCount : 0,
          avgIterations: a.iterCount > 0 ? a.iterSum / a.iterCount : 0,
          positiveCSAT: a.positiveCSAT,
          negativeCSAT: a.negativeCSAT,
          frrMet: a.frrMet,
          frrPercent:
            a.solved > 0 ? Math.round((a.frrMet / a.solved) * 100) : 0,
        }));
    },
    [solvedTickets, volumeTickets, expandedEffectiveDateRange],
  );

  const getExpandedChartData = useCallback(
    (metricKey) => {
      // =====================================================
      // HOURLY VIEW — Only for volume metric
      // =====================================================
      if (expandedGroupBy === "hourly" && metricKey === "volume") {
        const start = expandedEffectiveDateRange.start;
        const end = expandedEffectiveDateRange.end;

        // Filter tickets in the expanded date range
        const rangeTickets = baseFilteredTickets.filter((t) => {
          if (!t.created_date) return false;
          const created = parseISO(t.created_date);
          return created >= start && created <= end;
        });

        // Count tickets per hour bucket (raw counts)
        const hourBuckets = Array.from({ length: 24 }, () => 0);
        rangeTickets.forEach((t) => {
          const hour = getHours(parseISO(t.created_date));
          hourBuckets[hour]++;
        });

        const totalDays = Math.max(1, differenceInDays(end, start) + 1);

        return hourBuckets.map((count, hour) => ({
          name: HOUR_LABELS[hour],
          hour,
          value: count,
          totalDays,
          hourRange: `${HOUR_LABELS[hour]} → ${HOUR_LABELS[(hour + 1) % 24]}`,
        }));
      }

      // Dependency filter active → the MongoDB rollups below have no dependency
      // dimension, so build the series from the already-filtered ticket arrays and
      // feed it through the shared daily/weekly/monthly grouping (fallback path).
      const depTrends = hasDependencyFilter ? buildDepDailyTrends(metricKey) : null;

      // =====================================================
      // When owner/team filter is active, aggregate from individualTrends
      // =====================================================
      const hasOwnerFilters =
        filters?.owners?.length > 0 || filters?.teams?.length > 0;

      if (!depTrends && hasOwnerFilters && analyticsData?.individualTrends) {
        const individualTrends = analyticsData.individualTrends;
        let ownersToInclude = Object.keys(individualTrends);

        // Filter by owners
        if (filters?.owners?.length > 0) {
          ownersToInclude = ownersToInclude.filter((owner) =>
            filters.owners.some((o) => o.toLowerCase() === owner.toLowerCase()),
          );
        }
        // Filter by teams
        if (filters?.teams?.length > 0) {
          ownersToInclude = ownersToInclude.filter((owner) => {
            const ownerTeams = Object.keys(TEAM_GROUPS).filter((teamKey) =>
              Object.values(TEAM_GROUPS[teamKey]).some(
                (m) => m.toLowerCase() === owner.toLowerCase(),
              ),
            );
            return filters.teams.some((team) => ownerTeams.includes(team));
          });
        }

        // Aggregate trends from filtered owners
        const aggregatedByDate = {};
        ownersToInclude.forEach((owner) => {
          const ownerTrends = individualTrends[owner] || [];
          ownerTrends.forEach((day) => {
            if (!aggregatedByDate[day.date]) {
              aggregatedByDate[day.date] = {
                date: day.date,
                solved: 0,
                avgRWT: 0,
                rwtCount: 0,
                avgFRT: 0,
                frtCount: 0,
                avgIterations: 0,
                iterCount: 0,
                positiveCSAT: 0,
                negativeCSAT: 0,
                frrMet: 0,
              };
            }
            const agg = aggregatedByDate[day.date];
            agg.solved += day.solved || 0;
            agg.positiveCSAT += day.positiveCSAT || 0;
            agg.negativeCSAT += day.negativeCSAT || 0;
            agg.frrMet += day.frrMet || 0;
            if (day.avgRWT > 0) {
              agg.avgRWT += day.avgRWT * (day.rwtValidCount || day.solved || 1);
              agg.rwtCount += day.rwtValidCount || day.solved || 1;
            }
            if (day.avgFRT > 0) {
              agg.avgFRT += day.avgFRT * (day.frtValidCount || day.solved || 1);
              agg.frtCount += day.frtValidCount || day.solved || 1;
            }
            if (day.avgIterations > 0) {
              agg.avgIterations +=
                day.avgIterations * (day.iterValidCount || day.solved || 1);
              agg.iterCount += day.iterValidCount || day.solved || 1;
            }
          });
        });

        // Convert to trends array format
        const trends = Object.values(aggregatedByDate).map((agg) => ({
          date: agg.date,
          solved: agg.solved,
          avgRWT: agg.rwtCount > 0 ? agg.avgRWT / agg.rwtCount : 0,
          avgFRT: agg.frtCount > 0 ? agg.avgFRT / agg.frtCount : 0,
          avgIterations:
            agg.iterCount > 0 ? agg.avgIterations / agg.iterCount : 0,
          positiveCSAT: agg.positiveCSAT,
          negativeCSAT: agg.negativeCSAT,
          frrMet: agg.frrMet,
          frrPercent: agg.solved > 0 ? Math.round((agg.frrMet / agg.solved) * 100) : 0,
        }));

        // Continue with existing logic using filtered trends...
        if (!trends.length) return [];

        const start = expandedEffectiveDateRange.start;
        const end = expandedEffectiveDateRange.end;

        const filteredData = trends.filter((t) => {
          if (!t.date) return false;
          const d = parseISO(t.date);
          return d >= start && d <= end;
        });

        const dataKeyMap = {
          avgRWT: "avgRWT",
          csat: "positiveCSAT",
          frrPercent: "frrPercent", // ✅ FIX: Use frrPercent instead of frrMet
          avgIterations: "avgIterations",
          avgFRT: "avgFRT",
        };
        const dataKey = dataKeyMap[metricKey] || "solved";

        if (expandedGroupBy === "daily") {
          return filteredData.map((t) => ({
            name: format(parseISO(t.date), "MMM dd"),
            date: t.date,
            value: t[dataKey] || 0,
            negativeCSAT: t.negativeCSAT || 0,
          }));
        }

        // Weekly/Monthly grouping (same logic as before)
        if (expandedGroupBy === "weekly") {
          const weeks = {};
          filteredData.forEach((t) => {
            // Use ISO week format: RRRR = ISO week-year, II = ISO week number
            const weekKey = format(parseISO(t.date), "RRRR-'W'II");
            if (!weeks[weekKey]) {
              weeks[weekKey] = {
                values: [],
                date: t.date,
                // ✅ FIX: Track raw counts for FRR percentage calculation
                frrMetCount: 0,
                solvedCount: 0,
                csatCount: 0,
              };
            }
            weeks[weekKey].values.push(t[dataKey] || 0);
            weeks[weekKey].frrMetCount += t.frrMet || 0;
            weeks[weekKey].solvedCount += t.solved || 0;
            weeks[weekKey].csatCount += t.positiveCSAT || 0;
          });
          return Object.entries(weeks)
            .sort((a, b) => new Date(a[1].date) - new Date(b[1].date))
            .map(([week, data]) => {
              // ✅ FIX: Calculate week date range for tooltip
              const [year, weekPart] = week.split("-W");
              const weekNum = parseInt(weekPart);
              const jan1 = new Date(parseInt(year), 0, 1);
              const jan1Day = jan1.getDay() || 7;
              let daysToMonday = jan1Day <= 4 ? 1 - jan1Day : 8 - jan1Day;
              const week1Monday = new Date(parseInt(year), 0, 1 + daysToMonday);
              const monday = new Date(week1Monday);
              monday.setDate(week1Monday.getDate() + (weekNum - 1) * 7);
              const sunday = new Date(monday);
              sunday.setDate(monday.getDate() + 6);
              const rangeLabel = `${format(monday, "MMM dd")} - ${format(sunday, "MMM dd")}`;

              // ✅ FIX: Calculate proper value - FRR needs special handling
              let value;
              if (["avgRWT", "avgFRT", "avgIterations"].includes(metricKey)) {
                value = data.values.reduce((a, b) => a + b, 0) / data.values.length;
              } else if (metricKey === "frrPercent") {
                // ✅ FIX: Recalculate FRR % from raw counts, NOT sum of percentages
                value = data.solvedCount > 0
                  ? Math.round((data.frrMetCount / data.solvedCount) * 100)
                  : 0;
              } else {
                value = data.values.reduce((a, b) => a + b, 0);
              }

              return {
                name: `Week ${week.split("W")[1]}`,
                range: rangeLabel, // ✅ Add date range for tooltip
                date: week,
                value,
              };
            });
        }

        // Monthly
        const months = {};
        filteredData.forEach((t) => {
          const monthKey = format(parseISO(t.date), "yyyy-MM");
          if (!months[monthKey]) {
            months[monthKey] = {
              values: [],
              date: t.date,
              monthKey,
              // ✅ FIX: Track raw counts for FRR percentage calculation
              frrMetCount: 0,
              solvedCount: 0,
              csatCount: 0,
            };
          }
          months[monthKey].values.push(t[dataKey] || 0);
          months[monthKey].frrMetCount += t.frrMet || 0;
          months[monthKey].solvedCount += t.solved || 0;
          months[monthKey].csatCount += t.positiveCSAT || 0;
        });
        return Object.entries(months)
          .sort((a, b) => new Date(a[1].date) - new Date(b[1].date))
          .map(([monthKey, data]) => {
            // ✅ FIX: Calculate proper value - FRR needs special handling
            let value;
            if (["avgRWT", "avgFRT", "avgIterations"].includes(metricKey)) {
              value = data.values.reduce((a, b) => a + b, 0) / data.values.length;
            } else if (metricKey === "frrPercent") {
              // ✅ FIX: Recalculate FRR % from raw counts, NOT sum of percentages
              value = data.solvedCount > 0
                ? Math.round((data.frrMetCount / data.solvedCount) * 100)
                : 0;
            } else {
              value = data.values.reduce((a, b) => a + b, 0);
            }

            return {
              name: format(parseISO(data.date), "MMM yyyy"),
              date: monthKey, // Use month key format (yyyy-MM) for drill-down
              value,
            };
          });
      }

      // Dependency-filtered series (client-side) takes precedence over the MongoDB
      // rollups, which don't carry a dependency dimension.
      const trends =
        depTrends ||
        (expandedAllTrends.length > 0
          ? expandedAllTrends
          : analyticsData?.trends || []);
      if (!trends.length) return [];

      // Use the effective date range (global or overridden)
      const start = expandedEffectiveDateRange.start;
      const end = expandedEffectiveDateRange.end;

      // Filter by date range
      const filteredData = trends.filter((t) => {
        if (!t.date) return false;
        const d = parseISO(t.date);
        return d >= start && d <= end;
      });

      const dataKeyMap = {
        avgRWT: "avgRWT",
        csat: "positiveCSAT",
        frrPercent: "frrPercent", // ✅ FIX: Use frrPercent instead of frrMet
        avgIterations: "avgIterations",
        avgFRT: "avgFRT",
      };
      const dataKey = dataKeyMap[metricKey] || "solved";

      // ✅ IDENTIFY SUM METRICS (CSAT, Volume, Solved)
      // NOTE: frrPercent is NOT a sum metric - it needs special handling (recalculate from counts)
      const isSumMetric = [
        "volume",
        "solved",
        "csat",
        "positiveCSAT",
        "backlog",
      ].includes(metricKey);

      // 1. DAILY VIEW
      if (expandedGroupBy === "daily") {
        return filteredData.map((t) => {
          let value = t[dataKey] || 0;

          // For FRR, calculate percentage: frrMet / solved * 100
          if (metricKey === "frrPercent" && t.solved > 0) {
            value = Math.round((t.frrMet / t.solved) * 100);
          }
          // ✅ FIX: For CSAT, show count (not percentage) to match KPI card
          if (metricKey === "csat") {
            value = t.positiveCSAT || 0;
          }

          return {
            name: format(parseISO(t.date), "MMM dd"),
            date: t.date,
            value,
            // Include raw counts for drill-down
            solved: t.solved,
            frrMet: t.frrMet,
            positiveCSAT: t.positiveCSAT,
            negativeCSAT: t.negativeCSAT || 0,
          };
        });
      }

      if (expandedGroupBy === "weekly") {
        const weeks = {};
        filteredData.forEach((t) => {
          // Use ISO week format: RRRR = ISO week-year, II = ISO week number
          const weekKey = format(parseISO(t.date), "RRRR-'W'II");
          if (!weeks[weekKey]) {
            weeks[weekKey] = {
              values: [],
              date: t.date,
              solvedCounts: [],
              frrMetCounts: [],
              csatCounts: [],
              negativeCSATCount: 0,
            };
          }
          weeks[weekKey].values.push(t[dataKey] || 0);
          weeks[weekKey].solvedCounts.push(t.solved || 0);
          weeks[weekKey].frrMetCounts.push(t.frrMet || 0);
          weeks[weekKey].csatCounts.push(t.positiveCSAT || 0);
          weeks[weekKey].negativeCSATCount += t.negativeCSAT || 0;
        });

        return Object.entries(weeks)
          .sort((a, b) => new Date(a[1].date) - new Date(b[1].date))
          .map(([week, data]) => {
            // ✅ FIX: Parse ISO week string (yyyy-Www) and calculate date range
            const [year, weekPart] = week.split("-W");
            const weekNum = parseInt(weekPart);

            // Calculate Monday of this ISO week
            const jan1 = new Date(parseInt(year), 0, 1);
            const jan1Day = jan1.getDay() || 7; // 1=Mon, 7=Sun

            // ISO week 1 is the first week with 4+ days in the new year
            let daysToMonday;
            if (jan1Day <= 4) {
              // Jan 1 is Mon-Thu: Week 1 starts on the Monday of that week
              daysToMonday = 1 - jan1Day;
            } else {
              // Jan 1 is Fri-Sun: Week 1 starts next Monday
              daysToMonday = 8 - jan1Day;
            }

            const week1Monday = new Date(parseInt(year), 0, 1 + daysToMonday);
            const monday = new Date(week1Monday);
            monday.setDate(week1Monday.getDate() + (weekNum - 1) * 7);

            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);

            const rangeLabel = `${format(monday, "MMM dd")} - ${format(sunday, "MMM dd")}`;

            // Fix sum definition
            const sum = data.values.reduce((a, b) => a + b, 0);

           // Calculate proper value based on metric type
            let value;
            if (["avgRWT", "avgFRT", "avgIterations"].includes(metricKey)) {
              // Average metrics
              value = sum / (data.values.length || 1);
            } else if (metricKey === "frrPercent") {
              // FRR percentage: need total frrMet / total solved
              const totalSolved =
                data.solvedCounts?.reduce((a, b) => a + b, 0) || 0;
              const totalFrrMet =
                data.frrMetCounts?.reduce((a, b) => a + b, 0) || 0;
              value =
                totalSolved > 0
                  ? Math.round((totalFrrMet / totalSolved) * 100)
                  : 0;
            } else if (metricKey === "csat") {
              // ✅ FIX: CSAT count (not percentage)
              const totalCSAT =
                data.csatCounts?.reduce((a, b) => a + b, 0) || 0;
              value = totalCSAT;
            } else {
              // Sum metrics (solved, volume, backlog)
              value = sum;
            }

            return {
              name: `Week ${week.split("W")[1]}`,
              range: rangeLabel,
              date: week, // Use week key format (yyyy-Www) for drill-down
              value,
              negativeCSAT: data.negativeCSATCount || 0,
            };
          });
      }

      // 3. MONTHLY VIEW
      if (expandedGroupBy === "monthly") {
        const months = {};
        filteredData.forEach((t) => {
          const monthKey = format(parseISO(t.date), "yyyy-MM");
          if (!months[monthKey]) {
            months[monthKey] = {
              values: [],
              date: t.date,
              // ✅ FIX: Track raw counts for FRR percentage calculation
              solvedCounts: [],
              frrMetCounts: [],
              csatCounts: [],
              negativeCSATCount: 0,
            };
          }
          months[monthKey].values.push(t[dataKey] || 0);
          months[monthKey].solvedCounts.push(t.solved || 0);
          months[monthKey].frrMetCounts.push(t.frrMet || 0);
          months[monthKey].csatCounts.push(t.positiveCSAT || 0);
          months[monthKey].negativeCSATCount += t.negativeCSAT || 0;
        });

        return Object.entries(months)
          .sort((a, b) => new Date(a[1].date) - new Date(b[1].date))
          .map(([monthKey, data]) => {
            const sum = data.values.reduce((a, b) => a + b, 0);

            // ✅ FIX: Calculate proper value based on metric type
            let value;
            if (["avgRWT", "avgFRT", "avgIterations"].includes(metricKey)) {
              // Average metrics
              value = sum / (data.values.length || 1);
            } else if (metricKey === "frrPercent") {
              // ✅ FIX: FRR percentage - recalculate from raw counts, NOT sum percentages
              const totalSolved = data.solvedCounts?.reduce((a, b) => a + b, 0) || 0;
              const totalFrrMet = data.frrMetCounts?.reduce((a, b) => a + b, 0) || 0;
              value = totalSolved > 0 ? Math.round((totalFrrMet / totalSolved) * 100) : 0;
            } else if (metricKey === "csat") {
              // CSAT count (not percentage)
              value = data.csatCounts?.reduce((a, b) => a + b, 0) || 0;
            } else {
              // Sum metrics (solved, volume, backlog)
              value = sum;
            }

            return {
              name: format(parseISO(data.date), "MMM yyyy"),
              date: monthKey, // Use month key format (yyyy-MM) for drill-down
              value,
              negativeCSAT: data.negativeCSATCount || 0,
            };
          });
      }

      return [];
    },
    [
      analyticsData?.trends,
      analyticsData?.individualTrends,
      expandedAllTrends,
      expandedEffectiveDateRange,
      expandedGroupBy,
      filters?.owners,
      filters?.teams,
      excludeNOC,
      baseFilteredTickets,
      hasDependencyFilter,
      buildDepDailyTrends,
    ],
  );

  // Get average
  const getExpandedAverage = useCallback(
    (metricKey) => {
      const chartData = getExpandedChartData(metricKey);
      if (!chartData.length) return "—";

      const avg =
        chartData.reduce((sum, d) => sum + (d.value || 0), 0) /
        chartData.length;
      return avg.toFixed(2);
    },
    [getExpandedChartData],
  );

  // Get trend (comparing first half vs second half)
  const getExpandedTrend = useCallback(
    (metricKey) => {
      const chartData = getExpandedChartData(metricKey);
      if (chartData.length < 2) return { value: "—", isPositive: true };

      const mid = Math.floor(chartData.length / 2);
      const firstHalf = chartData.slice(0, mid);
      const secondHalf = chartData.slice(mid);

      const firstAvg =
        firstHalf.reduce((s, d) => s + d.value, 0) / firstHalf.length;
      const secondAvg =
        secondHalf.reduce((s, d) => s + d.value, 0) / secondHalf.length;

      if (firstAvg === 0) return { value: "—", isPositive: true };

      const change = (((secondAvg - firstAvg) / firstAvg) * 100).toFixed(1);

      // For RWT/FRT, lower is better
      const lowerIsBetter = ["avgRWT", "avgFRT", "avgIterations"].includes(
        metricKey,
      );
      const isPositive = lowerIsBetter ? change < 0 : change > 0;

      return {
        value: `${change > 0 ? "+" : ""}${change}%`,
        isPositive,
      };
    },
    [getExpandedChartData],
  );

  // Calculate overview metric total for selected users
  const calculateOverviewTotal = useCallback(
    (metricKey) => {
      if (!analyticsData?.individualTrends || selectedUsers.length === 0)
        return "—";

      let total = 0;
      let count = 0;

      selectedUsers.forEach((user) => {
        const userTrends = analyticsData.individualTrends[user] || [];
        userTrends.slice(-timeRange).forEach((day) => {
          if (metricKey === "avgRWT" || metricKey === "avgFRT") {
            total += day.avgRWT || day.avgFRT || 0;
            count++;
          } else if (metricKey === "csat") {
            total += day.positiveCSAT || 0;
          } else {
            total += day.solved || 0;
          }
        });
      });

      if (metricKey === "avgRWT" || metricKey === "avgFRT") {
        return count > 0 ? (total / count).toFixed(2) : "0";
      }
      return total;
    },
    [analyticsData, selectedUsers, timeRange],
  );

  // Calculate team average
  const calculateTeamAverage = useCallback(
    (metricKey) => {
      if (!analyticsData?.individualTrends) return "—";

      const teamMembers = TEAM_GROUPS[myTeamName?.replace("Team ", "")]
        ? Object.values(TEAM_GROUPS[myTeamName.replace("Team ", "")])
        : [];

      let total = 0;
      let count = 0;

      teamMembers.forEach((member) => {
        const memberTrends = analyticsData.individualTrends[member] || [];
        memberTrends.slice(-timeRange).forEach((day) => {
          total += day[OVERVIEW_METRICS[metricKey]?.dataKey] || day.solved || 0;
          count++;
        });
      });

      return count > 0 ? (total / count).toFixed(2) : "0";
    },
    [analyticsData, myTeamName, timeRange],
  );

  // Calculate GST average
  const calculateGSTAverage = useCallback(
    (metricKey) => {
      if (!analyticsData?.individualTrends) return "—";

      let total = 0;
      let count = 0;

      Object.values(analyticsData.individualTrends).forEach((userTrends) => {
        userTrends.slice(-timeRange).forEach((day) => {
          total += day[OVERVIEW_METRICS[metricKey]?.dataKey] || day.solved || 0;
          count++;
        });
      });

      return count > 0 ? (total / count).toFixed(2) : "0";
    },
    [analyticsData, timeRange],
  );

  // Get chart data for overview metric
  const getOverviewChartData = useCallback(
    (metricKey) => {
      if (!analyticsData?.individualTrends) return [];

      const allDates = new Set();
      Object.values(analyticsData.individualTrends).forEach((userTrends) => {
        userTrends.forEach((day) => allDates.add(day.date));
      });

      const sortedDates = Array.from(allDates).sort().slice(-timeRange);
      const dataKey = OVERVIEW_METRICS[metricKey]?.dataKey || "solved";

      return sortedDates.map((date) => {
        const point = {
          name: format(
            parseISO(date),
            groupBy === "monthly" ? "MMM" : "MMM dd",
          ),
          date,
        };

        // Add selected users data
        selectedUsers.forEach((user) => {
          const userDay = (analyticsData.individualTrends[user] || []).find(
            (d) => d.date === date,
          );
          point[user] = userDay?.[dataKey] || userDay?.solved || 0;
        });

        // Add team average
        if (showTeam) {
          const teamMembers = TEAM_GROUPS[myTeamName?.replace("Team ", "")]
            ? Object.values(TEAM_GROUPS[myTeamName.replace("Team ", "")])
            : [];
          let teamTotal = 0;
          teamMembers.forEach((member) => {
            const memberDay = (
              analyticsData.individualTrends[member] || []
            ).find((d) => d.date === date);
            teamTotal += memberDay?.[dataKey] || memberDay?.solved || 0;
          });
          point.team =
            teamMembers.length > 0 ? teamTotal / teamMembers.length : 0;
        }

        // Add GST average
        if (showGST) {
          let gstTotal = 0;
          let gstCount = 0;
          Object.entries(analyticsData.individualTrends).forEach(
            ([user, days]) => {
              const dayData = days.find((d) => d.date === date);
              if (dayData) {
                gstTotal += dayData[dataKey] || dayData.solved || 0;
                gstCount++;
              }
            },
          );
          point.gst = gstCount > 0 ? gstTotal / gstCount : 0;
        }

        return point;
      });
    },
    [
      analyticsData,
      selectedUsers,
      timeRange,
      groupBy,
      showTeam,
      showGST,
      myTeamName,
    ],
  );

  // Initialize selected users with current user if GST
  useEffect(() => {
    if (isGSTUser && resolvedCurrentUser && selectedUsers.length === 0) {
      setSelectedUsers([resolvedCurrentUser]);
    }
  }, [isGSTUser, resolvedCurrentUser]);

  // Fetch server-side analytics with debouncing to prevent constant refreshes
  useEffect(() => {
    // Debounce the fetch to prevent rapid re-fetches on filter changes
    const timeoutId = setTimeout(() => {
      const hasCohortFilter = filters?.cohorts?.length > 0;
      fetchAnalyticsData({
        quarter: currentQuarter,
        excludeZendesk,
        excludeNOC,
        owner: filterOwner !== "All" ? filterOwner : null,
        cohorts: hasCohortFilter ? filters.cohorts.join(",") : null,
        groupBy,
        forceRefresh: hasCohortFilter,
        resolvedBy: filters?.resolvedBy,
      });
    }, 150); // 150ms debounce

    return () => clearTimeout(timeoutId);
    // Note: fetchAnalyticsData is stable from Zustand store, but we omit it to prevent potential loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentQuarter,
    excludeZendesk,
    excludeNOC,
    filterOwner,
    filters?.cohorts,
    filters?.resolvedBy,
    groupBy,
  ]);
  // Fetch expanded trends only when modal is open, with debouncing
  useEffect(() => {
    if (!expandedOverviewMetric) return;

    const fetchAllTrends = async () => {
      setExpandedLoading(true);
      try {
        const API_BASE = import.meta.env.VITE_API_URL || "";

        // Build params with filters
        const buildParams = (quarter) => {
          const params = new URLSearchParams({ quarter });
          if (excludeZendesk) params.set("excludeZendesk", "true");
          if (excludeNOC) params.set("excludeNOC", "true");
          // Add owner filter if teams selected
          if (filters?.teams?.length > 0) {
            const teamMembers = [];
            filters.teams.forEach((teamKey) => {
              if (TEAM_GROUPS[teamKey]) {
                teamMembers.push(...Object.values(TEAM_GROUPS[teamKey]));
              }
            });
            if (teamMembers.length > 0) {
              params.set("owners", teamMembers.join(","));
            }
          }
          if (filters?.owners?.length > 0) {
            params.set("owners", filters.owners.join(","));
          }
          // resolvedBy: only forward when exactly one option is selected.
          if (Array.isArray(filters?.resolvedBy) && filters.resolvedBy.length === 1) {
            params.set("resolvedBy", filters.resolvedBy[0]);
          }
          return params.toString();
        };

        const quarterResults = await Promise.all(
          QUARTERS.map((q) =>
            authFetch(
              `${API_BASE}/api/tickets/analytics?${buildParams(q.id)}`,
            ).then((r) => r.json()),
          ),
        );

        // Combine trends from all quarters
        const allTrends = quarterResults.flatMap((r) => r.trends || []);

        // Sort by date
        allTrends.sort((a, b) => new Date(a.date) - new Date(b.date));

        // Remove duplicates (by date)
        const uniqueTrends = allTrends.filter(
          (t, i, arr) => i === 0 || t.date !== arr[i - 1].date,
        );

        setExpandedAllTrends(uniqueTrends);
      } catch (e) {
        // silently ignore
      } finally {
        setExpandedLoading(false);
      }
    };

    // Debounce to prevent rapid re-fetches
    const timeoutId = setTimeout(fetchAllTrends, 200);
    return () => clearTimeout(timeoutId);
  }, [
    expandedOverviewMetric,
    excludeZendesk,
    filters?.teams,
    filters?.owners,
    filters?.resolvedBy,
    excludeNOC,
    currentQuarter,
  ]);

  const handleQuarterChange = useCallback(
    (quarter) => {
      // Sync the date filter to the selected quarter so effectiveDateRange uses correct dates
      // Must use format() (local time) — NOT toISOString() (UTC) — to match SmartDateRangePicker presets
      const { start, end } = getQuarterDatesFromConfig(quarter);
      // THIS is the live quarter-change path. The identical handler in
      // PerformanceOverview.jsx is unreferenced dead code, which is why the
      // old "Analytics Quarter Changed" event never fired.
      track(EV.ANALYTICS_PERIOD_CHANGED, {
        "Period Kind": "quarter",
        Quarter: quarter,
        "Previous Quarter": currentQuarter,
        "Is Current": quarter === getCurrentQuarterKey(),
        Surface: "analytics",
      });
      onFilterChange?.("dateRange", {
        start: format(start, "yyyy-MM-dd"),
        end: format(end, "yyyy-MM-dd"),
      });

      setExpandedAllTrends([]);
      setExpandedDateRange(null);
      setCurrentQuarter(quarter);
    },
    [onFilterChange, currentQuarter],
  );
  const handleRefresh = () => {
    track(EV.SYNC_TRIGGERED, { Source: "analytics refresh", Quarter: currentQuarter, "Group By": groupBy });
    return fetchAnalyticsData({
      quarter: currentQuarter,
      excludeZendesk,
      excludeNOC,
      owner: filterOwner !== "All" ? filterOwner : null,
      cohorts: filters?.cohorts?.length > 0 ? filters.cohorts.join(",") : null,
      groupBy,
      forceRefresh: true,
      resolvedBy: filters?.resolvedBy,
    });
  };

  const smallChartData = useMemo(
    () =>
      buildSmallChartData({
        volumeTickets,
        solvedTickets,
        effectiveDateRange,
        analyticsData,
        hasDependencyFilter,
        filters,
      }),
    [
      volumeTickets,
      solvedTickets,
      hasDependencyFilter,
      effectiveDateRange,
      analyticsData,
      filters,
      excludeNOC,
    ]);

  const filteredStats = useMemo(
    () =>
      computeFilteredStats({
        analyticsData,
        solvedTickets,
        solvedTicketsForCSAT,
        effectiveDateRange,
        hasDependencyFilter,
        filters,
      }),
    [
      analyticsData,
      volumeTickets,
      solvedTickets,
      solvedTicketsForCSAT,
      filters,
      hasDependencyFilter,
      effectiveDateRange,
      excludeNOC,
      dependencies,
    ]);

  // isAverageMetric + aggregateData live in analytics/lib/aggregate.js.
  // Kept as a useCallback with an empty dep array so its identity stays
  // stable across renders, exactly as before — expandedData depends on it.
  const aggregateData = useCallback(
    (dailyData, groupMode, metric, users) =>
      aggregateDataFn(dailyData, groupMode, metric, users),
    [],
  );

  // Expanded chart data
  const expandedData = useMemo(
    () =>
      buildExpandedData({
        expandedMetric,
        analyticsData,
        effectiveDateRange,
        expandedEffectiveDateRange,
        expandedGroupBy,
        selectedUsers,
        selectedUserTeamName,
        showTeam,
        showGST,
        HOUR_LABELS,
        tickets,
      }),
    [
      analyticsData,
      expandedMetric,
      selectedUsers,
      showTeam,
      showGST,
      selectedUserTeamName,
      tickets,
      effectiveDateRange,
      expandedEffectiveDateRange,
      expandedGroupBy,
      aggregateData,
    ]);

  const colors = {
    grid: isDark ? "#1e293b" : "#f1f5f9",
    text: isDark ? "#94a3b8" : "#64748b",
    tooltipBg: isDark ? "#0f172a" : "#ffffff",
  };

  return (
    <div className="space-y-6 p-6 max-w-[1600px] mx-auto">
      {/* Dependency filter is applied client-side against a live-fetched map that
          loads asynchronously. While it's still loading we HOLD the has/no
          narrowing (show everything) so nothing is wrongly excluded, and tell the
          user the numbers are provisional. */}
      {hasDependencyFilter && (mongoSolved.loading || !dependencyDataReady) && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400">
          <RefreshCw className="w-4 h-4 animate-spin" />
          {mongoSolved.loading
            ? "Loading the solved-ticket history for this range — dependency-filtered numbers will settle in a moment."
            : `Loading dependency data for ${pendingDependencyCount} ticket${
                pendingDependencyCount === 1 ? "" : "s"
              } — the dependency filter will apply once loaded (showing all tickets meanwhile).`}
        </div>
      )}

      {/* GST/Global Toggle - ONLY FOR SUPER ADMIN */}
      {isSuperAdmin && (
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setViewMode("gst")}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
                viewMode === "gst"
                  ? "bg-white dark:bg-slate-700 text-indigo-600 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              <Users className="w-4 h-4" /> GST View
            </button>
            <button
              onClick={() => setViewMode("global")}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
                viewMode === "global"
                  ? "bg-white dark:bg-slate-700 text-emerald-600 shadow-sm"
                  : "text-slate-500"
              }`}
            >
              <Globe className="w-4 h-4" /> Global View
            </button>

          </div>
        </div>
      )}

      {/* Show skeleton while loading, actual cards when data is ready */}
      {analyticsLoading && !analyticsData ? (
        <PerformanceOverviewSkeleton />
      ) : (
        <PerformanceMetricsCards
          stats={filteredStats}
          trends={filteredTrends}
          currentQuarter={currentQuarter}
          currentGroupBy={groupBy}
          onQuarterChange={handleQuarterChange}
          excludeZendesk={excludeZendesk}
          onExcludeZendeskChange={() => setExcludeZendesk(!excludeZendesk)}
          excludeNOC={excludeNOC}
          onExcludeNOCChange={() => setExcludeNOC(!excludeNOC)}
          onRefresh={handleRefresh}
          isRefreshing={analyticsLoading}
          onExpandMetric={(metricKey) => {
            track(EV.METRIC_EXPANDED, {
              Metric: metricKey,
              Quarter: currentQuarter,
              "Group By": groupBy,
            });
            setExpandedOverviewMetric(metricKey);
          }}
          onGroupByChange={(newGroupBy) => {
            setGroupBy(newGroupBy);
            // If it's a week/month sub-range (e.g. "Q2_26_W1"), set parent quarter
            const qMatch = newGroupBy.match(/^(Q[1-4]_\d{2})_[WM]/);
            if (qMatch) {
              setCurrentQuarter(qMatch[1]);
            }
            fetchAnalyticsData({
              quarter: qMatch ? newGroupBy : currentQuarter,
              excludeZendesk,
              owner: filterOwner !== "All" ? filterOwner : null,
              groupBy: newGroupBy,
              resolvedBy: filters?.resolvedBy,
            });
          }}
          isLoading={analyticsLoading}
        />
      )}

      {/* 4 METRIC CHARTS */}
      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mt-8 mb-4 flex items-center gap-2 animate-fade-in">
        <Activity className="w-5 h-5 text-indigo-500" /> Performance Analytics
      </h2>

      {analyticsLoading && !analyticsData ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <ChartSkeleton key={i} height="200px" />
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(METRICS).map(([key, config], index) => (
          <div
            key={key}
            className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 relative group hover:border-indigo-500/30 hover:shadow-lg transition-all duration-300 animate-slide-up"
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
                  <config.icon
                    className="w-4 h-4"
                    style={{ color: config.color }}
                  />{" "}
                  {config.label}
                </h3>
                <p className="text-xs text-slate-500">{config.desc}</p>
              </div>
              <button
                onClick={() => {
                  setExpandedMetric(key);
                  setShowTeam(false);
                  setShowGST(false);
                }}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 hover:text-indigo-500 transition-colors"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>

            <div className="h-[160px] w-full text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={smallChartData[key]}>
                  <defs>
                    <linearGradient
                      id={`grad-${key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor={config.color}
                        stopOpacity={0.2}
                      />
                      <stop
                        offset="95%"
                        stopColor={config.color}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={colors.grid}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: colors.text, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={20}
                  />
                  <YAxis
                    tick={{ fill: colors.text, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <RechartsTooltip
                    formatter={(value) => [`${value}`, config.desc]}
                    contentStyle={{
                      backgroundColor: colors.tooltipBg,
                      borderRadius: "12px",
                      border: "none",
                      boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
                      padding: "12px 16px",
                    }}
                    labelFormatter={(label, payload) => {
                      // ✅ Show date range if available (Weekly view)
                      if (payload && payload[0] && payload[0].payload?.range) {
                        return `${label} (${payload[0].payload.range})`;
                      }
                      return label;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="main"
                    stroke={config.color}
                    fill={`url(#grad-${key})`}
                    strokeWidth={2}
                    activeDot={{
                      r: 6,
                      cursor: "pointer",
                      onClick: (e, payload) => {
                        if (payload?.payload?.date) {
                          handleDrillDown(
                            key,
                            payload.payload.date,
                            payload.payload.name,
                            payload.payload,
                          );
                        }
                      },
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* NOC Analytics Section - Shows all NOC tickets raised by GST */}
      <NOCAnalytics isLoading={analyticsLoading} />

      {/* CSAT + DSAT */}
      {/* Change: 'lg:grid-cols-2' -> 'grid-cols-1' to make them full width & stacked */}
      <div className="grid grid-cols-1 gap-6">
        <CSATLeaderboard
          leaderboard={analyticsData?.leaderboard}
          isLoading={analyticsLoading}
        />

        <DSATAlerts
          badTickets={tickets.filter((t) => getCSATStatus(t) === "Bad")}
          isLoading={analyticsLoading}
          // Change: Combine permission check with your viewMode toggle
          isGSTUser={isGSTUser && viewMode === "gst"}
        />
      </div>

      {/* EXPANDED OVERVIEW METRIC MODAL - FULL FEATURED */}
      {expandedOverviewMetric && OVERVIEW_METRICS[expandedOverviewMetric] && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div
            className="absolute inset-0"
            onClick={() => setExpandedOverviewMetric(null)}
          />

          <div className="bg-white dark:bg-slate-900 w-[95vw] max-w-7xl h-[90vh] rounded-3xl shadow-2xl relative flex flex-col z-10 overflow-hidden border border-slate-200 dark:border-slate-800">
            {/* Header */}
            <div className="px-8 py-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
              <div className="flex items-center gap-4">
                <div
                  className="p-4 rounded-2xl"
                  style={{
                    backgroundColor: `${OVERVIEW_METRICS[expandedOverviewMetric].color}15`,
                  }}
                >
                  {React.createElement(
                    OVERVIEW_METRICS[expandedOverviewMetric].icon,
                    {
                      className: "w-8 h-8",
                      style: {
                        color: OVERVIEW_METRICS[expandedOverviewMetric].color,
                      },
                    },
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-800 dark:text-white">
                    {OVERVIEW_METRICS[expandedOverviewMetric].fullLabel}
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {OVERVIEW_METRICS[expandedOverviewMetric].desc}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setExpandedOverviewMetric(null);
                  setExpandedDateRange(null); // Reset to use global
                }}
                className="p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>

            {/* Controls Bar */}
            <div className="px-8 py-4 bg-slate-50/80 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-4">
              {/* Date Range Picker - Same as global */}
              <SmartDateRangePicker
                value={expandedDateRange || filters?.dateRange}
                onChange={(val) => setExpandedDateRange(val)}
              />

              {/* Grouping Toggle */}
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                {[...(expandedOverviewMetric === "volume" ? ["hourly"] : []), "daily", "weekly", "monthly"].map((g) => (
                  <button
                    key={g}
                    onClick={() => setExpandedGroupBy(g)}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                      expandedGroupBy === g
                        ? g === "hourly" ? "bg-indigo-600 text-white shadow-sm" : "bg-white dark:bg-slate-700 text-indigo-600 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {g === "hourly" ? "⏰ Hourly Avg" : g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>

              {/* Date Range Display */}
              {/* Date Range Display */}
              <div className="ml-auto text-sm text-slate-500 flex items-center gap-2">
                <span className="font-medium">
                  {expandedEffectiveDateRange.days || effectiveDateRange.days}{" "}
                  days
                </span>
                <span>•</span>
                <span>
                  {format(
                    expandedEffectiveDateRange.start ||
                      effectiveDateRange.start,
                    "MMM dd",
                  )}{" "}
                  -{" "}
                  {format(
                    expandedEffectiveDateRange.end || effectiveDateRange.end,
                    "MMM dd, yyyy",
                  )}
                </span>
              </div>
            </div>

            {/* Simplified Summary */}
            <div className="px-8 py-3 bg-slate-50 dark:bg-slate-800/30 flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Current:</span>
                <span
                  className="font-bold"
                  style={{
                    color: OVERVIEW_METRICS[expandedOverviewMetric].color,
                  }}
                >
                  {filteredStats[
                    OVERVIEW_METRICS[expandedOverviewMetric].dataKey
                  ] || "—"}
                  {OVERVIEW_METRICS[expandedOverviewMetric].unit}
                </span>
              </div>
              <div className="w-px h-4 bg-slate-300 dark:bg-slate-600" />
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Avg:</span>
                <span className="font-bold text-slate-700 dark:text-slate-300">
                  {getExpandedAverage(expandedOverviewMetric)}
                </span>
              </div>
              <div className="w-px h-4 bg-slate-300 dark:bg-slate-600" />
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Trend:</span>
                <span
                  className={`font-bold flex items-center gap-1 ${getExpandedTrend(expandedOverviewMetric).isPositive ? "text-emerald-500" : "text-rose-500"}`}
                >
                  {getExpandedTrend(expandedOverviewMetric).value}
                  {getExpandedTrend(expandedOverviewMetric).isPositive ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : (
                    <TrendingDown className="w-4 h-4" />
                  )}
                </span>
              </div>
              <div className="ml-auto text-xs text-slate-400">
                Click any point to drill down
              </div>
            </div>

            {/* Main Chart Area */}
            <div className="flex-1 px-8 py-6 overflow-auto">
              <div className="h-full min-h-[450px]">
                {expandedGroupBy === "hourly" && expandedOverviewMetric === "volume" ? (
                  /* =============== HOURLY BAR CHART =============== */
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={getExpandedChartData(expandedOverviewMetric)}
                      margin={{ top: 20, right: 30, left: 20, bottom: 30 }}
                      barCategoryGap="12%"
                    >
                      <defs>
                        {/* Peak hour gradient (high values) */}
                        <linearGradient id="hourlyBarPeak" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6366f1" stopOpacity={1} />
                          <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.8} />
                        </linearGradient>
                        {/* Normal hour gradient */}
                        <linearGradient id="hourlyBarNormal" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#818cf8" stopOpacity={0.7} />
                          <stop offset="100%" stopColor="#a5b4fc" stopOpacity={0.4} />
                        </linearGradient>
                        {/* Low hour gradient */}
                        <linearGradient id="hourlyBarLow" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#c7d2fe" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="#e0e7ff" stopOpacity={0.3} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke={isDark ? "#334155" : "#e2e8f0"}
                      />
                      <XAxis
                        dataKey="name"
                        tick={{
                          fill: isDark ? "#94a3b8" : "#64748b",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                        axisLine={{ stroke: isDark ? "#334155" : "#e2e8f0" }}
                        tickLine={false}
                        dy={15}
                        interval={0}
                      />
                      <YAxis
                        tick={{
                          fill: isDark ? "#94a3b8" : "#64748b",
                          fontSize: 12,
                          fontWeight: 500,
                        }}
                        axisLine={false}
                        tickLine={false}
                        dx={-10}
                        label={{
                          value: "Tickets Created",
                          angle: -90,
                          position: "insideLeft",
                          style: {
                            fill: isDark ? "#64748b" : "#94a3b8",
                            fontSize: 12,
                            fontWeight: 600,
                          },
                        }}
                      />
                      <RechartsTooltip
                        cursor={{ fill: isDark ? "rgba(99,102,241,0.1)" : "rgba(99,102,241,0.06)" }}
                        contentStyle={{
                          backgroundColor: isDark ? "#1e293b" : "#ffffff",
                          border: "none",
                          borderRadius: "16px",
                          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
                          padding: "16px 20px",
                        }}
                        labelStyle={{
                          fontWeight: "bold",
                          fontSize: "14px",
                          marginBottom: "8px",
                          color: isDark ? "#fff" : "#1e293b",
                        }}
                        labelFormatter={(label, payload) => {
                          const data = payload?.[0]?.payload;
                          return data?.hourRange || label;
                        }}
                        formatter={(value, name, props) => {
                          const data = props?.payload;
                          return [
                            <span>
                              <span className="text-lg font-bold text-indigo-600">
                                {value} <span className="text-sm font-medium text-slate-400">tickets</span>
                              </span>
                              <span className="block text-xs text-slate-400 mt-1">
                                Over {data?.totalDays} days in selected range
                              </span>
                            </span>,
                            "Volume",
                          ];
                        }}
                      />
                      <Bar
                        dataKey="value"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={40}
                      >
                        {(() => {
                          const chartData = getExpandedChartData(expandedOverviewMetric);
                          const maxVal = Math.max(...chartData.map(d => d.value));
                          return chartData.map((entry, index) => {
                            const ratio = maxVal > 0 ? entry.value / maxVal : 0;
                            let fill;
                            if (ratio >= 0.7) fill = "url(#hourlyBarPeak)";
                            else if (ratio >= 0.3) fill = "url(#hourlyBarNormal)";
                            else fill = "url(#hourlyBarLow)";
                            return <Cell key={index} fill={fill} />;
                          });
                        })()}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  /* =============== STANDARD AREA CHART =============== */
                  <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={getExpandedChartData(expandedOverviewMetric)}
                    margin={{ top: 20, right: 30, left: 20, bottom: 30 }}
                  >
                    <defs>
                      <linearGradient
                        id="expandedAreaGrad"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor={
                            OVERVIEW_METRICS[expandedOverviewMetric].color
                          }
                          stopOpacity={0.4}
                        />
                        <stop
                          offset="100%"
                          stopColor={
                            OVERVIEW_METRICS[expandedOverviewMetric].color
                          }
                          stopOpacity={0.05}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke={isDark ? "#334155" : "#e2e8f0"}
                    />
                    <XAxis
                      dataKey="name"
                      tick={{
                        fill: isDark ? "#94a3b8" : "#64748b",
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                      axisLine={{ stroke: isDark ? "#334155" : "#e2e8f0" }}
                      tickLine={false}
                      dy={15}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{
                        fill: isDark ? "#94a3b8" : "#64748b",
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                      axisLine={false}
                      tickLine={false}
                      dx={-10}
                      tickFormatter={(val) => val.toLocaleString()}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: isDark ? "#1e293b" : "#ffffff",
                        border: "none",
                        borderRadius: "16px",
                        boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
                        padding: "16px 20px",
                      }}
                      labelStyle={{
                        fontWeight: "bold",
                        fontSize: "14px",
                        marginBottom: "8px",
                        color: isDark ? "#fff" : "#1e293b",
                      }}
                      labelFormatter={(label, payload) => {
                        // ✅ FIX: Show date range if available (Weekly view)
                        if (payload && payload[0] && payload[0].payload.range) {
                          return `${label} (${payload[0].payload.range})`;
                        }
                        return label;
                      }}
                      formatter={(value, name, props) => {
                        // CSAT and FRR should be integers, others can have decimals
                        const isIntegerMetric = ["csat", "frrPercent"].includes(
                          expandedOverviewMetric,
                        );
                        const displayValue =
                          typeof value === "number"
                            ? isIntegerMetric
                              ? Math.round(value)
                              : value.toFixed(2)
                            : value;
                        const dsatCount = props?.payload?.negativeCSAT || 0;
                        return [
                          <span>
                            <span
                              className="text-lg font-bold"
                              style={{
                                color:
                                  OVERVIEW_METRICS[expandedOverviewMetric].color,
                              }}
                            >
                              {displayValue}{" "}
                              {OVERVIEW_METRICS[expandedOverviewMetric].unit}
                            </span>
                            {expandedOverviewMetric === "csat" && dsatCount > 0 && (
                              <span className="block text-sm font-semibold text-red-500 mt-1">
                                {dsatCount} DSAT
                              </span>
                            )}
                          </span>,
                          OVERVIEW_METRICS[expandedOverviewMetric].label,
                        ];
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={OVERVIEW_METRICS[expandedOverviewMetric].color}
                      fill="url(#expandedAreaGrad)"
                      strokeWidth={3}
                      dot={(props) => {
                        const { cx, cy, payload } = props;
                        const hasDSAT = expandedOverviewMetric === "csat" && payload?.negativeCSAT > 0;
                        return (
                          <circle
                            cx={cx}
                            cy={cy}
                            r={hasDSAT ? 6 : 5}
                            fill={hasDSAT ? "#ef4444" : OVERVIEW_METRICS[expandedOverviewMetric].color}
                            stroke={hasDSAT ? "#fff" : "none"}
                            strokeWidth={hasDSAT ? 2 : 0}
                          />
                        );
                      }}
                      activeDot={{
                        r: 8,
                        strokeWidth: 3,
                        stroke: "#fff",
                        fill: OVERVIEW_METRICS[expandedOverviewMetric].color,
                        cursor: "pointer",
                        onClick: (e, payload) => {
                          if (payload?.payload?.date) {
                            handleDrillDown(
                              expandedOverviewMetric,
                              payload.payload.date,
                              payload.payload.name,
                            );
                          }
                        },
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EXPANDED MODAL */}
      {expandedMetric && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div
            className="absolute inset-0"
            onClick={() => setExpandedMetric(null)}
          ></div>

          <div className="bg-white dark:bg-slate-900 w-[95vw] h-[90vh] rounded-3xl shadow-2xl border border-white/10 relative flex flex-col z-10 overflow-hidden">
            {/* HEADER */}
            <div className="px-8 py-5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-between items-center shrink-0 rounded-t-3xl">
              <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-3">
                <div
                  className="p-2 rounded-xl"
                  style={{
                    backgroundColor: `${METRICS[expandedMetric].color}20`,
                  }}
                >
                  {React.createElement(METRICS[expandedMetric].icon, {
                    className: "w-6 h-6",
                    style: { color: METRICS[expandedMetric].color },
                  })}
                </div>
                {METRICS[expandedMetric].label} Analysis
              </h2>
              <button
                onClick={() => setExpandedMetric(null)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>

            {/* CONTROLS */}
            <div className="px-8 py-4 bg-slate-50/80 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-4 shrink-0">
              {/* User Dropdown - GST ONLY */}
              <div className="relative" ref={userDropdownRef}>
                <button
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  className={`flex items-center gap-2 bg-white dark:bg-slate-900 px-4 py-2.5 rounded-xl border shadow-sm transition-all min-w-[220px] justify-between ${
                    userDropdownOpen
                      ? "border-indigo-500 ring-2 ring-indigo-500/20"
                      : "border-slate-200 dark:border-slate-800 hover:border-indigo-500"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      {selectedUsers.length > 0
                        ? `${selectedUsers.length} Users Selected`
                        : "Select Users..."}
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${userDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {userDropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-2 max-h-[60vh] overflow-y-auto z-[60]">
                    {/* Select All / Clear */}
                    <div className="flex items-center justify-between px-2 pb-2 mb-1 border-b border-slate-100 dark:border-slate-800">
                      <button
                        onClick={() => setSelectedUsers([...gstUserNames])}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        Select All
                      </button>
                      <button
                        onClick={() => setSelectedUsers([])}
                        className="text-xs font-medium text-slate-400 hover:text-slate-600"
                      >
                        Clear
                      </button>
                    </div>
                    {gstUserNames.map((user) => (
                      <label
                        key={user}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                          selectedUsers.includes(user)
                            ? "bg-indigo-50 dark:bg-indigo-900/20"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedUsers.includes(user)}
                          onChange={(e) => {
                            if (e.target.checked)
                              setSelectedUsers([...selectedUsers, user]);
                            else
                              setSelectedUsers(
                                selectedUsers.filter((u) => u !== user),
                              );
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className={`text-sm ${
                          selectedUsers.includes(user)
                            ? "font-semibold text-indigo-700 dark:text-indigo-300"
                            : "text-slate-700 dark:text-slate-200"
                        }`}>
                          {user}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Time Range */}
              <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <Calendar className="w-4 h-4 text-slate-400" />
                <SmartDateRangePicker
                  value={expandedDateRange || filters?.dateRange}
                  onChange={(val) => setExpandedDateRange(val)}
                />
              </div>

              {/* Group By Toggle */}
              <div className="flex items-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                {[...(expandedMetric === "volume" ? ["hourly"] : []), "daily", "weekly", "monthly"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setExpandedGroupBy(mode)}
                    className={`px-3 py-2 text-xs font-bold transition-all ${
                      expandedGroupBy === mode
                        ? "bg-indigo-600 text-white"
                        : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    {mode === "hourly" ? "⏰ Hourly Avg" : mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>

              <div className="h-8 w-px bg-slate-300 dark:bg-slate-700 mx-2"></div>

              <button
                onClick={() => setShowTeam(!showTeam)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-all border ${
                  showTeam
                    ? "bg-rose-50 dark:bg-rose-900/30 border-rose-200 text-rose-600"
                    : "border-transparent text-slate-500 hover:bg-slate-100"
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full border ${
                    showTeam
                      ? "bg-rose-500 border-rose-500"
                      : "border-slate-400"
                  }`}
                ></div>
                Vs Team
              </button>

              <button
                onClick={() => setShowGST(!showGST)}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition-all border ${
                  showGST
                    ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 text-emerald-600"
                    : "border-transparent text-slate-500 hover:bg-slate-100"
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full border ${
                    showGST
                      ? "bg-emerald-500 border-emerald-500"
                      : "border-slate-400"
                  }`}
                ></div>
                Vs GST
              </button>
            </div>

            {/* INSIGHTS */}
            <div className="px-8 pt-6 pb-2 bg-slate-50/50 dark:bg-slate-900/50">
              <SmartInsights
                data={expandedData}
                metric={expandedMetric}
                showTeam={showTeam}
                showGST={showGST}
                selectedUsers={selectedUsers}
                myTeamName={selectedUserTeamName}
              />
            </div>

            {/* CHART */}
            <div className="flex-1 w-full bg-slate-50/50 dark:bg-slate-900/50 p-6 relative">
              {expandedGroupBy === "hourly" && expandedMetric === "volume" ? (
                /* =============== HOURLY BAR CHART (Multi-user) =============== */
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={expandedData}
                    margin={{ top: 20, right: 30, left: 10, bottom: 0 }}
                    barCategoryGap="8%"
                  >
                    <defs>
                      <linearGradient id="hourlyBarTeam" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#e11d48" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#e11d48" stopOpacity={0.5} />
                      </linearGradient>
                      <linearGradient id="hourlyBarGST" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.9} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke={isDark ? "#1e293b" : "#e2e8f0"}
                    />
                    <XAxis
                      dataKey="name"
                      tick={{
                        fill: isDark ? "#94a3b8" : "#64748b",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                      axisLine={false}
                      tickLine={false}
                      dy={10}
                      interval={0}
                    />
                    <YAxis
                      tick={{
                        fill: isDark ? "#94a3b8" : "#64748b",
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                      axisLine={false}
                      tickLine={false}
                      label={{
                        value: "Tickets Created",
                        angle: -90,
                        position: "insideLeft",
                        style: {
                          fill: isDark ? "#64748b" : "#94a3b8",
                          fontSize: 12,
                          fontWeight: 600,
                        },
                      }}
                    />
                    <RechartsTooltip
                      cursor={{ fill: isDark ? "rgba(99,102,241,0.1)" : "rgba(99,102,241,0.06)" }}
                      contentStyle={{
                        backgroundColor: isDark ? "#0f172a" : "#ffffff",
                        borderRadius: "12px",
                        border: "1px solid rgba(255,255,255,0.1)",
                      }}
                    />
                    <Legend
                      wrapperStyle={{ paddingTop: "20px" }}
                      iconType="circle"
                    />

                    {/* All Tickets - always shown as background context */}
                    <Bar
                      dataKey="All Tickets"
                      name="All Tickets"
                      fill={isDark ? "#334155" : "#cbd5e1"}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={30}
                      opacity={0.5}
                    />

                    {selectedUsers.map((user, index) => (
                      <Bar
                        key={user}
                        dataKey={user}
                        name={user}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={30}
                      />
                    ))}

                    {showTeam && (
                      <Bar
                        dataKey="compare_team"
                        name="Team Total"
                        fill="url(#hourlyBarTeam)"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={30}
                      />
                    )}
                    {showGST && (
                      <Bar
                        dataKey="compare_gst"
                        name="GST Total"
                        fill="url(#hourlyBarGST)"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={30}
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                /* =============== STANDARD AREA CHART (Multi-user) =============== */
                <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={expandedData}
                  margin={{ top: 20, right: 30, left: 10, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorTeam" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#e11d48" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorGST" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={isDark ? "#1e293b" : "#e2e8f0"}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{
                      fill: isDark ? "#94a3b8" : "#64748b",
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                    axisLine={false}
                    tickLine={false}
                    dy={10}
                    minTickGap={30}
                  />
                  <YAxis
                    tick={{
                      fill: isDark ? "#94a3b8" : "#64748b",
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: isDark ? "#0f172a" : "#ffffff",
                      borderRadius: "12px",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: "20px" }}
                    iconType="circle"
                  />

                  {selectedUsers.map((user, index) => (
                    <Area
                      key={user}
                      type="monotone"
                      dataKey={user}
                      name={user}
                      stroke={CHART_COLORS[index % CHART_COLORS.length]}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                      fillOpacity={0.1}
                      strokeWidth={3}
                      activeDot={{ r: 6, strokeWidth: 0 }}
                    />
                  ))}

                  {showTeam && (
                    <Area
                      type="monotone"
                      dataKey="compare_team"
                      name="Team Total"
                      stroke="#e11d48"
                      fill="none"
                      strokeWidth={2.5}
                      strokeDasharray="6 3"
                    />
                  )}
                  {showGST && (
                    <Area
                      type="monotone"
                      dataKey="compare_gst"
                      name="GST Total"
                      stroke="#10b981"
                      fill="none"
                      strokeWidth={2.5}
                      strokeDasharray="6 3"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Drill-Down Modal */}
      <DrillDownModal
        isOpen={!!drillDownData}
        onClose={() => setDrillDownData(null)}
        title={drillDownData?.title || ""}
        tickets={drillDownData?.tickets || []}
        metricKey={drillDownData?.metricKey || ""}
        summary={drillDownData?.summary || ""}
        dependencies={dependencies}
      />
    </div>
  );
};

export default AnalyticsDashboard;

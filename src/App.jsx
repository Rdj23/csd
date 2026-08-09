import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { loginUser, trackEvent } from "./utils/clevertap";
import { authFetch } from "./utils/authFetch";
import { fetchAllSolvedTickets } from "./api/ticketApi";
import ErrorBoundary from "./components/ErrorBoundary";
import GroupedTicketList from "./features/tickets/components/GroupedTicketList";
import AttentionBell from "./features/attention/components/AttentionBell";

// ── Route-level code splitting ───────────────────────────────────────────
// Everything below renders for exactly ONE tab, but static imports pulled all
// of it into the single entry chunk (1.55MB / 450KB gzip), so every user paid
// for every tab on first paint — on a Render Free instance with a ~1 min cold
// start, that lands on top of an already slow first byte.
//
// The two dependencies that dominate are only reachable from these tabs:
//   recharts      → Analytics, Parts, All Tickets
//   framer-motion → Parts only (a single file, features/parts/TicketDrilldown)
// Splitting them out means the default Tickets board no longer ships either.
//
// The Tickets board itself (GroupedTicketList / TicketList) stays STATIC — it
// is the landing tab, so lazying it would just add a spinner to the critical
// path for zero benefit.
const AllTicketsView = lazy(() => import("./features/tickets/components/Allticketsview"));
const GamificationView = lazy(() => import("./features/gamification/components/GamificationView"));
const ActivityDashboard = lazy(() => import("./features/activity/components/ActivityDashboard"));
const AgentModal = lazy(() => import("./features/agent/components/AgentModal"));

import {
  Users,
  Filter,
  Activity,
  Globe,
  BarChart3,
  Star,
  RefreshCw,
  Search,
  Building2,
  UserCircle,
  Briefcase,
  Layers,
  Moon,
  Sun,
  LogOut,
  Plus,
  X,
  Layout,
  Save,
  Trash2,
  FolderOpen,
  CheckCircle,
  AlertTriangle,
  FileDown,
  Clock,
  Trophy,
  Smile, // Add this
  Inbox, // Add this
  AlertCircle,
  Link2,
  ChevronDown,
  LayoutGrid,
  Import,
  Tag,
  Sparkles,
  FolderTree,
} from "lucide-react";
import {
  parseISO,
  format,
  isWithinInterval,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { Analytics } from "@vercel/analytics/react";

import TicketList from "./features/tickets/components/TicketList";
// Lazy — see the code-splitting note at the top of this file. These two carry
// recharts (both) and framer-motion (Parts), the heaviest deps in the app.
const AnalyticsDashboard = lazy(() => import("./features/analytics/components/AnalyticsDashboard"));
const PartsView = lazy(() => import("./features/parts/components/PartsView"));
import SmartDatePicker from "./components/common/SmartDateRangePicker";
import MultiSelectFilter from "./components/common/MultiSelectFilter";
import LoginScreen from "./features/auth/components/LoginScreen";
import { useTicketStore } from "./store";
// Lazy — only mounts once a user clicks into a profile.
const ProfileStatsModal = lazy(() => import("./features/remarks/components/ProfileStatsModal"));
import TicketSkeleton from "./components/ui/TicketSkeleton";
import {
  TEAM_GROUPS,
  FLAT_TEAM_MAP,
  STAGE_MAP,
  getTicketStatus,
  formatRWT,
  TEAM_REGION_MAP,
  DEPENDENCY_EXPORT_HEADERS,
  getDependencyExportCells,
} from "./utils";
import { SUPER_ADMIN_EMAILS, getCurrentQuarterKey, getQuarterDates } from "./features/analytics/components/analytics/analyticsConfig";
import { EMAIL_TO_NAME_MAP, DEPENDENCY_TEAMS, depTeamBadgeClass, getTicketDepInfo } from "./utils";
/**
 * Suspense fallback for lazily-loaded tabs.
 *
 * Deliberately quiet: the chunk usually resolves in well under a second on a
 * warm connection, and a heavy skeleton that flashes for 200ms reads as jank.
 * Sized to the content area so switching tabs doesn't collapse the layout.
 */
const TabFallback = () => (
  <div className="flex items-center justify-center h-64 text-slate-400">
    <div className="h-6 w-6 rounded-full border-2 border-slate-300 border-t-transparent animate-spin dark:border-slate-700 dark:border-t-transparent" />
  </div>
);

// Default lookback for the All Tickets Solved bucket when the user hasn't
// picked a date range. The live cache is active-only (backend, 2026-08-09), so
// solved rows are always a Mongo query — this just bounds the default one.
// 30 days keeps the payload small; the date picker widens it on demand.
const ALL_SOLVED_DEFAULT_DAYS = 30;

const EMPTY_FILTERS = {
  teams: [],
  owners: [],
  regions: [],
  stages: [],
  health: [],
  accounts: [],
  csms: [],
  tams: [],
  cohorts: [],
  sentiments: [],
  dateRange: { start: "", end: "" },
  dependency: ["with_dependency", "no_dependency"], // Both selected by default
  dependencyTeams: [...DEPENDENCY_TEAMS], // All teams selected by default
  // Both checkboxes selected by default = show everything (engineer + agent).
  // The filter only narrows the view when the user explicitly unchecks one.
  resolvedBy: ["engineer", "agent"],
};

// "Resolved By" filter options.
// engineer = handled by a Support Engineer (tnt__support_engineer_handled === true OR agent flag missing)
// agent    = handled by AI agent (tnt__agent_resolved === true AND tnt__support_engineer_handled !== true,
//                                  OR unassigned + solved as a fallback)
const RESOLVED_BY_OPTIONS = [
  { value: "engineer", label: "Support Engineer Handled" },
  { value: "agent", label: "Agent Handled" },
];

const FILTER_CONFIG = [
  { key: "regions", label: "Region", icon: Globe },
  { key: "cohorts", label: "Cohort", icon: Tag },
  { key: "accounts", label: "Account", icon: Building2 },
  { key: "csms", label: "CSM", icon: Briefcase },
  { key: "tams", label: "TAM", icon: UserCircle },
  { key: "health", label: "Health", icon: Activity },
  { key: "sentiments", label: "Sentiment", icon: Smile },
  { key: "dependency", label: "Dependency", icon: Link2 },
];

// Add dependency options for the filter dropdown (add near other filter options):
const DEPENDENCY_OPTIONS = [
  { value: "with_dependency", label: "Has Dependency" },
  { value: "no_dependency", label: "No Dependency" },
];

const DEPENDENCY_TEAM_OPTIONS = DEPENDENCY_TEAMS.map((team) => ({
  value: team,
  label: team,
}));

// Tab ids that double as URL paths, e.g. /parts, /analytics, /activity.
// "tickets" is the default and maps to the root path "/".
const TAB_PATHS = [
  "tickets",
  "alltickets",
  "csd",
  "vistas",
  "analytics",
  "parts",
  "activity",
  "gamification",
];

// Derive the active tab from the current URL path (first path segment).
// Unknown / empty paths fall back to the default "tickets" tab.
const tabFromPath = () => {
  const seg = window.location.pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
  return TAB_PATHS.includes(seg) ? seg : "tickets";
};

const App = () => {
  const {
    tickets,
    isLoading,
    isPartialData,
    syncProgress,
    fetchTickets,
    connectSocket,
    currentUser,
    isAuthenticated,
    logout,
    theme,
    toggleTheme,
    myViews,
    fetchViews,
    saveView,
    deleteView,
    dependencies,
    fetchDependencies,
  } = useTicketStore();

  const [googleClientId, setGoogleClientId] = useState(null);
  const [activeTab, setActiveTab] = useState(tabFromPath);
  const [showAgentModal, setShowAgentModal] = useState(false);
  // AgentModal is lazy, but it does `if (!open) return null` AFTER its hooks —
  // so it must stay MOUNTED once opened or the conversation is lost on close.
  // This latch gives us both: nothing is downloaded until the first open, and
  // from then on the component stays mounted exactly as before.
  const [agentEverOpened, setAgentEverOpened] = useState(false);
  useEffect(() => {
    if (showAgentModal) setAgentEverOpened(true);
  }, [showAgentModal]);

  // Keep the browser URL in sync with the active tab so each tab is
  // directly linkable (e.g. https://supportintel.clevertap.com/parts).
  // Watching `activeTab` covers every way the tab can change — clicks,
  // programmatic jumps, etc. — without touching each call site.
  useEffect(() => {
    const path = activeTab === "tickets" ? "/" : `/${activeTab}`;
    if (window.location.pathname !== path) {
      window.history.pushState({ tab: activeTab }, "", path);
    }
  }, [activeTab]);

  // Reflect browser back/forward (popstate) navigation back into state.
  useEffect(() => {
    const onPopState = () => setActiveTab(tabFromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  // All Tickets — solved/closed history pulled from Mongo for the selected range.
  // The Redis active cache only holds recent solved tickets, so past quarters
  // (e.g. Q1) need the permanent store. Live buckets still come from the cache.
  const [allSolvedTickets, setAllSolvedTickets] = useState([]);
  const [allSolvedLoading, setAllSolvedLoading] = useState(false);
  const [selectedUserProfile, setSelectedUserProfile] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedTeamLead, setSelectedTeamLead] = useState(null);
  const [serverStatus, setServerStatus] = useState("connecting"); // connecting, ready, slow, error
  const shouldShowKPIs = activeTab === "tickets" || activeTab === "csd";
  const showDatePicker = useMemo(() => {
    return activeTab !== "vistas";
  }, [activeTab]);

  // Refs to track in-flight IDs and prevent duplicate API calls
  const depsInFlightRef = useRef(new Set());
  const depsFetchTimerRef = useRef(null);

  // Dependency entries older than this are considered stale and refetched.
  // The map persists in localStorage, so without a TTL an issue fetched while
  // unassigned would show "Unassigned" forever even after someone picked it up.
  const DEP_STALE_MS = 60 * 60 * 1000; // 1 hour

  // Bumped every 15 min so the fetch effect below re-evaluates staleness even
  // when tickets/activeTab haven't changed — guarantees dependency owner/team
  // data is never more than ~1h15m old while the dashboard sits open.
  const [depRefreshTick, setDepRefreshTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setDepRefreshTick((t) => t + 1), 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch dependencies — debounced + in-flight tracking to prevent request floods.
  // Needed on every tab that exposes a dependency/linked filter or NOC exclusion:
  // the main Tickets board, All Tickets, and Analytics all read the same map.
  useEffect(() => {
    if (
      tickets.length === 0 ||
      !["tickets", "alltickets", "analytics"].includes(activeTab)
    )
      return;

    clearTimeout(depsFetchTimerRef.current);
    depsFetchTimerRef.current = setTimeout(() => {
      const ticketIds = tickets
        .map((t) => t.display_id?.replace("TKT-", ""))
        .filter(Boolean);

      // Fetch ids that are missing OR stale (fetched >1h ago, or persisted
      // by an older app version without a _fetchedAt stamp).
      const now = Date.now();
      const unfetchedIds = ticketIds.filter((id) => {
        if (depsInFlightRef.current.has(id)) return false;
        const dep = dependencies[id];
        return !dep || !dep._fetchedAt || now - dep._fetchedAt > DEP_STALE_MS;
      });

      if (unfetchedIds.length === 0) return;

      // Mark as in-flight
      unfetchedIds.forEach((id) => depsInFlightRef.current.add(id));

      const BATCH = 50;
      const fetchBatch = async () => {
        for (let i = 0; i < unfetchedIds.length; i += BATCH) {
          const batch = unfetchedIds.slice(i, i + BATCH);
          try {
            await fetchDependencies(batch);
          } catch {
            // Swallow so one failed batch doesn't abort the remaining ones;
            // the released ids below are retried on the next refresh tick.
          } finally {
            // Always release in-flight ids. Success: the fresh _fetchedAt
            // stamp now guards against refetching. Failure: they're free to
            // retry. Previously ids were only released on error, so a
            // successful fetch could never be refreshed within a session.
            batch.forEach((id) => depsInFlightRef.current.delete(id));
          }
        }
      };
      fetchBatch();
    }, 500);

    return () => clearTimeout(depsFetchTimerRef.current);
  }, [tickets, activeTab, depRefreshTick]);

  // ✅ TRACK TAB VISITS
  useEffect(() => {
    if (activeTab) {
      trackEvent("Tab Visited", { Tab: activeTab });
    }
  }, [activeTab]);

  // In App.jsx or a new component

  const [backupInfo, setBackupInfo] = useState(null);

  const fetchBackup = async () => {
    if (!currentUser?.name) return;
    try {
      const res = await authFetch(`/api/roster/backup?userName=${encodeURIComponent(currentUser.name)}`);
      const data = await res.json();
      if (data.backup) {
        setBackupInfo(data.backup);
      }
    } catch (e) {
      // silently ignore backup fetch failure
    }
  };

  // Refresh backup every 30 minutes — backup assignments change at most a few
  // times a day, so a tight poll only burned bandwidth (50 users × 288 req/day).
  useEffect(() => {
    fetchBackup();
    const interval = setInterval(fetchBackup, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [currentUser?.name]);

  // --- PERSONAL PULSE LOGIC (Moved to App.jsx) ---
  const myStats = useMemo(() => {
    if (!currentUser?.name || !tickets.length) return null;

    // 1. Identify GST Roster Members
    const allowedGroups = ["Rohan", "Shweta", "Harsh", "Aditya", "Debashish", "Tuaha"];
    const allRosterNames = allowedGroups.flatMap((g) =>
      Object.values(TEAM_GROUPS[g] || {}),
    );

    // 2. Smart Match Current User to Roster
    const matchedName = allRosterNames.find(
      (rName) =>
        currentUser.name.toLowerCase().includes(rName.toLowerCase()) ||
        rName.toLowerCase().includes(currentUser.name.toLowerCase()),
    );

    if (!matchedName) return null; // Hide if not in roster

    // 3. Filter My Tickets (From ALL tickets, ignoring current dashboard filters)
    const myTickets = tickets.filter((t) => {
      // Check both display_id map AND direct display_name
      const ownerIdName = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id];
      const ownerDisplayName = t.owned_by?.[0]?.display_name;

      const isMatch =
        (ownerIdName && ownerIdName.includes(matchedName)) ||
        (ownerDisplayName && ownerDisplayName.includes(matchedName));

      return isMatch;
    });

    // 4. Calculate Metrics
    const open = myTickets.filter(
      (t) => t.stage?.name === "Waiting on Assignee",
    ).length;

    const now = new Date();
    const solved = myTickets.filter(
      (t) =>
        t.actual_close_date &&
        isWithinInterval(parseISO(t.actual_close_date), {
          start: startOfWeek(now, { weekStartsOn: 1 }),
          end: endOfWeek(now, { weekStartsOn: 1 }),
        }),
    ).length;

    const goodCsat = myTickets.filter((t) => {
      const rating = Number(t.custom_fields?.tnt__csatrating);
      if (rating !== 2) return false;

      if (!t.actual_close_date) return false;

      return isWithinInterval(parseISO(t.actual_close_date), {
        start: startOfWeek(now, { weekStartsOn: 1 }),
        end: endOfWeek(now, { weekStartsOn: 1 }),
      });
    }).length;

    return { open, solved, csat: goodCsat };
  }, [tickets, currentUser]);

  // ✅ Vistas State
  const [selectedViewId, setSelectedViewId] = useState(null);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [toastMessage, setToastMessage] = useState(null);

  const [searchQueries, setSearchQueries] = useState({
    tickets: "",
    csd: "",
    analytics: "",
    vistas: "",
  });

  const [tabFilters, setTabFilters] = useState({
    tickets: { ...EMPTY_FILTERS },
    alltickets: { ...EMPTY_FILTERS, dateRange: { start: "", end: "" } },
    csd: { ...EMPTY_FILTERS },
    vistas: { ...EMPTY_FILTERS },
    analytics: (() => {
      const qd = getQuarterDates(getCurrentQuarterKey());
      return { ...EMPTY_FILTERS, dateRange: { start: format(qd.start, "yyyy-MM-dd"), end: format(qd.end, "yyyy-MM-dd") } };
    })(),
  });
  const [visibleFilterKeys, setVisibleFilterKeys] = useState([]);
  const hasAutoAppliedRole = useRef(false);
  const prevTabRef = useRef(activeTab);

  // Add this helper function
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // -- Config & Theme --
  useEffect(() => {
    const fetchConfig = async (retryCount = 0) => {
      const MAX_RETRIES = 6; // Up to 6 retries = ~60s total wait
      const API_BASE =
        import.meta.env.VITE_API_URL || "http://localhost:5000";

      try {
        // Update status based on retry count
        if (retryCount === 0) {
          setServerStatus("connecting");
        } else if (retryCount >= 3) {
          setServerStatus("slow"); // Show warning after 3 retries (~20s)
        }

        // ✅ PRODUCTION-SAFE: Intelligent retry with exponential backoff
        const timeout = Math.min(10000 + retryCount * 2000, 20000); // 10s -> 20s
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(`${API_BASE}/api/auth/config`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await response.json();
        setGoogleClientId(data.clientId);
        setServerStatus("ready");
      } catch (error) {
        if (retryCount < MAX_RETRIES) {
          // Exponential backoff: 2s, 4s, 6s, 8s, 10s, 12s
          const delay = Math.min(2000 * (retryCount + 1), 12000);
          setTimeout(() => fetchConfig(retryCount + 1), delay);
        } else {
          setGoogleClientId("error");
          setServerStatus("error");
        }
      }
    };
    fetchConfig();
  }, []);

  useEffect(() => {
    if (theme === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [theme]);

  // -- Initial Load --
  useEffect(() => {
    if (isAuthenticated) {
      // ✅ NON-BLOCKING: Start all fetches in parallel, don't wait
      fetchTickets().catch(() => {});
      try { connectSocket(); } catch (_) { /* socket will auto-reconnect */ }
      fetchViews().catch(() => {});
      // ✅ CLEVERTAP LOGIN
      loginUser(currentUser);
    }
  }, [isAuthenticated]);

  // ✅ TRACK SEARCH (Debounced to prevent spamming while typing)
  useEffect(() => {
    const query = searchQueries[activeTab];
    if (!query || query.length < 3) return; // Only track if 3+ chars

    const handler = setTimeout(() => {
      trackEvent("Search Performed", {
        Tab: activeTab,
        Query: query,
      });
    }, 1500); // Wait 1.5 seconds after typing stops

    return () => clearTimeout(handler);
  }, [searchQueries, activeTab]);

  // Sync: Updates both Tickets and Roster
  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

      // Run both syncs in parallel
      await Promise.all([
        authFetch(`${API_BASE}/api/tickets/sync`, { method: "POST" }),
        authFetch(`${API_BASE}/api/roster/sync`, { method: "POST" }),
      ]);

      showToast("✅ Full Sync Complete!");
    } catch (e) {
      showToast("❌ Sync failed.");
    } finally {
      setTimeout(() => setIsSyncing(false), 2000);
    }
  };

  const onSaveView = async () => {
    if (!newViewName.trim()) return;
    // ✅ ADD TRACKING HERE
    trackEvent("View Saved", { Name: newViewName });
    const success = await saveView(newViewName, tabFilters.tickets);
    if (success) {
      setNewViewName("");
      setShowSaveInput(false);
      showToast("✅ View Saved Successfully!");
    } else {
      setNewViewName("");
      setShowSaveInput(false);
      showToast("❌ Failed to save view. Please try again.");
    }
  };

  // ✅ EXPORT TO CSV FUNCTION
  const handleExportCSV = () => {
    const ticketsToExport =
      activeTab === "alltickets" ? allTicketsFiltered : displayTickets;

    if (!ticketsToExport.length) return showToast("❌ No tickets to export");

    // ✅ TRACK EVENT
    trackEvent("Report Downloaded", {
      "Ticket Count": ticketsToExport.length,
      Workspace: ticketsToExport[0]?.account?.display_name || "Mixed",
      Date: new Date().toISOString(),
    });

    // Group tickets by state
    const ticketsByState = {
      Open: [],
      Pending: [],
      "On Hold": [],
      Solved: [],
    };

    ticketsToExport.forEach((t) => {
      const stageLower = (t.stage?.name || "").toLowerCase();
      let state = "Open";
      if (
        stageLower.includes("awaiting customer") ||
        stageLower.includes("pending")
      )
        state = "Pending";
      else if (
        stageLower.includes("waiting on clevertap") ||
        stageLower.includes("on hold")
      )
        state = "On Hold";
      else if (
        stageLower.includes("solved") ||
        stageLower.includes("closed") ||
        stageLower.includes("resolved")
      )
        state = "Solved";
      ticketsByState[state].push(t);
    });

    // Build CSV with sections
    let csvContent = "";
    const reportTitle =
      activeTab === "csd"
        ? "CSD Highlighted Tickets"
        : activeTab === "vistas"
          ? "My Vistas"
          : "Ticket View";

    // Summary section
    csvContent += "SUMMARY BY STATUS\n";
    csvContent += `Open:,${ticketsByState.Open.length}\n`;
    csvContent += `Pending:,${ticketsByState.Pending.length}\n`;
    csvContent += `On Hold:,${ticketsByState["On Hold"].length}\n`;
    csvContent += `Solved:,${ticketsByState.Solved.length}\n`;
    csvContent += "\n";

    const headers = [
      "Ticket ID",
      "Title",
      "Account",
      "Region",
      "CSM",
      "TAM",
      "Assignee",
      "Stage",
      "Created Date",
      "Solved Date",
      "Age (Days)",
      "RWT (hrs)",
      "FRT (hrs)",
      "Iterations",
      "CSAT",
      "FRR",
      "Last CT Reply",
      "Last Customer Reply",
      ...DEPENDENCY_EXPORT_HEADERS,
    ];

    const formatTimestamp = (ts) => {
      if (!ts) return "-";
      return new Date(ts).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    };

    csvContent += headers.join(",") + "\n";

    ["Open", "Pending", "On Hold", "Solved"].forEach((state) => {
      ticketsByState[state].forEach((t) => {
        const owner =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "Unassigned";
        const csm = t.csm && t.csm !== "Unknown" ? t.csm.split("@")[0] : "-";
        const tam = t.tam && t.tam !== "Unknown" ? t.tam : "-";
        const cf = t.custom_fields || {};

        const row = [
          t.display_id,
          `"${(t.title || "").replace(/"/g, '""')}"`,
          `"${(t.accountName || "").replace(/"/g, '""')}"`,
          t.region || "-",
          csm,
          tam,
          owner,
          STAGE_MAP[t.stage?.name]?.label || t.stage?.name || "-",
          `"${t.created_date ? format(parseISO(t.created_date), "MMM d, yyyy") : "-"}"`,
          `"${t.actual_close_date ? format(parseISO(t.actual_close_date), "MMM d, yyyy") : "-"}"`,
          t.days || 0,
          t.rwt || "-",
          t.frt || "-",
          t.iterations || "-",
          t.csat || "-",
          t.frr || "-",
          `"${formatTimestamp(cf.tnt__last_devu_message_ts)}"`,
          `"${formatTimestamp(cf.tnt__last_revu_message_ts)}"`,
          ...getDependencyExportCells(dependencies, t.display_id, t),
        ];
        csvContent += row.join(",") + "\n";
      });
    });

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    a.download = `Ticket_Report_${reportTitle.replace(/\s+/g, "_")}_${dateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("✅ CSV Downloaded!");
  };

  const setFilter = (key, value) => {
    setTabFilters((prev) => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], [key]: value },
    }));
  };

  useEffect(() => {
    const prevTab = prevTabRef.current;

    // When ENTERING csd or analytics from a different tab
    if (
      (activeTab === "csd" || activeTab === "analytics") &&
      prevTab !== activeTab
    ) {
      setTabFilters((prev) => ({
        ...prev,
        [activeTab]: {
          ...EMPTY_FILTERS,
          ...(activeTab === "analytics"
            ? (() => {
                const qd = getQuarterDates(getCurrentQuarterKey());
                return { dateRange: { start: format(qd.start, "yyyy-MM-dd"), end: format(qd.end, "yyyy-MM-dd") } };
              })()
            : {}),
        },
      }));
    }

    prevTabRef.current = activeTab;
  }, [activeTab]);

  // ✅ AUTO-SELECT FIRST VIEW (Prevents blank screen)
  useEffect(() => {
    if (activeTab === "vistas" && !selectedViewId && myViews.length > 0) {
      setSelectedViewId(myViews[0]._id);
    }
  }, [activeTab, myViews, selectedViewId]);

  // ✅ 1. DYNAMIC FILTERS (Must be declared before using 'currentFilters')
  const currentFilters = useMemo(() => {
    if (activeTab === "vistas" && selectedViewId) {
      const view = myViews.find((v) => v._id === selectedViewId);
      return view ? view.filters : EMPTY_FILTERS;
    }
    return tabFilters[activeTab] || EMPTY_FILTERS;
  }, [activeTab, selectedViewId, myViews, tabFilters]);

  // ✅ 2. OPTIONS (Depends on tickets)
  const options = useMemo(() => {
    const opts = {
      regions: new Set(),
      teams: Object.keys(TEAM_GROUPS),
      // "Unassigned" is pinned at the top so users can quickly filter to
      // agent-handled tickets that have no human owner. The backend stores
      // these with literal owner = "Unassigned".
      owners: ["Unassigned", ...Object.values(FLAT_TEAM_MAP).sort()],
      accounts: new Set(),
      cohorts: new Set(),
      csms: new Set(),
      tams: new Set(),
      stages: ["Open", "Pending", "On Hold", "Solved"],
      health: ["Healthy", "Needs Attention", "Action Immediately"],
      sentiments: new Set(),
    };
    tickets.forEach((t) => {
      if (t.custom_fields?.tnt__region_salesforce)
        opts.regions.add(t.custom_fields.tnt__region_salesforce);
      if (t.custom_fields?.tnt__instance_account_name)
        opts.accounts.add(t.custom_fields.tnt__instance_account_name);
      opts.cohorts.add(t.custom_fields?.tnt__account_cohort_fy_25 || "C4S");
      if (t.custom_fields?.tnt__csm_email_id)
        opts.csms.add(t.custom_fields.tnt__csm_email_id);
      if (t.custom_fields?.tnt__tam) opts.tams.add(t.custom_fields.tnt__tam);
      const sentimentLabel = typeof t.sentiment === "string"
        ? t.sentiment
        : t.sentiment?.label;
      if (sentimentLabel) opts.sentiments.add(sentimentLabel);
    });
    return {
      regions: Array.from(opts.regions).sort(),
      cohorts: Array.from(opts.cohorts).sort(),
      accounts: Array.from(opts.accounts).sort(),
      csms: Array.from(opts.csms).sort(),
      tams: Array.from(opts.tams).sort(),
      teams: opts.teams,
      owners: opts.owners,
      stages: opts.stages,
      health: opts.health,
      sentiments: Array.from(opts.sentiments).sort(),
    };
  }, [tickets]);

  // ✅ 3. AUTO-ROLE & KPI LOGIC
  useEffect(() => {
    if (
      isAuthenticated &&
      currentUser &&
      options.csms.length > 0 &&
      !hasAutoAppliedRole.current
    ) {
      const userEmail = currentUser.email || "";
      if (options.csms.includes(userEmail)) {
        setFilter("csms", [userEmail]);
        setVisibleFilterKeys((prev) => Array.from(new Set([...prev, "csms"])));
        hasAutoAppliedRole.current = true;
      } else if (options.tams.includes(userEmail)) {
        setFilter("tams", [userEmail]);
        setVisibleFilterKeys((prev) => Array.from(new Set([...prev, "tams"])));
        hasAutoAppliedRole.current = true;
      }
    }
  }, [isAuthenticated, currentUser, options]);

  const handleKPIFilter = (statusValue) => {
    trackEvent("KPI Card Clicked", { Status: statusValue }); // ✅ Add this
    setVisibleFilterKeys((prev) => Array.from(new Set([...prev, "health"])));
    setFilter("health", [statusValue]);
  };

  useEffect(() => {
    if (currentFilters.teams?.includes("Adish")) {
      const adishRegions = TEAM_REGION_MAP["Adish"] || [];
      setFilter("regions", adishRegions);
      setVisibleFilterKeys((prev) => Array.from(new Set([...prev, "regions"])));
    }
  }, [currentFilters.teams]);

  // ✅ 4. FILTERED TICKETS (Depends on currentFilters)
  const filteredTickets = useMemo(() => {
    if (activeTab === "vistas" && !selectedViewId && myViews.length > 0)
      return [];

    return tickets
      .map((t) => {
        const isCSD = t.tags?.some(
          (tagObj) => tagObj.tag?.name === "csd-highlighted",
        );
        const { status, color, icon, days, priority } = getTicketStatus(
          t.created_date,
          t.stage?.name,
          isCSD,
        );
        const region = t.custom_fields?.tnt__region_salesforce || "Unknown";
        const cohort = t.custom_fields?.tnt__account_cohort_fy_25 || "C4S";
        const accountName =
          t.custom_fields?.tnt__instance_account_name || "Unknown";
        const csm = t.custom_fields?.tnt__csm_email_id || "Unknown";
        const tam = t.custom_fields?.tnt__tam || "Unknown";
        const rwtMs = formatRWT(t.custom_fields?.tnt__customer_wait_time);
        const stageName = t.stage?.name || "";
        const isActive =
          Object.keys(STAGE_MAP).includes(stageName) ||
          (activeTab === "csd" &&
            !stageName.toLowerCase().includes("solved") &&
            !stageName.toLowerCase().includes("closed"));

        const sentimentLabel = typeof t.sentiment === "string"
          ? t.sentiment
          : t.sentiment?.label || null;

        return {
          ...t,
          uiStatus: status,
          uiColor: color,
          uiIcon: icon,
          days,
          priority,
          region,
          cohort,
          rwtMs,
          isCSD,
          isActive,
          accountName,
          csm,
          tam,
          sentimentLabel,
          // Metrics for CSV export
          rwt: t.custom_fields?.tnt__rwt_business_hours || null,
          frt: t.custom_fields?.tnt__frt_hours || null,
          iterations: t.custom_fields?.tnt__iteration_count || null,
          csat: t.custom_fields?.tnt__csatrating || null,
          frr:
            t.custom_fields?.tnt__frr === true
              ? "Yes"
              : t.custom_fields?.tnt__iteration_count === 1
                ? "Yes"
                : null,
        };
      })
      .filter((t) => {
        if (activeTab === "csd") {
          if (!t.isCSD) return false;
          // For CSD, show all non-closed tickets
          const stage = t.stage?.name?.toLowerCase() || "";
          if (stage.includes("solved") || stage.includes("closed"))
            return false;
        } else if (activeTab !== "analytics" && !t.isActive) {
          return false;
        }

        const currentSearch = (searchQueries[activeTab] || "").toLowerCase();
        const matchesSearch =
          (t.title || "").toLowerCase().includes(currentSearch) ||
          (t.display_id || "").toLowerCase().includes(currentSearch);
        if (!matchesSearch) return false;

        // ✅ FIX: Use 'currentFilters.dateRange' so each tab is independent
        // ✅ Skip date filtering for pending/on-hold tickets - they should always show
        const stageLower = t.stage?.name?.toLowerCase() || "";
        const isPendingOrOnHold =
          stageLower.includes("awaiting customer") ||
          stageLower.includes("pending") ||
          stageLower.includes("waiting on clevertap") ||
          stageLower.includes("on hold");

        if (
          currentFilters.dateRange?.start &&
          currentFilters.dateRange?.end &&
          !isPendingOrOnHold
        ) {
          if (
            !isWithinInterval(parseISO(t.created_date), {
              start: startOfDay(parseISO(currentFilters.dateRange.start)),
              end: endOfDay(parseISO(currentFilters.dateRange.end)),
            })
          )
            return false;
        }

        const ownerName =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || "Unassigned";

        if (currentFilters.teams?.length > 0) {
          // Special case: Adish = region-based filter only, not owner-based
          if (
            currentFilters.teams.length === 1 &&
            currentFilters.teams.includes("Adish")
          ) {
            // Skip team/owner filter - let region filter handle it
            // (regions are already auto-selected via useEffect)
          } else {
            // Normal team filter - filter by team members
            const ticketOwnerTeams = Object.entries(TEAM_GROUPS)
              .filter(([team, members]) =>
                Object.values(members).includes(ownerName),
              )
              .map(([team]) => team);
            if (
              !ticketOwnerTeams.some((team) =>
                currentFilters.teams.includes(team),
              )
            )
              return false;
          }
        }
        if (
          currentFilters.owners?.length > 0 &&
          !currentFilters.owners.includes(ownerName)
        )
          return false;

        // ── "Resolved By" filter (dashboard-wide) ──
        // Both checked OR none checked = no filter (show everything).
        // Only narrows when exactly one of {engineer, agent} is selected.
        // Agent classification mirrors the backend rule:
        //   agent = (tnt__agent_resolved === true AND tnt__support_engineer_handled !== true)
        //           OR (Unassigned AND solved)
        const resolvedBySel = currentFilters.resolvedBy || [];
        if (resolvedBySel.length === 1) {
          const stageLower = (t.stage?.name || "").toLowerCase();
          const isSolved =
            stageLower.includes("solved") ||
            stageLower.includes("closed") ||
            stageLower.includes("resolved");
          const agentFlag =
            (t.custom_fields?.tnt__agent_resolved === true &&
              t.custom_fields?.tnt__support_engineer_handled !== true) ||
            (ownerName === "Unassigned" && isSolved);
          const ticketResolvedBy = agentFlag ? "agent" : "engineer";
          if (!resolvedBySel.includes(ticketResolvedBy)) return false;
        }
        if (
          currentFilters.regions?.length > 0 &&
          !currentFilters.regions.includes(t.region)
        )
          return false;
        if (
          currentFilters.cohorts?.length > 0 &&
          !currentFilters.cohorts.includes(t.cohort)
        )
          return false;
        if (
          currentFilters.accounts?.length > 0 &&
          !currentFilters.accounts.includes(t.accountName)
        )
          return false;
        if (
          currentFilters.csms?.length > 0 &&
          !currentFilters.csms.includes(t.csm)
        )
          return false;
        if (
          currentFilters.tams?.length > 0 &&
          !currentFilters.tams.includes(t.tam)
        )
          return false;
        if (
          currentFilters.sentiments?.length > 0 &&
          !currentFilters.sentiments.includes(t.sentimentLabel)
        )
          return false;

        if (activeTab !== "analytics") {
          const stageLabel = STAGE_MAP[t.stage?.name]?.label || "Unknown";
          if (
            currentFilters.stages?.length > 0 &&
            !currentFilters.stages.includes(stageLabel)
          )
            return false;
        }

        // Dependency filter
        if (
          currentFilters.dependency?.length > 0 &&
          currentFilters.dependency.length < 2
        ) {
          // Only filter if NOT both options are selected (if both selected, show all)
          const hasDep = getTicketDepInfo(dependencies, t).hasDependency;

          if (
            currentFilters.dependency.includes("with_dependency") &&
            !currentFilters.dependency.includes("no_dependency")
          ) {
            // Only "Has Dependency" selected - hide tickets without dependency
            if (!hasDep) return false;
          }
          if (
            currentFilters.dependency.includes("no_dependency") &&
            !currentFilters.dependency.includes("with_dependency")
          ) {
            // Only "No Dependency" selected - hide tickets with dependency
            if (hasDep) return false;
          }
        }

        // Dependency team filter (only applies when filtering for dependency
        // tickets). Any non-full selection narrows — zero teams selected must
        // yield zero dependency tickets, not "show all".
        if (
          currentFilters.dependency?.includes("with_dependency") &&
          Array.isArray(currentFilters.dependencyTeams) &&
          currentFilters.dependencyTeams.length < DEPENDENCY_TEAMS.length
        ) {
          const depInfo = getTicketDepInfo(dependencies, t);
          if (depInfo.hasDependency) {
            const hasMatchingTeam = currentFilters.dependencyTeams.some(
              (team) => depInfo.teams.includes(team),
            );
            if (!hasMatchingTeam) return false;
          }
        }

        return true;
      });
  }, [
    tickets,
    activeTab,
    searchQueries,
    dateRange,
    currentFilters,
    selectedViewId,
    dependencies, // ADD THIS
  ]);

  // Exclude tickets owned by Anmol Sawhney from ongoing views
  const displayTicketsBeforeHealth = useMemo(() => {
    return filteredTickets.filter((t) => {
      const ownerName =
        FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
        t.owned_by?.[0]?.display_name ||
        "";
      return !ownerName.toLowerCase().includes("anmol");
    });
  }, [filteredTickets]);

  // Apply health filter separately so KPI cards can show unfiltered counts
  const displayTickets = useMemo(() => {
    if (activeTab === "analytics" || !currentFilters.health?.length) {
      return displayTicketsBeforeHealth;
    }
    return displayTicketsBeforeHealth.filter((t) =>
      currentFilters.health.includes(t.uiStatus)
    );
  }, [displayTicketsBeforeHealth, currentFilters.health, activeTab]);

  const shouldShowFilter = useMemo(() => {
    return activeTab !== "vistas" && activeTab !== "analytics";
  }, [activeTab]);

  useEffect(() => {
    if (activeTab) {
      trackEvent("Tab Viewed", { Tab: activeTab });
    }
  }, [activeTab]);

  // All Tickets filters are rendered inline in the main content area below
  // This is just a placeholder to indicate the filter location

  // Fetch the solved/closed history from Mongo whenever the All Tickets tab has
  // a date range applied. The active cache can't be trusted for past quarters
  // (it only keeps recently-created solved tickets within the Valkey cap), so
  // the Solved bucket is sourced from the permanent store keyed on closed_date.
  const allSolvedRange = tabFilters.alltickets?.dateRange;
  useEffect(() => {
    if (activeTab !== "alltickets") return;
    const { start, end } = allSolvedRange || {};

    // As of 2026-08-09 the live cache is ACTIVE-ONLY (the phase-2 solved scan
    // was removed from the backend sync). Solved tickets exist in exactly one
    // place now: Mongo, via this endpoint. So an empty range can no longer
    // mean "skip the fetch and read solved out of the cache" — there is
    // nothing there to read, and the tab would render zero solved tickets.
    // With no explicit range we fall back to a recent default window; the user
    // widens it with the date picker, which then queries Mongo for any period.
    const hasExplicit = !!(start && end);
    const effEnd = hasExplicit ? end : format(new Date(), "yyyy-MM-dd");
    const effStart = hasExplicit
      ? start
      : format(new Date(Date.now() - ALL_SOLVED_DEFAULT_DAYS * 86400000), "yyyy-MM-dd");

    let cancelled = false;
    setAllSolvedLoading(true);
    fetchAllSolvedTickets(authFetch, { start: effStart, end: effEnd })
      .then((data) => {
        if (!cancelled) setAllSolvedTickets(data?.tickets || []);
      })
      .catch(() => {
        if (!cancelled) setAllSolvedTickets([]);
      })
      .finally(() => {
        if (!cancelled) setAllSolvedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, allSolvedRange?.start, allSolvedRange?.end]);

  // All Tickets View - includes solved/closed tickets
  const allTicketsFiltered = useMemo(() => {
    if (activeTab !== "alltickets") return [];

    const allTicketsFilters = tabFilters.alltickets || EMPTY_FILTERS;

    // Solved tickets ALWAYS come from Mongo now — the live cache is
    // active-only, so the two sources can no longer overlap. The filter below
    // is kept as a cheap guard: a stale cache written before the 2026-08-09
    // backend change (5-min TTL, but a client can hold an older payload) could
    // still carry solved rows, and double-counting them against the Mongo set
    // would inflate every count on this tab.
    const isSolvedStage = (name) => {
      const s = (name || "").toLowerCase();
      return (
        s.includes("solved") || s.includes("closed") || s.includes("resolved")
      );
    };
    const sourceTickets = [
      ...tickets.filter((t) => !isSolvedStage(t.stage?.name)),
      ...allSolvedTickets,
    ];

    return sourceTickets
      .map((t) => {
        const { status, color, icon, priority, days } = getTicketStatus(
          t.created_date,
          t.stage?.name,
          false,
        );
        return {
          ...t,
          uiStatus: status,
          uiColor: color,
          uiIcon: icon,
          priority,
          days,

          region: (() => {
            const r = t.custom_fields?.tnt__region_salesforce || "Unknown";
            if (r === "IN1" || r === "In1" || r === "in1") return "India";
            return r;
          })(),
          accountName:
            t.custom_fields?.tnt__instance_account_name ||
            t.rev_org?.display_name ||
            t.account?.display_name ||
            "Unknown",
          csm:
            t.custom_fields?.tnt__csm_email_id ||
            t.custom_fields?.tnt__csm ||
            "Unknown",
          tam: t.custom_fields?.tnt__tam || "Unknown",

          // Metrics
          rwt: t.custom_fields?.tnt__rwt_business_hours || null,
          frt: t.custom_fields?.tnt__frt_hours || null,
          iterations: t.custom_fields?.tnt__iteration_count || null,
          csat: t.custom_fields?.tnt__csatrating || null,
          frr:
            t.custom_fields?.tnt__frr === true
              ? "Yes"
              : t.custom_fields?.tnt__iteration_count === 1
                ? "Yes"
                : null,
        };
      })
      .filter((t) => {
        // Get owner name
        const ownerName =
          FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
          t.owned_by?.[0]?.display_name ||
          "";

        // Date Range filter — applies to SOLVED tickets only (by close date).
        // Open/Pending/On-Hold buckets always show the complete backlog: an
        // active ticket is still someone's workload no matter when it was
        // created, so filtering actives by created_date silently hid old
        // tickets (e.g. a Feb-created ticket still pending in July vanished
        // whenever a recent range was selected).
        if (
          allTicketsFilters.dateRange?.start &&
          allTicketsFilters.dateRange?.end
        ) {
          try {
            const stageLower = (t.stage?.name || "").toLowerCase();
            const isSolved =
              stageLower.includes("solved") ||
              stageLower.includes("closed") ||
              stageLower.includes("resolved");

            if (isSolved) {
              const ticketDate = parseISO(
                t.actual_close_date || t.created_date,
              );
              const start = startOfDay(
                parseISO(allTicketsFilters.dateRange.start),
              );
              const end = endOfDay(parseISO(allTicketsFilters.dateRange.end));
              if (!isWithinInterval(ticketDate, { start, end })) return false;
            }
          } catch (e) {
            // Skip invalid dates
          }
        }

        // Region filter
        if (allTicketsFilters.regions?.length > 0) {
          if (!allTicketsFilters.regions.includes(t.region)) return false;
        }

        // Team filter - special handling for Adish (region-based)
        if (allTicketsFilters.teams?.length > 0) {
          // If only Adish is selected, filter by regions instead of owner
          if (
            allTicketsFilters.teams.length === 1 &&
            allTicketsFilters.teams.includes("Adish")
          ) {
            // Adish = South America + North America regions
            const adishRegions = ["South America", "North America"];
            if (!adishRegions.includes(t.region)) return false;
          } else if (
            allTicketsFilters.teams.includes("Adish") &&
            allTicketsFilters.teams.length > 1
          ) {
            // Adish + other teams: include SA/NA regions OR matching team members
            const adishRegions = ["South America", "North America"];
            const otherTeams = allTicketsFilters.teams.filter(
              (team) => team !== "Adish",
            );

            const ownerTeams = Object.entries(TEAM_GROUPS)
              .filter(([team, members]) =>
                Object.values(members).includes(ownerName),
              )
              .map(([team]) => team);

            const matchesOtherTeam = ownerTeams.some((team) =>
              otherTeams.includes(team),
            );
            const matchesAdishRegion = adishRegions.includes(t.region);

            if (!matchesOtherTeam && !matchesAdishRegion) return false;
          } else {
            // Normal team filter - filter by team members
            const ownerTeams = Object.entries(TEAM_GROUPS)
              .filter(([team, members]) =>
                Object.values(members).includes(ownerName),
              )
              .map(([team]) => team);

            if (
              !ownerTeams.some((team) => allTicketsFilters.teams.includes(team))
            ) {
              return false;
            }
          }
        }

        // Owner/Member filter
        if (allTicketsFilters.owners?.length > 0) {
          if (!allTicketsFilters.owners.includes(ownerName)) return false;
        }

        // Resolved By filter — same rule as the main view; both checked = no-op
        const allTicketsResolvedBy = allTicketsFilters.resolvedBy || [];
        if (allTicketsResolvedBy.length === 1) {
          const stageLower = (t.stage?.name || "").toLowerCase();
          const isSolved =
            stageLower.includes("solved") ||
            stageLower.includes("closed") ||
            stageLower.includes("resolved");
          const agentFlag =
            (t.custom_fields?.tnt__agent_resolved === true &&
              t.custom_fields?.tnt__support_engineer_handled !== true) ||
            (ownerName === "Unassigned" && isSolved);
          const ticketResolvedBy = agentFlag ? "agent" : "engineer";
          if (!allTicketsResolvedBy.includes(ticketResolvedBy)) return false;
        }

        // Account filter
        if (allTicketsFilters.accounts?.length > 0) {
          if (!allTicketsFilters.accounts.includes(t.accountName)) return false;
        }

        // CSM filter - scope to accounts
        if (allTicketsFilters.csms?.length > 0) {
          if (!allTicketsFilters.csms.includes(t.csm)) return false;
        }

        // TAM filter - scope to accounts
        if (allTicketsFilters.tams?.length > 0) {
          if (!allTicketsFilters.tams.includes(t.tam)) return false;
        }

        // Stage filter - map stage names to filter values
        if (allTicketsFilters.stages?.length > 0) {
          const stageName = (t.stage?.name || "").toLowerCase();

          // Map actual stage names to filter categories
          let stageCategory = "";
          if (
            stageName.includes("waiting on assignee") ||
            stageName === "open"
          ) {
            stageCategory = "Open";
          } else if (
            stageName.includes("awaiting customer") ||
            stageName.includes("pending")
          ) {
            stageCategory = "Pending";
          } else if (
            stageName.includes("waiting on clevertap") ||
            stageName.includes("on hold")
          ) {
            stageCategory = "On Hold";
          } else if (
            stageName.includes("solved") ||
            stageName.includes("closed") ||
            stageName.includes("resolved")
          ) {
            stageCategory = "Solved";
          }

          if (
            stageCategory &&
            !allTicketsFilters.stages.includes(stageCategory)
          ) {
            return false;
          }
        }

        // Dependency filter — getTicketDepInfo prefers the sync-time Mongo
        // snapshot carried by all-solved rows (which the live map never covers),
        // falling back to the live dependencies map for active-cache tickets.
        if (
          allTicketsFilters.dependency?.length > 0 &&
          allTicketsFilters.dependency?.length < 2
        ) {
          const hasDependency = getTicketDepInfo(dependencies, t).hasDependency;

          if (
            allTicketsFilters.dependency.includes("with_dependency") &&
            !hasDependency
          ) {
            return false;
          }
          if (
            allTicketsFilters.dependency.includes("no_dependency") &&
            hasDependency
          ) {
            return false;
          }
        }

        // Dependency team filter — zero teams selected yields zero dependency
        // tickets (an empty selection is a narrowing, not a no-op).
        if (
          allTicketsFilters.dependency?.includes("with_dependency") &&
          Array.isArray(allTicketsFilters.dependencyTeams) &&
          allTicketsFilters.dependencyTeams.length < DEPENDENCY_TEAMS.length
        ) {
          const depInfo = getTicketDepInfo(dependencies, t);
          if (depInfo.hasDependency) {
            const hasMatchingTeam = allTicketsFilters.dependencyTeams.some(
              (team) => depInfo.teams.includes(team),
            );
            if (!hasMatchingTeam) return false;
          }
        }

        return true;
      });
  }, [tickets, tabFilters.alltickets, activeTab, dependencies, allSolvedTickets]);

  // ✅ KPI STATS - Count from displayTicketsBeforeHealth so cards always show real counts
  const stats = useMemo(() => {
    return {
      red: displayTicketsBeforeHealth.filter((t) => t.priority === 1).length,
      yellow: displayTicketsBeforeHealth.filter((t) => t.priority === 2).length,
      green: displayTicketsBeforeHealth.filter((t) => t.priority === 3).length,
    };
  }, [displayTicketsBeforeHealth]);

  const labels =
    activeTab === "csd"
      ? { red: "> 7 Days", yellow: "3-7 Days", green: "< 3 Days" }
      : { red: "> 15 Days", yellow: "10-15 Days", green: "< 10 Days" };

  const KPICard = ({
    count,
    label,
    borderClass,
    icon: Icon,
    filterVal,
    textClassLight,
    textClassDark,
  }) => {
    const isDisabled = count === 0;
    const healthFilter = currentFilters.health || [];
    const isActive = healthFilter.includes(filterVal);
    const isInactive = healthFilter.length > 0 && !isActive;

    return (
    <button
      onClick={() => !isDisabled && handleKPIFilter(filterVal)}
      disabled={isDisabled}
      className={`relative group text-left w-full rounded-xl border overflow-hidden
        transition-all duration-200
        ${isDisabled
          ? "opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700"
          : isInactive
          ? "opacity-70 hover:-translate-y-0.5 cursor-pointer bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
          : "hover:-translate-y-0.5 cursor-pointer"
        }
        ${!isDisabled && !isInactive && (filterVal === "Healthy"
          ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-200 dark:hover:border-emerald-800/60"
          : filterVal === "Needs Attention"
          ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-200 dark:hover:border-amber-800/60"
          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-200 dark:hover:border-rose-800/60")
        }
        ${isActive && (filterVal === "Healthy"
          ? "ring-2 ring-emerald-400/50 dark:ring-emerald-500/40 border-emerald-300 dark:border-emerald-700"
          : filterVal === "Needs Attention"
          ? "ring-2 ring-amber-400/50 dark:ring-amber-500/40 border-amber-300 dark:border-amber-700"
          : "ring-2 ring-rose-400/50 dark:ring-rose-500/40 border-rose-300 dark:border-rose-700")
        }`}
      style={{ boxShadow: isDisabled ? '0 1px 2px rgba(0,0,0,0.05)' : 'var(--shadow-card)' }}
      title={isDisabled ? "No tickets in this category" : isInactive ? `Click to filter by ${label}` : undefined}
    >
      {/* Left accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl ${
        borderClass.replace('border-l-4 border-l-', 'bg-')
      } ${isDisabled ? "opacity-20" : isInactive ? "opacity-40" : ""}`} />

      <div className="pl-5 pr-4 py-4 flex items-center justify-between">
        <div className="flex-1">
          <p className={`text-[10px] font-semibold uppercase tracking-widest mb-2 ${
            isDisabled
              ? "text-slate-400 dark:text-slate-500"
              : isInactive
              ? "text-slate-400 dark:text-slate-500"
              : "text-slate-500 dark:text-slate-400"
          }`}>
            {label}
          </p>
          <p className={`text-4xl font-bold tracking-tight leading-none transition-colors duration-200 ${
            isDisabled
              ? "text-slate-400 dark:text-slate-500"
              : isInactive
              ? "text-slate-400 dark:text-slate-500"
              : `${textClassLight} ${textClassDark}`
          }`}>
            {count}
          </p>
        </div>
        <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ml-2
          transition-all duration-200 ${!isDisabled && "group-hover:scale-110"}
          ${isDisabled
            ? "bg-slate-200 dark:bg-slate-700"
            : isInactive
            ? "bg-slate-100 dark:bg-slate-800"
            : filterVal === "Healthy" ? "bg-emerald-100 dark:bg-emerald-900/30"
            : filterVal === "Needs Attention" ? "bg-amber-100 dark:bg-amber-900/30"
            : "bg-rose-100 dark:bg-rose-900/30"}`}
        >
          <Icon className={`w-5 h-5 ${
            isDisabled
              ? "text-slate-500 dark:text-slate-400 opacity-60"
              : isInactive
              ? "text-slate-400 dark:text-slate-500 opacity-60"
              : `${textClassLight} ${textClassDark} opacity-80`
          }`} />
        </div>
      </div>
    </button>
    );
  };

  // ⌘K / Ctrl+K shortcut to open AI Agent modal
  useEffect(() => {
    if (!isAuthenticated) return;
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowAgentModal((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAuthenticated]);

  if (!googleClientId)
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-6 bg-slate-50 dark:bg-slate-900 p-6">
        <img
          src="https://res.cloudinary.com/diwc3efjb/image/upload/v1766049455/clevertap_vtpmh8.jpg"
          className="h-12 rounded-md"
          alt="Logo"
        />

        {googleClientId === "error" ? (
          <>
            <div className="flex flex-col items-center gap-2">
              <AlertTriangle className="w-12 h-12 text-rose-500" />
              <div className="text-rose-600 dark:text-rose-400 font-semibold text-lg">
                Unable to Connect
              </div>
              <div className="text-slate-500 dark:text-slate-400 text-sm text-center max-w-md">
                The server is not responding. This may be temporary. Please contact your admin if this persists.
              </div>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium shadow-lg"
            >
              <RefreshCw className="w-4 h-4" /> Try Again
            </button>
          </>
        ) : (
          <>
            <div className="relative">
              <div className="w-12 h-12 border-4 border-indigo-200 dark:border-indigo-900 rounded-full"></div>
              <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin absolute top-0 left-0"></div>
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="text-slate-700 dark:text-slate-300 font-semibold text-lg">
                {serverStatus === "connecting" && "Waking up server..."}
                {serverStatus === "slow" && "Almost there..."}
                {serverStatus === "ready" && "Connected!"}
              </div>

              {serverStatus === "connecting" && (
                <div className="text-slate-500 dark:text-slate-400 text-sm text-center max-w-md">
                  First access may take <strong>30-60 seconds</strong> on Render's free tier.
                  <br />
                  Please wait while the server initializes.
                </div>
              )}

              {serverStatus === "slow" && (
                <div className="text-amber-600 dark:text-amber-400 text-sm text-center max-w-md flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Server is starting up. This is normal for first access.
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              Retry logic active
            </div>
          </>
        )}
      </div>
    );
  if (!isAuthenticated)
    return (
      <GoogleOAuthProvider clientId={googleClientId}>
        <LoginScreen />
      </GoogleOAuthProvider>
    );

  return (
    // ✅ 1. OUTER CONTAINER: Locked height, no window scroll
    <div
      className={`h-screen w-full flex flex-col overflow-hidden font-sans transition-colors duration-300 ${
        theme === "dark" ? "bg-[#060D17]" : "bg-slate-50"
      }`}
    >
      <Analytics />
      {/* ✅ 2. FIXED TOP SECTION (Header + Tabs) */}
      <div className="shrink-0 px-6 pt-5 z-20 bg-slate-50 dark:bg-[#060D17] border-b border-slate-200 dark:border-slate-800/80 transition-colors">
        <div className="max-w-[1800px] mx-auto">
          {/* HEADER */}
          <div className="flex justify-between items-center mb-5">
            {/* Brand */}
            <div className="flex items-center gap-3.5">
              <img
                src="https://res.cloudinary.com/diwc3efjb/image/upload/v1766049455/clevertap_vtpmh8.jpg"
                className="h-8 w-8 rounded-lg object-cover flex-shrink-0"
                style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.12)' }}
                alt="CleverTap"
              />
              <div className="pl-3.5 border-l border-slate-200 dark:border-slate-700/80">
                <h1 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white leading-tight">
                  Customer Success Dashboard
                </h1>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                  Welcome back,{" "}
                  <span className="text-slate-600 dark:text-slate-300 font-medium">
                    {currentUser?.name?.split(" ")[0]}
                  </span>
                </p>
              </div>
            </div>

            {/* AI Agent Search Bar */}
            {isAuthenticated && (
              <div className="flex-1 flex justify-center px-8 max-w-xl mx-auto">
                <button
                  onClick={() => setShowAgentModal(true)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/60 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-md hover:shadow-indigo-500/5 transition-all duration-200 group cursor-text"
                >
                  <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shrink-0 shadow-sm shadow-indigo-500/20">
                    <Sparkles className="w-3.5 h-3.5 text-white" />
                  </div>
                  <span className="text-[13px] text-slate-400 dark:text-slate-500 group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors">
                    Ask AI about your tickets, customers, data...
                  </span>
                  <kbd className="ml-auto hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-[10px] font-medium text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-600">
                    ⌘K
                  </kbd>
                </button>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Attention Queue bell (GST members only — renders null otherwise) */}
              <AttentionBell />

              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className="btn-icon"
                title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              >
                {theme === "light" ? (
                  <Moon className="w-4 h-4" />
                ) : (
                  <Sun className="w-4 h-4" />
                )}
              </button>

              {/* Divider */}
              <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />

              {/* Sync */}
              <button
                onClick={handleManualSync}
                disabled={isLoading || isSyncing || isPartialData}
                className="btn-secondary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    isLoading || isSyncing || isPartialData ? "animate-spin" : ""
                  }`}
                />
                {isSyncing
                  ? "Syncing..."
                  : isPartialData
                    ? "Refreshing..."
                    : "Sync"}
              </button>

              {/* Logout */}
              <button
                onClick={logout}
                className="btn-danger-ghost text-xs"
              >
                <LogOut className="w-3.5 h-3.5" /> Logout
              </button>
            </div>
          </div>

          {/* TABS */}
          <div className="flex items-end gap-0">
            {[
              { id: "tickets",      icon: Users,      label: "Ongoing Tickets" },
              { id: "alltickets",   icon: LayoutGrid,  label: "All Tickets" },
              { id: "csd",          icon: Star,        label: "CSD Highlighted" },
              { id: "vistas",       icon: Layout,      label: "My Views" },
              { id: "analytics",    icon: BarChart3,   label: "Analytics" },
              { id: "parts",        icon: FolderTree,  label: "Parts View" },
              ...((SUPER_ADMIN_EMAILS.includes(currentUser?.email) || EMAIL_TO_NAME_MAP[currentUser?.email?.toLowerCase()])
                ? [{ id: "activity", icon: Activity, label: "Activity Intel" }]
                : []),
              ...((SUPER_ADMIN_EMAILS.includes(currentUser?.email) || EMAIL_TO_NAME_MAP[currentUser?.email?.toLowerCase()])
                ? [{ id: "gamification", icon: Trophy, label: "Gamification" }]
                : []),
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`relative flex items-center gap-1.5 px-4 pb-3 pt-0.5 text-[13px] font-medium transition-colors duration-150
                  after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-t after:transition-all after:duration-200
                  ${activeTab === t.id
                    ? "text-indigo-600 dark:text-indigo-400 after:bg-indigo-600 dark:after:bg-indigo-400"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 after:bg-transparent"
                  }`}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ✅ 3. MAIN CONTENT (Flex Grow) */}
      <div className="flex-1 min-h-0 flex flex-col max-w-[1800px] mx-auto w-full px-6 pb-4 pt-5">
        <div className="flex gap-0 h-full">
          {/* SIDEBAR (Vistas Only) */}
          {activeTab === "vistas" && (
            <div className="w-48 shrink-0 pr-4 mr-4 animate-fade-in">
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden h-full"
                   style={{ boxShadow: 'var(--shadow-card)' }}>
                <div className="px-4 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40">
                  <h3 className="font-semibold text-[13px] text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <FolderOpen className="w-3.5 h-3.5 text-indigo-500" /> Your
                    Views
                  </h3>
                </div>
                <div className="p-2 space-y-1 overflow-y-auto max-h-[calc(100%-50px)] custom-scrollbar">
                  {myViews.length === 0 ? (
                    <p className="text-xs text-slate-400 p-4 text-center italic">
                      No saved views.
                    </p>
                  ) : (
                    myViews.map((view) => (
                      <div key={view._id} className="flex group">
                        <button
                          onClick={() => setSelectedViewId(view._id)}
                          className={`flex-1 text-left px-3 py-2 text-xs rounded-lg transition-colors truncate ${
                            selectedViewId === view._id
                              ? "bg-indigo-50 text-indigo-700 font-bold dark:bg-indigo-900/30 dark:text-indigo-300"
                              : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                          }`}
                        >
                          {view.name}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // ✅ ADD TRACKING HERE
                            trackEvent("View Deleted", {
                              Name: view.name,
                              ID: view._id,
                            });
                            deleteView(view._id);
                          }}
                          className="p-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* RIGHT COLUMN: Filters (Fixed) + Content (Scrollable) */}
          <div className="flex-1 flex flex-col min-w-0 h-full">
            {/* FIXED FILTERS BAR - Hidden for Gamification/Activity tabs */}
            {activeTab !== "gamification" && activeTab !== "activity" && activeTab !== "parts" && (
            <div className="shrink-0 z-40 mb-4 bg-white dark:bg-slate-900/95 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center transition-colors relative"
                 style={{ boxShadow: 'var(--shadow-card)' }}>
              {/* LEFT: Filters */}
              <div className="flex items-center gap-2">
                {activeTab !== "analytics" && (
                  <div className="relative w-32">
                    <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder={isLoading && tickets.length === 0 ? "Loading..." : "ID / Title..."}
                      disabled={isLoading && tickets.length === 0}
                      className={`w-full pl-8 pr-2 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-400 dark:text-slate-200 ${isLoading && tickets.length === 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                      value={searchQueries[activeTab] || ""}
                      onChange={(e) => {
                        if ((isLoading || isPartialData) && tickets.length === 0) {
                          showToast("Please let the dashboard load your tickets first");
                          return;
                        }
                        setSearchQueries((prev) => ({
                          ...prev,
                          [activeTab]: e.target.value,
                        }));
                      }}
                    />
                  </div>
                )}

                {/* All Tickets Tab Filters */}
                {activeTab === "alltickets" && (
                  <>
                    <SmartDatePicker
                      value={tabFilters.alltickets?.dateRange}
                      onChange={(val) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          alltickets: { ...prev.alltickets, dateRange: val },
                        }))
                      }
                      allowAllTime={true}
                    />
                    <MultiSelectFilter
                      icon={Layers}
                      label="Team"
                      options={options.teams}
                      selected={tabFilters.alltickets?.teams || []}
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          alltickets: { ...prev.alltickets, teams: v },
                        }))
                      }
                    />
                    <MultiSelectFilter
                      icon={Users}
                      label="Member"
                      options={options.owners}
                      selected={tabFilters.alltickets?.owners || []}
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          alltickets: { ...prev.alltickets, owners: v },
                        }))
                      }
                    />
                    {/*
                      Resolved By: dashboard-wide filter. Defaults to BOTH selected
                      (engineer + agent). Frontend treats "both" or "none" as no-op.
                      Rendered icon-less and count-less to match the "All" pill style.
                    */}
                    <MultiSelectFilter
                      label="Resolved By"
                      hideCount
                      options={RESOLVED_BY_OPTIONS.map((o) => o.value)}
                      labelMap={Object.fromEntries(
                        RESOLVED_BY_OPTIONS.map((o) => [o.value, o.label]),
                      )}
                      selected={
                        tabFilters.alltickets?.resolvedBy || ["engineer", "agent"]
                      }
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          alltickets: { ...prev.alltickets, resolvedBy: v },
                        }))
                      }
                    />
                    <MultiSelectFilter
                      icon={Globe}
                      label="Region"
                      options={options.regions}
                      selected={tabFilters.alltickets?.regions || []}
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          alltickets: { ...prev.alltickets, regions: v },
                        }))
                      }
                    />
                    <MultiSelectFilter
                      icon={Building2}
                      label="Account"
                      options={options.accounts}
                      selected={tabFilters.alltickets?.accounts || []}
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          alltickets: { ...prev.alltickets, accounts: v },
                        }))
                      }
                    />
                    <MultiSelectFilter
                      icon={Briefcase}
                      label="CSM"
                      options={options.csms}
                      selected={tabFilters.alltickets?.csms || []}
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          alltickets: { ...prev.alltickets, csms: v },
                        }))
                      }
                    />
                    <MultiSelectFilter
                      icon={UserCircle}
                      label="TAM"
                      options={options.tams}
                      selected={tabFilters.alltickets?.tams || []}
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          alltickets: { ...prev.alltickets, tams: v },
                        }))
                      }
                    />
                    <MultiSelectFilter
                      icon={Activity}
                      label="Stage"
                      options={options.stages}
                      selected={tabFilters.alltickets?.stages || []}
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          alltickets: { ...prev.alltickets, stages: v },
                        }))
                      }
                    />
                    {/* Dependency Filter - Same as Ticket View */}
                    <div className="flex items-center gap-1">
                      <div className="relative group">
                        <button className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                          <Link2 className="w-3.5 h-3.5" />
                          {tabFilters.alltickets?.dependency?.length === 2
                            ? "All"
                            : tabFilters.alltickets?.dependency?.length === 1
                              ? tabFilters.alltickets?.dependency[0] ===
                                "with_dependency"
                                ? "Has Dep."
                                : "No Dep."
                              : "Dependency"}
                          <ChevronDown className="w-3 h-3" />
                        </button>

                        <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 p-3 hidden group-hover:block">
                          <div className="text-xs font-bold text-slate-500 uppercase mb-2">
                            Status
                          </div>
                          {DEPENDENCY_OPTIONS.map((opt) => (
                            <label
                              key={opt.value}
                              className="flex items-center gap-2 cursor-pointer py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 px-2 rounded"
                            >
                              <input
                                type="checkbox"
                                checked={tabFilters.alltickets?.dependency?.includes(
                                  opt.value,
                                )}
                                onChange={(e) => {
                                  const newVal = e.target.checked
                                    ? [
                                        ...(tabFilters.alltickets?.dependency ||
                                          []),
                                        opt.value,
                                      ]
                                    : (
                                        tabFilters.alltickets?.dependency || []
                                      ).filter((v) => v !== opt.value);
                                  setTabFilters((prev) => ({
                                    ...prev,
                                    alltickets: {
                                      ...prev.alltickets,
                                      dependency: newVal,
                                    },
                                  }));
                                  if (
                                    opt.value === "with_dependency" &&
                                    e.target.checked
                                  ) {
                                    setTabFilters((prev) => ({
                                      ...prev,
                                      alltickets: {
                                        ...prev.alltickets,
                                        dependencyTeams:
                                          DEPENDENCY_TEAM_OPTIONS.map(
                                            (o) => o.value,
                                          ),
                                      },
                                    }));
                                  }
                                  if (
                                    opt.value === "with_dependency" &&
                                    !e.target.checked
                                  ) {
                                    setTabFilters((prev) => ({
                                      ...prev,
                                      alltickets: {
                                        ...prev.alltickets,
                                        dependencyTeams: [],
                                      },
                                    }));
                                  }
                                }}
                                className="rounded border-slate-300 text-indigo-600"
                              />
                              <span className="text-sm text-slate-700 dark:text-slate-300">
                                {opt.label}
                              </span>
                            </label>
                          ))}

                          {tabFilters.alltickets?.dependency?.includes(
                            "with_dependency",
                          ) && (
                            <>
                              <div className="text-xs font-bold text-slate-500 uppercase mt-3 mb-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                Team
                              </div>
                              {DEPENDENCY_TEAM_OPTIONS.map((opt) => (
                                <label
                                  key={opt.value}
                                  className="flex items-center gap-2 cursor-pointer py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 px-2 rounded"
                                >
                                  <input
                                    type="checkbox"
                                    checked={tabFilters.alltickets?.dependencyTeams?.includes(
                                      opt.value,
                                    )}
                                    onChange={(e) => {
                                      const newVal = e.target.checked
                                        ? [
                                            ...(tabFilters.alltickets
                                              ?.dependencyTeams || []),
                                            opt.value,
                                          ]
                                        : (
                                            tabFilters.alltickets
                                              ?.dependencyTeams || []
                                          ).filter((v) => v !== opt.value);
                                      setTabFilters((prev) => ({
                                        ...prev,
                                        alltickets: {
                                          ...prev.alltickets,
                                          dependencyTeams: newVal,
                                        },
                                      }));
                                    }}
                                    className="rounded border-slate-300 text-indigo-600"
                                  />
                                  <span
                                    className={`text-xs px-2 py-0.5 rounded font-medium ${
                                      depTeamBadgeClass(opt.value)
                                    }`}
                                  >
                                    {opt.label}
                                  </span>
                                </label>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Analytics Tab Filters - MUST be outside other conditions */}
                {activeTab === "analytics" && (
                  <>
                    <SmartDatePicker
                      value={tabFilters.analytics?.dateRange}
                      onChange={(val) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          analytics: { ...prev.analytics, dateRange: val },
                        }))
                      }
                    />
                    <MultiSelectFilter
                      icon={Layers}
                      label="Team"
                      options={options.teams}
                      selected={tabFilters.analytics?.teams || []}
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          analytics: { ...prev.analytics, teams: v },
                        }))
                      }
                    />
                    <MultiSelectFilter
                      icon={Users}
                      label="Member"
                      options={options.owners}
                      selected={tabFilters.analytics?.owners || []}
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          analytics: { ...prev.analytics, owners: v },
                        }))
                      }
                    />
                    <MultiSelectFilter
                      icon={Globe}
                      label="Region"
                      options={options.regions}
                      selected={tabFilters.analytics?.regions || []}
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          analytics: { ...prev.analytics, regions: v },
                        }))
                      }
                    />
                    <MultiSelectFilter
                      icon={Tag}
                      label="Cohort"
                      options={options.cohorts}
                      selected={tabFilters.analytics?.cohorts || []}
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          analytics: { ...prev.analytics, cohorts: v },
                        }))
                      }
                    />
                    {/* Linked / Dependency filter — uses the same `dependencies`
                        map already loaded for NOC exclusion. Both values selected
                        (the default) is a no-op; the view narrows only when the
                        user picks exactly one. */}
                    <MultiSelectFilter
                      icon={Link2}
                      label="Dependency"
                      hideCount
                      options={["with_dependency", "no_dependency"]}
                      labelMap={{
                        with_dependency: "Has Linked / Dependency",
                        no_dependency: "No Dependency",
                      }}
                      selected={tabFilters.analytics?.dependency || []}
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          analytics: { ...prev.analytics, dependency: v },
                        }))
                      }
                    />
                    {/* Dependency-team filter — only meaningful when filtering for
                        linked tickets, so hide it otherwise. */}
                    {tabFilters.analytics?.dependency?.includes(
                      "with_dependency",
                    ) && (
                      <MultiSelectFilter
                        icon={Link2}
                        label="Dep. Team"
                        options={[...DEPENDENCY_TEAMS]}
                        selected={tabFilters.analytics?.dependencyTeams || []}
                        onChange={(v) =>
                          setTabFilters((prev) => ({
                            ...prev,
                            analytics: {
                              ...prev.analytics,
                              dependencyTeams: v,
                            },
                          }))
                        }
                      />
                    )}
                    {/* Dashboard-wide "Resolved By" filter (analytics tab).
                        Both checked = no-op so the precomputed cache stays warm. */}
                    <MultiSelectFilter
                      label="Resolved By"
                      hideCount
                      options={RESOLVED_BY_OPTIONS.map((o) => o.value)}
                      labelMap={Object.fromEntries(
                        RESOLVED_BY_OPTIONS.map((o) => [o.value, o.label]),
                      )}
                      selected={
                        tabFilters.analytics?.resolvedBy || ["engineer", "agent"]
                      }
                      onChange={(v) =>
                        setTabFilters((prev) => ({
                          ...prev,
                          analytics: { ...prev.analytics, resolvedBy: v },
                        }))
                      }
                    />
                  </>
                )}

                {activeTab !== "vistas" &&
                  activeTab !== "analytics" &&
                  activeTab !== "alltickets" && (
                    <>
                      {showDatePicker && (
                        <SmartDatePicker
                          value={currentFilters.dateRange}
                          onChange={(val) => setFilter("dateRange", val)}
                        />
                      )}

                      {activeTab !== "analytics" && (
                        <>
                        <MultiSelectFilter
                          icon={Layers}
                          label="Team"
                          options={options.teams}
                          selected={currentFilters.teams}
                          onChange={(v) => {
                            const hadAdish =
                              currentFilters.teams?.includes("Adish");
                            setFilter("teams", v);
                            const adishRegions =
                              TEAM_REGION_MAP["Adish"] || [];
                            // Auto-select regions for Adish
                            if (v.includes("Adish") && !hadAdish) {
                              setFilter("regions", adishRegions);
                              setVisibleFilterKeys((prev) =>
                                Array.from(new Set([...prev, "regions"])),
                              );
                            } else if (hadAdish && !v.includes("Adish")) {
                              // Adish unchecked: clear its auto-selected regions
                              setFilter(
                                "regions",
                                (currentFilters.regions || []).filter(
                                  (r) => !adishRegions.includes(r),
                                ),
                              );
                            }
                          }}
                        />
                        <MultiSelectFilter
                          icon={Users}
                          label="Member"
                          options={options.owners}
                          selected={currentFilters.owners}
                          onChange={(v) => setFilter("owners", v)}
                        />
                        {/* Dashboard-wide "Resolved By" filter — both checked = no-op */}
                        <MultiSelectFilter
                          label="Resolved By"
                          hideCount
                          options={RESOLVED_BY_OPTIONS.map((o) => o.value)}
                          labelMap={Object.fromEntries(
                            RESOLVED_BY_OPTIONS.map((o) => [o.value, o.label]),
                          )}
                          selected={currentFilters.resolvedBy || ["engineer", "agent"]}
                          onChange={(v) => setFilter("resolvedBy", v)}
                        />
                        <MultiSelectFilter
                          icon={Filter}
                          label="Stage"
                          options={options.stages}
                          selected={currentFilters.stages}
                          onChange={(v) => setFilter("stages", v)}
                        />
                        </>
                      )}

                      {activeTab !== "analytics" && activeTab !== "vistas" && (
                        <>
                          {visibleFilterKeys.includes("dependency") && (
                            <div className="flex items-center gap-1">
                              <div className="relative group">
                                <button className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                                  <Link2 className="w-3.5 h-3.5" />
                                  {currentFilters.dependency?.length === 2
                                    ? "All"
                                    : currentFilters.dependency?.length === 1
                                      ? currentFilters.dependency[0] ===
                                        "with_dependency"
                                        ? "Has Dep."
                                        : "No Dep."
                                      : "Dependency"}
                                  <ChevronDown className="w-3 h-3" />
                                </button>

                                {/* Dropdown */}
                                <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 p-3 hidden group-hover:block">
                                  <div className="text-xs font-bold text-slate-500 uppercase mb-2">
                                    Status
                                  </div>
                                  {DEPENDENCY_OPTIONS.map((opt) => (
                                    <label
                                      key={opt.value}
                                      className="flex items-center gap-2 cursor-pointer py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 px-2 rounded"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={currentFilters.dependency?.includes(
                                          opt.value,
                                        )}
                                        onChange={(e) => {
                                          const newVal = e.target.checked
                                            ? [
                                                ...(currentFilters.dependency ||
                                                  []),
                                                opt.value,
                                              ]
                                            : (
                                                currentFilters.dependency || []
                                              ).filter((v) => v !== opt.value);
                                          setFilter("dependency", newVal);

                                          if (
                                            opt.value === "with_dependency" &&
                                            e.target.checked
                                          ) {
                                            setFilter(
                                              "dependencyTeams",
                                              DEPENDENCY_TEAM_OPTIONS.map(
                                                (o) => o.value,
                                              ),
                                            );
                                          }
                                          if (
                                            opt.value === "with_dependency" &&
                                            !e.target.checked
                                          ) {
                                            setFilter("dependencyTeams", []);
                                          }
                                        }}
                                        className="rounded border-slate-300 text-indigo-600"
                                      />
                                      <span className="text-sm text-slate-700 dark:text-slate-300">
                                        {opt.label}
                                      </span>
                                    </label>
                                  ))}

                                  {currentFilters.dependency?.includes(
                                    "with_dependency",
                                  ) && (
                                    <>
                                      <div className="text-xs font-bold text-slate-500 uppercase mt-3 mb-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                        Team
                                      </div>
                                      {DEPENDENCY_TEAM_OPTIONS.map((opt) => (
                                        <label
                                          key={opt.value}
                                          className="flex items-center gap-2 cursor-pointer py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 px-2 rounded"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={currentFilters.dependencyTeams?.includes(
                                              opt.value,
                                            )}
                                            onChange={(e) => {
                                              const newVal = e.target.checked
                                                ? [
                                                    ...(currentFilters.dependencyTeams ||
                                                      []),
                                                    opt.value,
                                                  ]
                                                : (
                                                    currentFilters.dependencyTeams ||
                                                    []
                                                  ).filter(
                                                    (v) => v !== opt.value,
                                                  );
                                              setFilter(
                                                "dependencyTeams",
                                                newVal,
                                              );
                                            }}
                                            className="rounded border-slate-300 text-indigo-600"
                                          />
                                          <span
                                            className={`text-xs px-2 py-0.5 rounded font-medium ${
                                              depTeamBadgeClass(opt.value)
                                            }`}
                                          >
                                            {opt.label}
                                          </span>
                                        </label>
                                      ))}
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Remove button */}
                              <button
                                onClick={() => {
                                  setVisibleFilterKeys((prev) =>
                                    prev.filter((k) => k !== "dependency"),
                                  );
                                  setFilter("dependency", [
                                    "with_dependency",
                                    "no_dependency",
                                  ]);
                                  setFilter(
                                    "dependencyTeams",
                                    DEPENDENCY_TEAM_OPTIONS.map((o) => o.value),
                                  );
                                }}
                                className="p-1 hover:bg-rose-100 dark:hover:bg-rose-900/30 rounded-full text-slate-400 hover:text-rose-500 transition-colors"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          {visibleFilterKeys
                            .filter((k) => k !== "dependency")
                            .map((key) => {
                              const config = FILTER_CONFIG.find(
                                (f) => f.key === key,
                              );
                              return config ? (
                                <div
                                  key={key}
                                  className="flex items-center gap-1"
                                >
                                  <MultiSelectFilter
                                    icon={config.icon}
                                    label={config.label}
                                    options={options[key]}
                                    selected={currentFilters[key]}
                                    onChange={(v) => setFilter(key, v)}
                                  />
                                  <button
                                    onClick={() => {
                                      setVisibleFilterKeys((prev) =>
                                        prev.filter((k) => k !== key),
                                      );
                                      setFilter(key, []);
                                    }}
                                    className="p-1 hover:bg-rose-100 dark:hover:bg-rose-900/30 rounded-full text-slate-400 hover:text-rose-500 transition-colors"
                                    title={`Remove ${config.label} filter`}
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : null;
                            })}

                          <div className="relative group" tabIndex={-1}>
                            <button
                              onClick={(e) => {
                                const parent =
                                  e.currentTarget.closest(".group");
                                if (document.activeElement === parent) {
                                  parent.blur(); // close
                                } else {
                                  parent.focus(); // open
                                }
                              }}
                              className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" /> Filter
                            </button>

                            <div className="absolute top-full left-0 mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 p-1 hidden group-focus-within:block">
                              {FILTER_CONFIG.filter(
                                (f) => !visibleFilterKeys.includes(f.key),
                              ).map((f) => (
                                <button
                                  key={f.key}
                                  onClick={() =>
                                    setVisibleFilterKeys((prev) => [
                                      ...prev,
                                      f.key,
                                    ])
                                  }
                                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg"
                                >
                                  <f.icon className="w-3.5 h-3.5 opacity-70" />{" "}
                                  {f.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
              </div>

              {/* SPACER */}
              <div className="flex-1" />

              {/* RIGHT: This Week + Actions */}
              <div className="flex items-center gap-3">
                {activeTab === "analytics" && myStats && (
                  <div className="hidden lg:flex items-center gap-6 px-4 py-2 rounded-xl bg-slate-50/70 dark:bg-slate-800/50">
                    <span className="text-[11px] text-slate-400">
                      This Week
                    </span>
                    <div className="h-6 w-px bg-slate-300 dark:bg-slate-700" />
                    {[
                      { label: "CSAT", value: myStats.csat },
                      { label: "Open", value: myStats.open },
                      { label: "Solved", value: myStats.solved },
                    ].map((item) => (
                      <div key={item.label} className="text-center">
                        <div className="text-xl font-semibold">
                          {item.value}
                        </div>
                        <div className="text-[10px] uppercase text-slate-400">
                          {item.label}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === "tickets" && (
                  <button
                    onClick={() => setShowSaveInput(true)}
                    className="group flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg
                      text-indigo-600 dark:text-indigo-400
                      bg-indigo-50 dark:bg-indigo-950/40
                      border border-indigo-200 dark:border-indigo-800/60
                      hover:bg-indigo-100 dark:hover:bg-indigo-900/50
                      hover:border-indigo-300 dark:hover:border-indigo-700
                      transition-all duration-150"
                  >
                    <Save className="w-3.5 h-3.5 transition-transform duration-150 group-hover:scale-110" /> Save View
                  </button>
                )}

                {activeTab !== "analytics" && (
                  <button
                    onClick={handleExportCSV}
                    className="group flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg
                      text-slate-600 dark:text-slate-300
                      bg-white dark:bg-slate-800
                      border border-slate-200 dark:border-slate-700
                      hover:bg-slate-50 dark:hover:bg-slate-700
                      hover:border-slate-300 dark:hover:border-slate-600
                      transition-all duration-150"
                    title="Export tickets as CSV"
                  >
                    <FileDown className="w-3.5 h-3.5 transition-transform duration-150 group-hover:translate-y-0.5" />
                    <span>Export</span>
                  </button>
                )}
              </div>
            </div>
            )}

            {/* KPI CARDS */}
            {shouldShowKPIs && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3 shrink-0">
                <KPICard
                  count={stats.green}
                  label={`Healthy (${labels.green})`}
                  borderClass="border-l-4 border-l-emerald-500"
                  textClassLight="text-emerald-700"
                  textClassDark="dark:text-emerald-400"
                  icon={CheckCircle}
                  filterVal="Healthy"
                />
                <KPICard
                  count={stats.yellow}
                  label={`Attention (${labels.yellow})`}
                  borderClass="border-l-4 border-l-amber-500"
                  textClassLight="text-amber-700"
                  textClassDark="dark:text-amber-400"
                  icon={Clock}
                  filterVal="Needs Attention"
                />
                <KPICard
                  count={stats.red}
                  label={`Action (${labels.red})`}
                  borderClass="border-l-4 border-l-rose-500"
                  textClassLight="text-rose-700"
                  textClassDark="dark:text-rose-400"
                  icon={AlertTriangle}
                  filterVal="Action Immediately"
                />
              </div>
            )}

            {/* SCROLLABLE CONTENT */}
            <div className="flex-1 overflow-y-auto pr-1 pt-2 pb-10 no-scrollbar">
              {/* One boundary for the whole tab chain: exactly one branch is
                  ever mounted, so a single Suspense covers every lazy tab
                  without wrapping each ErrorBoundary individually. */}
              <Suspense fallback={<TabFallback />}>
              {activeTab === "parts" ? (
                <ErrorBoundary level="section">
                  <PartsView
                    filterOptions={options}
                    isDark={theme === "dark"}
                  />
                </ErrorBoundary>
              ) : (isLoading || isPartialData) && tickets.length === 0 ? (
                <TicketSkeleton count={8} showProgress={true} progress={syncProgress} />
              ) : activeTab === "analytics" ? (
                <ErrorBoundary level="section">
                  <AnalyticsDashboard
                    tickets={tickets}
                    dependencies={dependencies}
                    filters={tabFilters.analytics}
                    filterOptions={options}
                    onFilterChange={(key, value) => {
                      setTabFilters((prev) => ({
                        ...prev,
                        analytics: { ...prev.analytics, [key]: value },
                      }));
                    }}
                    isDark={theme === "dark"}
                  />
                </ErrorBoundary>
              ) : activeTab === "activity" && (SUPER_ADMIN_EMAILS.includes(currentUser?.email) || EMAIL_TO_NAME_MAP[currentUser?.email?.toLowerCase()]) ? (
                <ErrorBoundary level="section">
                  <ActivityDashboard
                    isDark={theme === "dark"}
                    currentUser={currentUser}
                    isAdmin={SUPER_ADMIN_EMAILS.includes(currentUser?.email?.toLowerCase())}
                  />
                </ErrorBoundary>
              ) : activeTab === "gamification" && (SUPER_ADMIN_EMAILS.includes(currentUser?.email) || EMAIL_TO_NAME_MAP[currentUser?.email?.toLowerCase()]) ? (
  <ErrorBoundary level="section">
    <GamificationView
      currentUser={currentUser}
      isAdmin={SUPER_ADMIN_EMAILS.includes(currentUser?.email?.toLowerCase())}
    />
  </ErrorBoundary>
) : activeTab === "alltickets" ? (
                <ErrorBoundary level="section">
                  <AllTicketsView
                    tickets={allTicketsFiltered}
                    filters={tabFilters.alltickets}
                    onFilterChange={(key, value) => {
                      setTabFilters((prev) => ({
                        ...prev,
                        alltickets: { ...prev.alltickets, [key]: value },
                      }));
                    }}
                    filterOptions={options}
                    dependencies={dependencies}
                    solvedLoading={allSolvedLoading}
                  />
                </ErrorBoundary>
              ) : (
                <>
                  {/* Progressive Loading Banner */}
                

                  {activeTab === "vistas" && !selectedViewId ? (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                      <Layout className="w-10 h-10 mb-2 opacity-50" />
                      <p className="text-sm">Select a view from the sidebar</p>
                    </div>
                  ) : activeTab === "vistas" ? (
                    <ErrorBoundary level="section">
                      <GroupedTicketList
                        tickets={displayTickets}
                        onProfileClick={setSelectedUserProfile}
                        dependencies={dependencies}
                      />
                    </ErrorBoundary>
                  ) : (
                    <ErrorBoundary level="section">
                      <TicketList
                        tickets={displayTickets}
                        isCSDView={activeTab === "csd"}
                        onCardClick={handleKPIFilter}
                        onProfileClick={setSelectedUserProfile}
                        dependencies={dependencies}
                        searchQuery={searchQueries[activeTab] || ""}
                        onClearSearch={() =>
                          setSearchQueries((prev) => ({
                            ...prev,
                            [activeTab]: "",
                          }))
                        }
                      />
                    </ErrorBoundary>
                  )}
                </>
              )}
              </Suspense>
            </div>
          </div>
        </div>
      </div>


      {/* TOAST */}
      {toastMessage && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-5 py-2.5 rounded-full flex items-center gap-2 text-[12px] font-semibold animate-fade-in"
             style={{ boxShadow: '0 4px 24px rgba(15,23,42,0.25), 0 1px 4px rgba(15,23,42,0.15)' }}>
          {toastMessage}
        </div>
      )}

      {/* SAVE VIEW MODAL */}
      {showSaveInput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-6 w-96 border border-slate-200 dark:border-slate-800">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
              <Save className="w-5 h-5 text-indigo-500" /> Save Current View
            </h3>
            <input
              type="text"
              placeholder="Enter view name..."
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowSaveInput(false);
                  setNewViewName("");
                }}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onSaveView}
                disabled={!newViewName.trim()}
                className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save View
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedUserProfile &&
        (() => {
          const userTickets = tickets.filter(
            (t) =>
              (FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || "") ===
              selectedUserProfile.name,
          );

          const activeForUser = userTickets.filter(
            (t) => !["Solved", "Closed", "Cancelled"].includes(t.stage?.name),
          );

          const solvedForUser = userTickets.filter((t) =>
            ["Solved", "Closed", "Resolved"].includes(t.stage?.name),
          );

          return (
            <Suspense fallback={null}>
              <ProfileStatsModal
                user={selectedUserProfile}
                tickets={activeForUser}
                solvedTickets={solvedForUser}
                onClose={() => setSelectedUserProfile(null)}
              />
            </Suspense>
          );
        })()}

      {/* AI Agent Modal — null fallback: it renders nothing while closed
          anyway, so a spinner here would appear over the dashboard. */}
      {agentEverOpened && (
        <Suspense fallback={null}>
          <AgentModal open={showAgentModal} onClose={() => setShowAgentModal(false)} />
        </Suspense>
      )}
    </div>
  );
};

export default App;

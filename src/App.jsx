import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from "react";
import { loginUser, trackEvent } from "./utils/clevertap";
import { authFetch } from "./utils/authFetch";
import GroupedTicketList from "./components/GroupedTicketList";
import AllTicketsView from "./components/Allticketsview";

import GamificationView from "./components/GamificationView";

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
} from "lucide-react";
import {
  parseISO,
  isWithinInterval,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { GoogleOAuthProvider } from "@react-oauth/google";

import TicketList from "./components/TicketList";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import SmartDatePicker from "./components/SmartDateRangePicker";
import MultiSelectFilter from "./components/MultiSelectFilter";
import LoginScreen from "./components/LoginScreen";
import { useTicketStore } from "./store";
import ProfileStatsModal from "./components/ProfileStatsModal";
import TicketSkeleton from "./components/TicketSkeleton";
import {
  TEAM_GROUPS,
  FLAT_TEAM_MAP,
  STAGE_MAP,
  getTicketStatus,
  formatRWT,
  TEAM_REGION_MAP,
} from "./utils";
import { SUPER_ADMIN_EMAILS } from "./components/analytics/analyticsConfig";
import { EMAIL_TO_NAME_MAP } from "./utils";
const EMPTY_FILTERS = {
  teams: [],
  owners: [],
  regions: [],
  stages: [],
  health: [],
  accounts: [],
  csms: [],
  tams: [],
  dateRange: { start: "", end: "" },
  dependency: ["with_dependency", "no_dependency"], // Both selected by default
  dependencyTeams: ["NOC", "Whatsapp", "Billing", "Email", "Internal", "Other"], // All teams selected by default
};

const FILTER_CONFIG = [
  { key: "regions", label: "Region", icon: Globe },
  { key: "owners", label: "Member", icon: Users },
  { key: "accounts", label: "Account", icon: Building2 },
  { key: "csms", label: "CSM", icon: Briefcase },
  { key: "tams", label: "TAM", icon: UserCircle },
  { key: "stages", label: "Stage", icon: Filter },
  { key: "health", label: "Health", icon: Activity },
  { key: "dependency", label: "Dependency", icon: Link2 },
];

// Add dependency options for the filter dropdown (add near other filter options):
const DEPENDENCY_OPTIONS = [
  { value: "with_dependency", label: "Has Dependency" },
  { value: "no_dependency", label: "No Dependency" },
];

const DEPENDENCY_TEAM_OPTIONS = [
  { value: "NOC", label: "NOC" },
  { value: "Whatsapp", label: "Whatsapp" },
  { value: "Billing", label: "Billing" },
  { value: "Email", label: "Email" },
  { value: "Internal", label: "Internal" },
  { value: "Other", label: "Other" },
];

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
    timelineReplies,
    fetchTimelineReplies,
  } = useTicketStore();

  const [googleClientId, setGoogleClientId] = useState(null);
  const [activeTab, setActiveTab] = useState("tickets");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [selectedUserProfile, setSelectedUserProfile] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedTeamLead, setSelectedTeamLead] = useState(null);
  const [serverStatus, setServerStatus] = useState("connecting"); // connecting, ready, slow, error
  const shouldShowKPIs = activeTab === "tickets" || activeTab === "csd";
  const showDatePicker = useMemo(() => {
    return activeTab !== "vistas";
  }, [activeTab]);

  // Add useEffect to fetch dependencies:
  useEffect(() => {
    if (tickets.length > 0 && activeTab === "tickets") {
      // Extract ticket IDs (remove "TKT-" prefix)
      const ticketIds = tickets
        .map((t) => t.display_id?.replace("TKT-", ""))
        .filter(Boolean);

      // Fetch dependencies for tickets not already fetched
      const unfetchedIds = ticketIds.filter((id) => !dependencies[id]);

      if (unfetchedIds.length > 0) {
        // Fetch in batches to avoid overwhelming the API
        const BATCH = 20;
        const fetchBatch = async () => {
          for (let i = 0; i < unfetchedIds.length; i += BATCH) {
            await fetchDependencies(unfetchedIds.slice(i, i + BATCH));
          }
        };
        fetchBatch();
      }
    }
  }, [tickets, activeTab]);

  // Fetch timeline replies (last CT & customer reply timestamps)
  useEffect(() => {
    if (tickets.length > 0 && activeTab === "tickets") {
      const ticketIds = tickets
        .map((t) => t.display_id?.replace("TKT-", ""))
        .filter(Boolean);

      const unfetchedIds = ticketIds.filter((id) => !timelineReplies[id]);

      if (unfetchedIds.length > 0) {
        const BATCH = 50;
        const fetchBatch = async () => {
          for (let i = 0; i < unfetchedIds.length; i += BATCH) {
            await fetchTimelineReplies(unfetchedIds.slice(i, i + BATCH));
          }
        };
        fetchBatch();
      }
    }
  }, [tickets, activeTab]);

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
      console.error("Failed to fetch backup", e);
    }
  };

  // Refresh backup every 5 minutes
  useEffect(() => {
    fetchBackup();
    const interval = setInterval(fetchBackup, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [currentUser?.name]);

  // --- PERSONAL PULSE LOGIC (Moved to App.jsx) ---
  const myStats = useMemo(() => {
    if (!currentUser?.name || !tickets.length) return null;

    // 1. Identify GST Roster Members
    const allowedGroups = ["Mashnu", "Tuaha", "Debashish", "Shweta"];
    const allRosterNames = allowedGroups.flatMap((g) =>
      Object.values(TEAM_GROUPS[g] || {}),
    );

    // 2. Smart Match Current User to Roster
    const matchedName = allRosterNames.find(
      (rName) =>
        currentUser.name.toLowerCase().includes(rName.toLowerCase()) ||
        rName.toLowerCase().includes(currentUser.name.toLowerCase()),
    );

    // --- DEBUGGING LOGS (Check Console) ---
    console.log("----------- STATS DEBUG -----------");
    console.log("1. Logged In As:", currentUser.name);
    console.log(
      "2. Is GST Member?",
      !!matchedName,
      matchedName ? `(Matched: ${matchedName})` : "(No Match)",
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

    console.log("3. Total Tickets Found for Me:", myTickets.length);

    // ----------------------------------------

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
    analytics: { ...EMPTY_FILTERS, dateRange: { start: "2026-01-01", end: "2026-03-31" } },
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

        const startTime = Date.now();
        const response = await fetch(`${API_BASE}/api/auth/config`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const loadTime = Date.now() - startTime;
        console.log(`✅ Server responded in ${loadTime}ms`);

        const data = await response.json();
        setGoogleClientId(data.clientId);
        setServerStatus("ready");
      } catch (error) {
        console.error(`Config fetch attempt ${retryCount + 1} failed:`, error);

        if (retryCount < MAX_RETRIES) {
          // Exponential backoff: 2s, 4s, 6s, 8s, 10s, 12s
          const delay = Math.min(2000 * (retryCount + 1), 12000);
          console.log(`Retrying in ${delay / 1000}s... (Render cold start expected)`);

          setTimeout(() => fetchConfig(retryCount + 1), delay);
        } else {
          console.error("All retry attempts exhausted");
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
      fetchTickets().catch(err => console.error("Ticket fetch failed:", err));
      connectSocket();
      fetchViews().catch(err => console.error("Views fetch failed:", err));
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

  //   useEffect(() => {
  //   if (selectedTeamLead && TEAM_LEADS[selectedTeamLead]) {
  //     const leadRegions = TEAM_LEADS[selectedTeamLead].regions;
  //     setFilter("regions", leadRegions);
  //     setVisibleFilterKeys((prev) => Array.from(new Set([...prev, "regions"])));
  //   }
  // }, [selectedTeamLead]);

  // ✅ MERGED SYNC: Updates both Tickets and Roster
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
    const currentDate = new Date();
    const formattedDate = `${currentDate.toLocaleString("default", { month: "long" })} ${currentDate.getDate()} ${currentDate.getFullYear()} ${currentDate.getHours()}:${String(currentDate.getMinutes()).padStart(2, "0")}`;

    csvContent += "TICKET REPORT\n";
    csvContent += `Generated:,${formattedDate}\n`;
    csvContent += `Report:,${reportTitle}\n`;
    csvContent += `Total Tickets:,${ticketsToExport.length}\n`;
    csvContent += "\n";
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
      "Age (Days)",
      "RWT (hrs)",
      "FRT (hrs)",
      "Iterations",
      "CSAT",
      "FRR",
    ];

    // Process each state section
    ["Open", "Pending", "On Hold", "Solved"].forEach((state) => {
      const stateTickets = ticketsByState[state];

      csvContent += "\n";
      csvContent += `${"=".repeat(20)}\n`;
      csvContent += `${state.toUpperCase()} TICKETS (${stateTickets.length})\n`;
      csvContent += `${"=".repeat(20)}\n`;

      if (stateTickets.length === 0) {
        csvContent += "No tickets in this category\n";
      } else {
        csvContent += headers.join(",") + "\n";

        stateTickets.forEach((t) => {
          const owner =
            FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
            t.owned_by?.[0]?.display_name ||
            "Unassigned";
          const csm = t.csm && t.csm !== "Unknown" ? t.csm.split("@")[0] : "-";
          const tam = t.tam && t.tam !== "Unknown" ? t.tam : "-";

          const row = [
            t.display_id,
            `"${(t.title || "").replace(/"/g, '""')}"`,
            `"${(t.accountName || "").replace(/"/g, '""')}"`,
            t.region || "-",
            csm,
            tam,
            owner,
            t.days || 0,
            t.rwt || "-",
            t.frt || "-",
            t.iterations || "-",
            t.csat || "-",
            t.frr || "-",
          ];
          csvContent += row.join(",") + "\n";
        });
      }
    });

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Ticket_Report_${reportTitle.replace(/\s+/g, "_")}_${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}_${String(currentDate.getHours()).padStart(2, "0")}${String(currentDate.getMinutes()).padStart(2, "0")}.csv`;
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
            ? { dateRange: { start: "2026-01-01", end: "2026-03-31" } }
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
      owners: Object.values(FLAT_TEAM_MAP).sort(),
      accounts: new Set(),
      csms: new Set(),
      tams: new Set(),
      stages: ["Open", "Pending", "On Hold", "Solved"],
      health: ["Healthy", "Needs Attention", "Action Immediately"],
    };
    tickets.forEach((t) => {
      if (t.custom_fields?.tnt__region_salesforce)
        opts.regions.add(t.custom_fields.tnt__region_salesforce);
      if (t.custom_fields?.tnt__instance_account_name)
        opts.accounts.add(t.custom_fields.tnt__instance_account_name);
      if (t.custom_fields?.tnt__csm_email_id)
        opts.csms.add(t.custom_fields.tnt__csm_email_id);
      if (t.custom_fields?.tnt__tam) opts.tams.add(t.custom_fields.tnt__tam);
    });
    return {
      regions: Array.from(opts.regions).sort(),
      accounts: Array.from(opts.accounts).sort(),
      csms: Array.from(opts.csms).sort(),
      tams: Array.from(opts.tams).sort(),
      teams: opts.teams,
      owners: opts.owners,
      stages: opts.stages,
      health: opts.health,
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

        return {
          ...t,
          uiStatus: status,
          uiColor: color,
          uiIcon: icon,
          days,
          priority,
          region,
          rwtMs,
          isCSD,
          isActive,
          accountName,
          csm,
          tam,
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
          t.title.toLowerCase().includes(currentSearch) ||
          t.display_id.toLowerCase().includes(currentSearch);
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
        if (
          currentFilters.regions?.length > 0 &&
          !currentFilters.regions.includes(t.region)
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

        if (activeTab !== "analytics") {
          const stageLabel = STAGE_MAP[t.stage?.name]?.label || "Unknown";
          if (
            currentFilters.stages?.length > 0 &&
            !currentFilters.stages.includes(stageLabel)
          )
            return false;
          if (
            currentFilters.health?.length > 0 &&
            !currentFilters.health.includes(t.uiStatus)
          )
            return false;
        }

        // Dependency filter
        if (
          currentFilters.dependency?.length > 0 &&
          currentFilters.dependency.length < 2
        ) {
          // Only filter if NOT both options are selected (if both selected, show all)
          const ticketId = t.display_id?.replace("TKT-", "");
          const dep = dependencies[ticketId];
          const hasDep = dep?.hasDependency === true;

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

        // Dependency team filter (only applies when filtering for dependency tickets)
        if (
          currentFilters.dependency?.includes("with_dependency") &&
          currentFilters.dependencyTeams?.length > 0 &&
          currentFilters.dependencyTeams.length < 6
        ) {
          // Only filter if NOT all teams are selected
          const ticketId = t.display_id?.replace("TKT-", "");
          const dep = dependencies[ticketId];

          if (dep?.hasDependency) {
            const ticketTeams = dep.issues?.map((i) => i.team) || [];
            const hasMatchingTeam = currentFilters.dependencyTeams.some(
              (team) => ticketTeams.includes(team),
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
  const displayTickets = useMemo(() => {
    return filteredTickets.filter((t) => {
      const ownerName =
        FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
        t.owned_by?.[0]?.display_name ||
        "";
      return !ownerName.toLowerCase().includes("anmol");
    });
  }, [filteredTickets]);

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

  // All Tickets View - includes solved/closed tickets
  const allTicketsFiltered = useMemo(() => {
    if (activeTab !== "alltickets") return [];

    const allTicketsFilters = tabFilters.alltickets || EMPTY_FILTERS;

    return tickets
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

        // Date Range filter
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

            // IF SOLVED: Use Close Date. IF OPEN: Use Created Date.
            let dateStrToCheck = t.created_date;

            if (isSolved && t.actual_close_date) {
              dateStrToCheck = t.actual_close_date;
            }

            const ticketDate = parseISO(dateStrToCheck);
            const start = startOfDay(
              parseISO(allTicketsFilters.dateRange.start),
            );
            const end = endOfDay(parseISO(allTicketsFilters.dateRange.end));
            if (!isWithinInterval(ticketDate, { start, end })) return false;
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

        // Dependency filter
        if (
          allTicketsFilters.dependency?.length > 0 &&
          allTicketsFilters.dependency?.length < 2
        ) {
          const ticketId = t.display_id?.replace("TKT-", "");
          const dep = dependencies[ticketId];
          const hasDependency = dep?.hasDependency === true;

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

        // Dependency team filter
        if (
          allTicketsFilters.dependency?.includes("with_dependency") &&
          allTicketsFilters.dependencyTeams?.length > 0 &&
          allTicketsFilters.dependencyTeams?.length < 6
        ) {
          const ticketId = t.display_id?.replace("TKT-", "");
          const dep = dependencies[ticketId];
          if (dep?.hasDependency) {
            const ticketTeams = dep.issues?.map((i) => i.team) || [];
            const hasMatchingTeam = allTicketsFilters.dependencyTeams.some(
              (team) => ticketTeams.includes(team),
            );
            if (!hasMatchingTeam) return false;
          }
        }

        return true;
      });
  }, [tickets, tabFilters.alltickets, activeTab, dependencies]);

  // ✅ KPI STATS LOGIC (Moved here to stay fixed)
  const stats = {
    red: displayTickets.filter((t) => t.priority === 1).length,
    yellow: displayTickets.filter((t) => t.priority === 2).length,
    green: displayTickets.filter((t) => t.priority === 3).length,
  };

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
  }) => (
    <button
      onClick={() => handleKPIFilter(filterVal)}
      className={`relative overflow-hidden group transition-all duration-200 p-4 rounded-xl flex justify-between shadow-sm hover:shadow-md text-left w-full 
bg-white dark:bg-slate-900
${filterVal === "Healthy" ? "bg-emerald-50/60 dark:bg-emerald-900/10" : ""}
${filterVal === "Needs Attention" ? "bg-amber-50/60 dark:bg-amber-900/10" : ""}
${
  filterVal === "Action Immediately" ? "bg-rose-50/60 dark:bg-rose-900/10" : ""
}`}
    >
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider opacity-70 text-slate-500 dark:text-slate-400 mb-1">
          {label}
        </p>
        <p
          className={`text-2xl font-extrabold tracking-tight ${textClassLight} ${textClassDark}`}
        >
          {count}
        </p>
      </div>
      <div className="w-8 h-8 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform">
        <Icon className="w-4 h-4 text-slate-400 dark:text-slate-300 opacity-70" />
      </div>
    </button>
  );

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
        theme === "dark" ? "bg-[#0B1120]" : "bg-slate-50"
      }`}
    >
      {/* ✅ 2. FIXED TOP SECTION (Header + Tabs) */}
      <div className="shrink-0 px-6 pt-6 z-20 bg-slate-50 dark:bg-[#0B1120] transition-colors">
        <div className="max-w-[1800px] mx-auto">
          {/* HEADER */}
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-4">
              <img
                src="https://res.cloudinary.com/diwc3efjb/image/upload/v1766049455/clevertap_vtpmh8.jpg"
                className="h-10 rounded-md"
                alt="Logo"
              />
              <div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                  Customer Success Dashboard
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Welcome, {currentUser?.name}
                </p>
              </div>
            </div>
            <div className="flex gap-3 items-center">
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm text-slate-600 dark:text-slate-200"
              >
                {theme === "light" ? (
                  <Moon className="w-4 h-4" />
                ) : (
                  <Sun className="w-4 h-4" />
                )}
              </button>

              {/* ✅ SINGLE SYNC BUTTON */}
              <button
                onClick={handleManualSync}
                disabled={isLoading || isSyncing || isPartialData}
                className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm text-slate-700 dark:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw
                  className={`w-4 h-4 ${
                    isLoading || isSyncing || isPartialData ? "animate-spin" : ""
                  }`}
                />
                {isSyncing
                  ? "Syncing..."
                  : isPartialData
                    ? "Refreshing..."
                    : "Sync"}
              </button>

              <button
                onClick={logout}
                className="flex items-center gap-2 bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/50 px-4 py-2 rounded-lg text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors shadow-sm font-medium"
              >
                <LogOut className="w-4 h-4" /> Logout
              </button>
            </div>
          </div>

          {/* TABS */}
          <div className="flex gap-8 border-b border-slate-200 dark:border-slate-800">
            {[
              { id: "tickets", icon: Users, label: "Ongoing Tickets" },
              { id: "alltickets", icon: LayoutGrid, label: "All Tickets" },
              { id: "csd", icon: Star, label: "CSD Highlighted" },
              { id: "vistas", icon: Layout, label: "My Views" },
              { id: "analytics", icon: BarChart3, label: "Analytics" },
              // Gamification tab visible to SUPER_ADMIN and GST users
              ...((SUPER_ADMIN_EMAILS.includes(currentUser?.email) || EMAIL_TO_NAME_MAP[currentUser?.email?.toLowerCase()]) ? [{ id: "gamification", icon: Trophy, label: "Gamification" }] : []),
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`pb-3 text-sm font-medium flex items-center gap-2 transition-colors ${
                  activeTab === t.id
                    ? "text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                <t.icon className="w-4 h-4" /> {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ✅ 3. MAIN CONTENT (Flex Grow) */}
      <div className="flex-1 min-h-0 flex flex-col max-w-[1800px] mx-auto w-full px-6 pb-4 pt-6">
        <div className="flex gap-0 h-full">
          {/* SIDEBAR (Vistas Only) - ✅ Fixed: Removed border-r */}
          {activeTab === "vistas" && (
            <div className="w-48 shrink-0 pr-4 mr-4 animate-in slide-in-from-left-2">
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm h-full">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                  <h3 className="font-bold text-sm text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-indigo-500" /> Your
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
            {/* FIXED FILTERS BAR - Hidden for Gamification tab */}
            {activeTab !== "gamification" && (
            <div className="shrink-0 z-40 mb-4 bg-white dark:bg-slate-900 p-3 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 flex items-center transition-colors relative">
              {/* LEFT: Filters */}
              <div className="flex items-center gap-2">
                {activeTab !== "analytics" && (
                  <div className="relative w-32">
                    <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="ID / Title..."
                      className="w-full pl-8 pr-2 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-400 dark:text-slate-200"
                      value={searchQueries[activeTab] || ""}
                      onChange={(e) =>
                        setSearchQueries((prev) => ({
                          ...prev,
                          [activeTab]: e.target.value,
                        }))
                      }
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
                                      opt.value === "NOC"
                                        ? "bg-rose-100 text-rose-700"
                                        : opt.value === "Whatsapp"
                                          ? "bg-emerald-100 text-emerald-700"
                                          : opt.value === "Billing"
                                            ? "bg-amber-100 text-amber-700"
                                            : opt.value === "Email"
                                              ? "bg-blue-100 text-blue-700"
                                              : "bg-slate-100 text-slate-700"
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
                        <MultiSelectFilter
                          icon={Layers}
                          label="Team"
                          options={options.teams}
                          selected={currentFilters.teams}
                          onChange={(v) => {
                            setFilter("teams", v);
                            // Auto-select regions for Adish
                            if (v.includes("Adish")) {
                              setFilter("regions", [
                                "South America",
                                "North America",
                              ]);
                              setVisibleFilterKeys((prev) =>
                                Array.from(new Set([...prev, "regions"])),
                              );
                            }
                          }}
                        />
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
                                              opt.value === "NOC"
                                                ? "bg-rose-100 text-rose-700"
                                                : opt.value === "Whatsapp"
                                                  ? "bg-emerald-100 text-emerald-700"
                                                  : opt.value === "Billing"
                                                    ? "bg-amber-100 text-amber-700"
                                                    : opt.value === "Email"
                                                      ? "bg-blue-100 text-blue-700"
                                                      : "bg-slate-100 text-slate-700"
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
                    className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-indigo-600"
                  >
                    <Save className="w-4 h-4" /> Save View
                  </button>
                )}

                {activeTab !== "analytics" && (
                  <button
                    onClick={handleExportCSV}
                    className="p-2.5 rounded-lg bg-white border border-slate-200 dark:bg-slate-800 dark:border-slate-700
    dark:text-slate-300 dark:hover:bg-slate-700
    transition-colorss"
                  >
                    <FileDown className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
            )}

            {/* KPI CARDS */}
            {/* {activeTab !== "analytics" && activeTab !== "vistas" && ( */}
            {shouldShowKPIs && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-2 shrink-0">
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
              {(isLoading || isPartialData) && tickets.length === 0 ? (
                <TicketSkeleton count={8} showProgress={true} progress={syncProgress} />
              ) : activeTab === "analytics" ? (
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
              ) : activeTab === "gamification" && (SUPER_ADMIN_EMAILS.includes(currentUser?.email) || EMAIL_TO_NAME_MAP[currentUser?.email?.toLowerCase()]) ? (
  <GamificationView
    quarter={tabFilters.analytics?.quarter || "Q1_26"}
    currentUser={currentUser}
    isAdmin={SUPER_ADMIN_EMAILS.includes(currentUser?.email)}
  />
) : activeTab === "alltickets" ? (
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
                />
              ) : (
                <>
                  {/* Progressive Loading Banner */}
                

                  {activeTab === "vistas" && !selectedViewId ? (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                      <Layout className="w-10 h-10 mb-2 opacity-50" />
                      <p className="text-sm">Select a view from the sidebar</p>
                    </div>
                  ) : activeTab === "vistas" ? (
                    <GroupedTicketList
                      tickets={displayTickets}
                      onProfileClick={setSelectedUserProfile}
                      dependencies={dependencies}
                    />
                  ) : (
                    <TicketList
                      tickets={displayTickets}
                      isCSDView={activeTab === "csd"}
                      onCardClick={handleKPIFilter}
                      onProfileClick={setSelectedUserProfile}
                      dependencies={dependencies}
                      timelineReplies={timelineReplies}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>


      {/* TOAST */}
      {toastMessage && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-2 rounded-full shadow-xl flex items-center gap-2 text-xs font-bold">
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
            <ProfileStatsModal
              user={selectedUserProfile}
              tickets={activeForUser}
              solvedTickets={solvedForUser}
              onClose={() => setSelectedUserProfile(null)}
            />
          );
        })()}
    </div>
  );
};

export default App;

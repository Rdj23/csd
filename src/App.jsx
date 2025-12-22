import React, { useEffect, useMemo, useState, useRef } from "react";
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
} from "lucide-react";
import {
  parseISO,
  isWithinInterval,
  startOfDay,
  endOfDay,
  format,
} from "date-fns";
import { GoogleOAuthProvider } from "@react-oauth/google";

import TicketList from "./components/TicketList";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import SmartDatePicker from "./components/SmartDatePicker";
import MultiSelectFilter from "./components/MultiSelectFilter";
import LoginScreen from "./components/LoginScreen";
import { useTicketStore } from "./store";
import ProfileStatsModal from "./components/ProfileStatsModal";
import {
  TEAM_GROUPS,
  FLAT_TEAM_MAP,
  STAGE_MAP,
  getTicketStatus,
  formatRWT,
} from "./utils";

const EMPTY_FILTERS = {
  teams: [],
  owners: [],
  regions: [],
  stages: [],
  health: [],
  accounts: [],
  csms: [],
  tams: [],
};

// --- CONFIG: Define available filters ---
const FILTER_CONFIG = [
  { key: "regions", label: "Region", icon: Globe },
  { key: "teams", label: "Team", icon: Layers },
  { key: "owners", label: "Member", icon: Users },
  { key: "accounts", label: "Account", icon: Building2 },
  { key: "csms", label: "CSM", icon: Briefcase },
  { key: "tams", label: "TAM", icon: UserCircle },
  { key: "stages", label: "Stage", icon: Filter },
  { key: "health", label: "Health", icon: Activity },
];

const App = () => {
  const {
    tickets,
    isLoading,
    lastSync,
    fetchTickets,
    currentUser,
    isAuthenticated,
    logout,
    theme,
    toggleTheme,
  } = useTicketStore();

  const [googleClientId, setGoogleClientId] = useState(null);
  const [activeTab, setActiveTab] = useState("tickets");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [selectedUserProfile, setSelectedUserProfile] = useState(null);

  // --- ROSTER UPLOAD HANDLER ---
  const fileInputRef = useRef(null);

  const handleRosterUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const API_BASE =  "http://localhost:5000";
      await fetch(`${API_BASE}/api/roster/upload`, {
        method: "POST",
        body: formData,
      });
      alert("✅ Roster updated successfully! Changes are live.");
    } catch (error) {
      console.error("Upload failed", error);
      alert("❌ Upload failed.");
    }
  };
  
  // Separate search buckets
  const [searchQueries, setSearchQueries] = useState({
    tickets: "",
    csd: "",
    analytics: "",
  });

  // State for Filters
  const [tabFilters, setTabFilters] = useState({
    tickets: { ...EMPTY_FILTERS },
    csd: { ...EMPTY_FILTERS },
    analytics: { ...EMPTY_FILTERS },
  });

  // Controls which filters are currently visible as chips
  const [visibleFilterKeys, setVisibleFilterKeys] = useState([]);
  const hasAutoAppliedRole = useRef(false);

  // -- Effect: Fetch Config on Mount --
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";
        const response = await fetch(`${API_BASE}/api/auth/config`);
        const data = await response.json();
        setGoogleClientId(data.clientId);
      } catch (error) {
        console.error("Failed to fetch auth confg:", error);
      }
    };
    fetchConfig();
  }, []);

  // -- Effect: Theme --
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  // -- Effect: Fetch Tickets if Authed --
  useEffect(() => {
    if (isAuthenticated) fetchTickets();
  }, [isAuthenticated]);

  // -- Helper: Set Filters --
  const setFilter = (key, value) => {
    setTabFilters((prev) => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], [key]: value },
    }));
  };
  const currentFilters = tabFilters[activeTab];

  // -- Memo: Filter Options --
  const options = useMemo(() => {
    const opts = {
      regions: new Set(),
      teams: Object.keys(TEAM_GROUPS),
      owners: Object.values(FLAT_TEAM_MAP).sort(),
      accounts: new Set(),
      csms: new Set(),
      tams: new Set(),
      stages: ["Open", "Pending", "On Hold"],
      health: ["Healthy", "Needs Attention", "Action Immediately"],
    };
    
    tickets.forEach((t) => {
      if (t.custom_fields?.tnt__region_salesforce) opts.regions.add(t.custom_fields.tnt__region_salesforce);
      if (t.custom_fields?.tnt__instance_account_name) opts.accounts.add(t.custom_fields.tnt__instance_account_name);
      if (t.custom_fields?.tnt__csm_email_id) opts.csms.add(t.custom_fields.tnt__csm_email_id);
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

  // ✅ AUTO-ROLE DETECTION LOGIC
  useEffect(() => {
    if (isAuthenticated && currentUser && options.csms.length > 0 && !hasAutoAppliedRole.current) {
      const userEmail = currentUser.email || ""; 
      
      if (options.csms.includes(userEmail)) {
        console.log("🤖 Auto-detected CSM Role:", userEmail);
        setFilter("csms", [userEmail]);
        setVisibleFilterKeys((prev) => Array.from(new Set([...prev, "csms"])));
        hasAutoAppliedRole.current = true;
      } 
      else if (options.tams.includes(userEmail)) {
        console.log("🤖 Auto-detected TAM Role:", userEmail);
        setFilter("tams", [userEmail]);
        setVisibleFilterKeys((prev) => Array.from(new Set([...prev, "tams"])));
        hasAutoAppliedRole.current = true;
      }
    }
  }, [isAuthenticated, currentUser, options]);

  // ✅ Handle KPI Card Clicks
  const handleKPIFilter = (statusValue) => {
    setVisibleFilterKeys((prev) => Array.from(new Set([...prev, "health"])));
    setFilter("health", [statusValue]);
  };

  // -- Memo: Filter Logic --
  const filteredTickets = useMemo(() => {
    return tickets
      .map((t) => {
        const isCSD = t.tags?.some((tagObj) => tagObj.tag?.name === "csd-highlighted");
        const { status, color, icon, days, priority } = getTicketStatus(t.created_date, t.stage?.name, isCSD);
        const region = t.custom_fields?.tnt__region_salesforce || "Unknown";
        const accountName = t.custom_fields?.tnt__instance_account_name || "Unknown";
        const csm = t.custom_fields?.tnt__csm_email_id || "Unknown";
        const tam = t.custom_fields?.tnt__tam || "Unknown";
        const rwtMs = formatRWT(t.custom_fields?.tnt__customer_wait_time);
        const isActive = Object.keys(STAGE_MAP).includes(t.stage?.name);

        return { ...t, uiStatus: status, uiColor: color, uiIcon: icon, days, priority, region, rwtMs, isCSD, isActive, accountName, csm, tam };
      })
      .filter((t) => {
        if (activeTab === "csd" && !t.isCSD) return false;
        if (activeTab !== "analytics" && !t.isActive) return false;

        const currentSearch = (searchQueries[activeTab] || "").toLowerCase();
        const matchesSearch = t.title.toLowerCase().includes(currentSearch) || t.display_id.toLowerCase().includes(currentSearch);
        if (!matchesSearch) return false;

        if (dateRange.start && dateRange.end) {
          if (!isWithinInterval(parseISO(t.created_date), { start: startOfDay(parseISO(dateRange.start)), end: endOfDay(parseISO(dateRange.end)) })) return false;
        }

        const ownerName = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || "Unassigned";

        // Dynamic Filtering
        if (currentFilters.teams.length > 0) {
            const ticketOwnerTeams = Object.entries(TEAM_GROUPS)
              .filter(([team, members]) => Object.values(members).includes(ownerName))
              .map(([team]) => team);
            if (!ticketOwnerTeams.some((team) => currentFilters.teams.includes(team))) return false;
        }
        if (currentFilters.owners.length > 0 && !currentFilters.owners.includes(ownerName)) return false;
        if (currentFilters.regions.length > 0 && !currentFilters.regions.includes(t.region)) return false;
        if (currentFilters.accounts.length > 0 && !currentFilters.accounts.includes(t.accountName)) return false;
        if (currentFilters.csms.length > 0 && !currentFilters.csms.includes(t.csm)) return false;
        if (currentFilters.tams.length > 0 && !currentFilters.tams.includes(t.tam)) return false;
        
        if (activeTab !== "analytics") {
            const stageLabel = STAGE_MAP[t.stage?.name]?.label || "Unknown";
            if (currentFilters.stages.length > 0 && !currentFilters.stages.includes(stageLabel)) return false;
            if (currentFilters.health.length > 0 && !currentFilters.health.includes(t.uiStatus)) return false;
        }

        return true;
      });
  }, [tickets, activeTab, searchQueries, dateRange, currentFilters]);

  if (!googleClientId) return <div className="flex h-screen items-center justify-center">Loading Configuration...</div>;
  if (!isAuthenticated) return <GoogleOAuthProvider clientId={googleClientId}><LoginScreen /></GoogleOAuthProvider>;

  return (
    <div className={`min-h-screen p-6 font-sans transition-colors duration-300 ${theme === "dark" ? "bg-[#0B1120] text-slate-100" : "bg-slate-100 text-slate-900"}`}>
      <div className="max-w-[1800px] mx-auto">
        {/* HEADER */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <img src="https://res.cloudinary.com/diwc3efjb/image/upload/v1766049455/clevertap_vtpmh8.jpg" className="h-10 rounded-md" alt="Logo" />
            <div>
              <h1 className="text-xl font-bold">Customer Success Dashboard</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Welcome, {currentUser?.name} • {isLoading ? "Syncing..." : `${tickets.length} tickets`}</p>
            </div>
          </div>
          <div className="flex gap-3 items-center">
            <button onClick={toggleTheme} className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm">
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
            <button onClick={fetchTickets} disabled={isLoading} className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm">
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} /> Sync
            </button>
            {/* HIDDEN INPUT FOR CSV UPLOAD */}
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleRosterUpload} 
              className="hidden" 
              accept=".csv"
            />
            
            {/* BUTTON TO TRIGGER UPLOAD */}
            <button 
              onClick={() => fileInputRef.current.click()} 
              className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-slate-500"
              title="Upload Shift Roster"
            >
              <Users className="w-4 h-4" /> {/* Or any icon representing roster */}
            </button>
            <button onClick={logout} className="flex items-center gap-2 bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/50 px-4 py-2 rounded-lg text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors shadow-sm font-medium">
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </div>

        {/* TABS */}
        <div className="flex gap-8 border-b border-slate-200 dark:border-slate-800 mb-6">
          {[
            { id: "tickets", icon: Users, label: "Ticket View" },
            { id: "csd", icon: Star, label: "CSD Highlighted" },
            { id: "analytics", icon: BarChart3, label: "Analytics" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`pb-3 text-sm font-medium flex items-center gap-2 transition-colors ${activeTab === t.id ? "text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`}
            >
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        {/* ✅ SMART FILTER BAR */}
        <div className="bg-white dark:bg-slate-900 p-3 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 mb-6 flex flex-wrap gap-2 items-center transition-colors min-h-[60px]">
          
          {/* 1. SEARCH: Hidden on Analytics */}
          {activeTab !== "analytics" && (
            <div className="relative w-32">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="ID..."
                className="w-full pl-8 pr-2 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-400 dark:text-slate-200"
                value={searchQueries[activeTab] || ""}
                onChange={(e) => setSearchQueries((prev) => ({ ...prev, [activeTab]: e.target.value }))}
              />
            </div>
          )}

          {/* 2. FIXED: Date Range (Visible Everywhere) */}
          <SmartDatePicker onChange={setDateRange} />

          {/* 3. ✅ FIXED: Team & Member (VISIBLE ONLY ON ANALYTICS) */}
          {activeTab === "analytics" && (
            <>
              <MultiSelectFilter
                icon={Layers}
                label="Team"
                options={options.teams}
                selected={currentFilters.teams}
                onChange={(v) => setFilter("teams", v)}
              />
              <MultiSelectFilter
                icon={Users}
                label="Member"
                options={options.owners}
                selected={currentFilters.owners}
                onChange={(v) => setFilter("owners", v)}
              />
            </>
          )}

          {/* 4. DYNAMIC CHIPS (Hidden on Analytics) */}
          {activeTab !== "analytics" &&
            visibleFilterKeys.map((key) => {
              const config = FILTER_CONFIG.find((f) => f.key === key);
              if (!config) return null;
              
              return (
                <div key={key} className="relative group animate-in zoom-in-95 duration-200">
                  <MultiSelectFilter
                    icon={config.icon}
                    label={config.label}
                    options={options[key]}
                    selected={currentFilters[key]}
                    onChange={(v) => setFilter(key, v)}
                  />
                  <button
                    onClick={() => {
                        setFilter(key, []); 
                        setVisibleFilterKeys(prev => prev.filter(k => k !== key));
                    }}
                    className="absolute -top-1 -right-1 bg-slate-200 dark:bg-slate-700 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-2.5 h-2.5 text-slate-600 dark:text-slate-300" />
                  </button>
                </div>
              );
            })}

          {/* 5. ADD FILTER BUTTON (Hidden on Analytics) */}
          {activeTab !== "analytics" && (
            <div className="relative group ml-1">
              <button className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Filter
              </button>
              
              <div className="absolute top-full left-0 mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 p-1 hidden group-focus-within:block">
                {FILTER_CONFIG.filter(f => !visibleFilterKeys.includes(f.key)).map(f => (
                    <button
                        key={f.key}
                        onClick={() => setVisibleFilterKeys(prev => [...prev, f.key])}
                        className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg"
                    >
                        <f.icon className="w-3.5 h-3.5 opacity-70" /> {f.label}
                    </button>
                ))}
              </div>
            </div>
          )}
        </div>

       {/* CONTENT */}
        {activeTab === "analytics" ? (
          <AnalyticsDashboard
            tickets={filteredTickets}
            dateRange={dateRange}
            filterOwner={
              currentFilters.owners.length > 0
                ? currentFilters.owners[0]
                : "All"
            }
          />
        ) : (
          <TicketList
            tickets={filteredTickets}
            isCSDView={activeTab === "csd"}
            onCardClick={handleKPIFilter}
            // ✅ NEW: Pass the click handler here
            onProfileClick={setSelectedUserProfile} 
          />
        )}
      </div>

      {/* ✅ PROFILE MODAL */}
       {selectedUserProfile && (
         (() => {
           // 1. Get ALL tickets for this specific user
           const userTickets = tickets.filter(t => 
              (FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || "") === selectedUserProfile.name
           );

           // 2. Separate them
           // Active = For AI to analyze workload
           const activeForUser = userTickets.filter(t => 
             t.stage?.name !== 'Solved' && t.stage?.name !== 'Closed' && t.stage?.name !== 'Cancelled'
           );

           // Solved = For KPI Stats (Avg Resolution)
           const solvedForUser = userTickets.filter(t => 
             t.stage?.name === 'Solved' || t.stage?.name === 'Closed' || t.stage?.name == "Resolved"
           );

           return (
             <ProfileStatsModal 
               user={selectedUserProfile}
               tickets={activeForUser}       // Pass ONLY active for AI context
               solvedTickets={solvedForUser} // ✅ Pass REAL solved tickets here
               onClose={() => setSelectedUserProfile(null)}
             />
           );
         })()
       )}
    </div>
  );
};

export default App;
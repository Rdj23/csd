import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ChevronRight,
  Package,
  Layers,
  GitBranch,
  Search,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Loader2,
  TreePine,
  Filter as FilterIcon,
  ChevronsDownUp,
  ChevronsUpDown,
  BarChart3,
  Ticket,
  Boxes,
  Component,
  X,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Tooltip as RechartsTooltip,
} from "recharts";
import MultiSelectFilter from "../../../components/common/MultiSelectFilter";
import SmartDateRangePicker from "../../../components/common/SmartDateRangePicker";
import { fetchPartsTree, fetchPartTickets } from "../../../api/partsApi";

/**
 * PartsView — visualises DevRev's part hierarchy (Product > Capability > Feature >
 * sub-Feature) with ticket counts rolled up to every level, expandable down to the
 * individual tickets. Counts/structure come from the backend (Mongo/Redis); the UI
 * never calls DevRev directly.
 *
 * Props:
 *   filterOptions — App's `options` object (reused: accounts, stages, ...).
 *   tickets       — App's live ticket array (used only to derive the priority filter).
 *   isDark        — theme flag (used to theme the Recharts bar chart).
 */

// Per-level visual treatment (icon + accent), so the tree reads like DevRev's.
const LEVEL_META = {
  product: { Icon: Package, accent: "text-indigo-500", bar: "bg-indigo-500", ring: "ring-indigo-500/30", chip: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300" },
  capability: { Icon: Layers, accent: "text-blue-500", bar: "bg-blue-500", ring: "ring-blue-500/30", chip: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300" },
  feature: { Icon: GitBranch, accent: "text-emerald-500", bar: "bg-emerald-500", ring: "ring-emerald-500/30", chip: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300" },
  unknown: { Icon: AlertCircle, accent: "text-amber-500", bar: "bg-amber-500", ring: "ring-amber-500/30", chip: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300" },
};
const levelMeta = (type) => LEVEL_META[type] || LEVEL_META.feature;

// Ordered palette for the bar chart (indigo → violet → blue → teal …) so the busiest
// products read in a calm, branded gradient rather than clashing colors.
const BAR_PALETTE = ["#6366f1", "#7c3aed", "#8b5cf6", "#a855f7", "#3b82f6", "#0ea5e9", "#06b6d4", "#10b981", "#f59e0b", "#ec4899"];

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
};

// Walk the tree tallying node counts per level (for the KPI strip).
const tallyTypes = (nodes, acc = { product: 0, capability: 0, feature: 0 }) => {
  for (const n of nodes) {
    if (n.type in acc) acc[n.type] += 1;
    if (n.children?.length) tallyTypes(n.children, acc);
  }
  return acc;
};

// Recursively filter the tree by a search query (matches name OR display_id).
const filterTree = (nodes, q) => {
  if (!q) return nodes;
  const out = [];
  for (const node of nodes) {
    const selfMatch =
      (node.name || "").toLowerCase().includes(q) ||
      (node.display_id || "").toLowerCase().includes(q);
    const kids = filterTree(node.children || [], q);
    if (selfMatch || kids.length) out.push({ ...node, children: kids });
  }
  return out;
};

// ─────────────────────────────────────────────────────────────────────────
// KPI stat pill
// ─────────────────────────────────────────────────────────────────────────
const StatCard = ({ icon: Icon, label, value, accent }) => (
  <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 min-w-[140px]"
       style={{ boxShadow: "var(--shadow-card)" }}>
    <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${accent}`}>
      {Icon && <Icon className="w-4 h-4" />}
    </div>
    <div className="leading-tight">
      <div className="text-lg font-bold text-slate-800 dark:text-slate-100 tabular-nums">{value}</div>
      <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────
// Chart tooltip (themed)
// ─────────────────────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 shadow-lg">
      <div className="text-xs font-semibold text-slate-700 dark:text-slate-100">{d.fullName}</div>
      <div className="text-xs text-slate-500 dark:text-slate-300">
        <span className="font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">{d.count.toLocaleString()}</span> tickets
      </div>
      <div className="text-[10px] text-slate-400 mt-0.5">Click to filter the tree</div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Ticket drilldown (lazy-loaded when a node's tickets are revealed)
// ─────────────────────────────────────────────────────────────────────────
const TicketDrilldown = ({ partId, filters }) => {
  const [tickets, setTickets] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(
    async (pageToLoad) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchPartTickets(partId, filters, { page: pageToLoad, pageSize: 25 });
        setTickets((prev) => (pageToLoad === 1 ? res.tickets || [] : [...prev, ...(res.tickets || [])]));
        setTotal(res.total || 0);
        setHasMore(!!res.hasMore);
        setPage(pageToLoad);
      } catch (e) {
        setError(e?.response?.data?.error?.message || "Failed to load tickets");
      } finally {
        setLoading(false);
      }
    },
    [partId, filters],
  );

  useEffect(() => {
    load(1);
  }, [load]);

  if (loading && tickets.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading tickets…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-rose-500">
        <AlertCircle className="w-3.5 h-3.5" /> {error}
      </div>
    );
  }
  if (tickets.length === 0) {
    return <div className="px-4 py-3 text-xs italic text-slate-400">No tickets match the current filters.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-400 text-left border-b border-slate-100 dark:border-slate-800">
            <th className="font-semibold px-4 py-2">ID</th>
            <th className="font-semibold px-3 py-2">Title</th>
            <th className="font-semibold px-3 py-2">Account</th>
            <th className="font-semibold px-3 py-2">Priority</th>
            <th className="font-semibold px-3 py-2">Status</th>
            <th className="font-semibold px-3 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr
              key={t.ticket_id || t.display_id}
              className="border-b border-slate-50 dark:border-slate-800/60 hover:bg-white dark:hover:bg-slate-800/40 transition-colors"
            >
              <td className="px-4 py-2 whitespace-nowrap">
                <a
                  href={t.devrevUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  {t.display_id}
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              </td>
              <td className="px-3 py-2 max-w-[340px] truncate text-slate-700 dark:text-slate-200" title={t.title}>
                {t.is_active && (
                  <span className="mr-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 align-middle" title="Active ticket" />
                )}
                {t.title}
              </td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{t.account_name || "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {t.priority ? (
                  <span className="uppercase text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {t.priority}
                  </span>
                ) : "—"}
              </td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{t.status || "—"}</td>
              <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{fmtDate(t.created_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-[11px] text-slate-400">
          Showing {tickets.length} of {total}
        </span>
        {hasMore && (
          <button
            onClick={() => load(page + 1)}
            disabled={loading}
            className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Recursive tree node
// ─────────────────────────────────────────────────────────────────────────
const TreeNode = ({ node, depth, maxCount, filters, autoOpen }) => {
  const hasChildren = (node.children || []).length > 0;
  const [open, setOpen] = useState(autoOpen);
  const [showTickets, setShowTickets] = useState(false);

  const meta = levelMeta(node.type);
  const Icon = meta.Icon;
  const pct = maxCount > 0 ? Math.max(2, Math.round((node.count / maxCount) * 100)) : 0;

  const onToggle = () => {
    if (hasChildren) setOpen((o) => !o);
    else setShowTickets((s) => !s);
  };
  const expanded = hasChildren ? open : showTickets;

  return (
    <li role="treeitem" aria-expanded={node.count > 0 ? expanded : undefined} className="select-none">
      <div
        className="group flex items-center gap-2 rounded-lg pr-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        <button
          onClick={onToggle}
          disabled={node.count === 0 && !hasChildren}
          aria-label={expanded ? "Collapse" : "Expand"}
          className="flex items-center justify-center w-5 h-5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-25 disabled:cursor-default"
        >
          {(hasChildren || node.count > 0) && (
            <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} />
          )}
        </button>

        <Icon className={`w-4 h-4 shrink-0 ${meta.accent}`} />

        <button onClick={onToggle} className="flex-1 min-w-0 flex items-center gap-2 text-left" title={node.name}>
          <span className="truncate text-[13px] font-medium text-slate-700 dark:text-slate-200">{node.name}</span>
          {node.display_id && (
            <span className="hidden sm:inline font-mono text-[10px] text-slate-400">{node.display_id}</span>
          )}
          <span className={`hidden md:inline text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded ${meta.chip}`}>
            {node.type}
          </span>
        </button>

        {/* Proportion bar — heavier parts visibly pop */}
        <div className="hidden sm:block w-24 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" aria-hidden="true">
          <div className={`h-full rounded-full ${meta.bar} transition-all`} style={{ width: `${pct}%` }} />
        </div>

        {/* Rolled-up count badge — click to view this subtree's tickets */}
        <button
          onClick={() => node.count > 0 && setShowTickets((s) => !s)}
          disabled={node.count === 0}
          title={node.count > 0 ? "View tickets in this part" : "No tickets"}
          className={`shrink-0 min-w-[2.75rem] text-center text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums transition-all
            ${node.count > 0
              ? `bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 hover:ring-2 ${meta.ring} cursor-pointer ${showTickets ? `ring-2 ${meta.ring}` : ""}`
              : "bg-transparent text-slate-300 dark:text-slate-600 cursor-default"}`}
        >
          {node.count.toLocaleString()}
        </button>
      </div>

      {/* Inline ticket list for this node (subtree) */}
      {showTickets && node.count > 0 && (
        <div
          className="my-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 overflow-hidden"
          style={{ marginLeft: `${depth * 20 + 30}px`, marginRight: "8px" }}
        >
          <TicketDrilldown partId={node.id} filters={filters} />
        </div>
      )}

      {/* Children — with a faint guide line for hierarchy legibility */}
      {hasChildren && open && (
        <ul role="group" className="border-l border-slate-100 dark:border-slate-800/70" style={{ marginLeft: `${depth * 20 + 18}px` }}>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={0}
              maxCount={maxCount}
              filters={filters}
              autoOpen={autoOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Main tab
// ─────────────────────────────────────────────────────────────────────────
const PartsView = ({ filterOptions = {}, tickets = [], isDark = false }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [treeGen, setTreeGen] = useState(0);
  const [expandAll, setExpandAll] = useState(false);
  const [showChart, setShowChart] = useState(true);

  // Server-side filters
  const [priorities, setPriorities] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [dateRange, setDateRange] = useState({ start: "", end: "" });

  const filters = useMemo(
    () => ({
      priorities,
      statuses,
      accounts,
      dateFrom: dateRange?.start || undefined,
      dateTo: dateRange?.end || undefined,
    }),
    [priorities, statuses, accounts, dateRange],
  );

  const priorityOptions = useMemo(() => {
    const set = new Set();
    tickets.forEach((t) => t.priority && set.add(t.priority));
    return Array.from(set).sort();
  }, [tickets]);

  const accountOptions = filterOptions.accounts || [];
  const statusOptions = filterOptions.stages || ["Open", "Pending", "On Hold", "Solved"];

  const loadTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPartsTree(filters);
      setData(res);
    } catch (e) {
      setError(e?.response?.data?.error?.message || "Failed to load the parts tree");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  const q = search.trim().toLowerCase();
  const visibleTree = useMemo(() => filterTree(data?.tree || [], q), [data, q]);
  const maxCount = useMemo(() => (data?.tree || []).reduce((m, n) => Math.max(m, n.count || 0), 0), [data]);
  const typeTally = useMemo(() => tallyTypes(data?.tree || []), [data]);

  // Top products for the bar chart (truncate long names for the Y axis label).
  const chartData = useMemo(() => {
    return (data?.tree || [])
      .filter((n) => n.type === "product" && n.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((n) => ({
        id: n.id,
        fullName: n.name,
        name: n.name.length > 22 ? n.name.slice(0, 21) + "…" : n.name,
        count: n.count,
      }));
  }, [data]);

  const searchActive = q.length > 0;
  const nodeAutoOpen = searchActive || expandAll;

  const setExpandAllMode = (mode) => {
    setExpandAll(mode);
    setTreeGen((g) => g + 1);
  };

  const activeFilterCount = priorities.length + statuses.length + accounts.length + (dateRange?.start ? 1 : 0);
  const axisColor = isDark ? "#94a3b8" : "#64748b";

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* ── Header: title + KPI strip ── */}
      <div className="shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <TreePine className="w-5 h-5 text-indigo-500" /> Parts View
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Tickets by DevRev product → capability → feature, expandable to individual tickets.</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowChart((s) => !s)}
              className={`flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 ${showChart ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"}`}
              title="Toggle chart"
            >
              <BarChart3 className="w-3.5 h-3.5" /> Chart
            </button>
            <button
              onClick={() => setExpandAllMode(!expandAll)}
              className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {expandAll ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
              {expandAll ? "Collapse all" : "Expand all"}
            </button>
            <button
              onClick={loadTree}
              className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

        {data && !error && (
          <div className="flex flex-wrap gap-2.5">
            <StatCard icon={Ticket} label="Tickets" value={(data.totalTickets || 0).toLocaleString()} accent="bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300" />
            <StatCard icon={Package} label="Products" value={typeTally.product} accent="bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300" />
            <StatCard icon={Boxes} label="Capabilities" value={typeTally.capability} accent="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300" />
            <StatCard icon={Component} label="Features" value={typeTally.feature} accent="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300" />
          </div>
        )}
      </div>

      {/* ── Bar chart: tickets by product ── */}
      {showChart && data && !error && chartData.length > 0 && (
        <div className="shrink-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
             style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Tickets by Product (Top {chartData.length})</h3>
            <span className="text-[10px] text-slate-400">Click a bar to filter</span>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 30)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 28, left: 8, bottom: 0 }} barCategoryGap={6}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                tick={{ fontSize: 11, fill: axisColor }}
                axisLine={false}
                tickLine={false}
              />
              <RechartsTooltip cursor={{ fill: isDark ? "rgba(148,163,184,0.08)" : "rgba(99,102,241,0.06)" }} content={<ChartTooltip />} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} onClick={(d) => d?.fullName && setSearch(d.fullName)} label={{ position: "right", fontSize: 11, fill: axisColor }}>
                {chartData.map((entry, i) => (
                  <Cell key={entry.id} fill={BAR_PALETTE[i % BAR_PALETTE.length]} cursor="pointer" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Filter / control bar ── */}
      <div className="shrink-0 flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parts or tickets…"
            aria-label="Search parts by name or id"
            className="w-full pl-8 pr-7 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-400 dark:text-slate-200"
          />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-2 top-2 text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {priorityOptions.length > 0 && (
          <MultiSelectFilter icon={FilterIcon} label="Priority" options={priorityOptions} selected={priorities} onChange={setPriorities} />
        )}
        <MultiSelectFilter icon={FilterIcon} label="Status" options={statusOptions} selected={statuses} onChange={setStatuses} />
        {accountOptions.length > 0 && (
          <MultiSelectFilter icon={FilterIcon} label="Account" options={accountOptions} selected={accounts} onChange={setAccounts} />
        )}
        <SmartDateRangePicker value={dateRange} onChange={setDateRange} />

        {activeFilterCount > 0 && (
          <button
            onClick={() => { setPriorities([]); setStatuses([]); setAccounts([]); setDateRange({ start: "", end: "" }); }}
            className="text-[11px] font-medium text-rose-500 hover:underline"
          >
            Clear filters ({activeFilterCount})
          </button>
        )}
      </div>

      {/* ── Tree / states ── */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 custom-scrollbar"
           style={{ boxShadow: "var(--shadow-card)" }}>
        {loading && !data ? (
          <div className="flex flex-col items-center justify-center h-72 gap-3 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            <span className="text-sm">Building the parts tree…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-72 gap-3 text-center px-6">
            <AlertCircle className="w-8 h-8 text-rose-500" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{error}</p>
            <button onClick={loadTree} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
              Retry
            </button>
          </div>
        ) : visibleTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-72 gap-2 text-center px-6">
            <TreePine className="w-8 h-8 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              {searchActive ? "No parts match your search." : "No parts to show yet."}
            </p>
            <p className="text-xs text-slate-400 max-w-sm">
              {searchActive
                ? "Try a different name or ticket id."
                : "Once the daily sync has tagged tickets with their DevRev part, the hierarchy will appear here."}
            </p>
          </div>
        ) : (
          <ul role="tree" aria-label="DevRev part hierarchy" className="py-2 pr-1">
            {visibleTree.map((node) => (
              <TreeNode
                key={`${node.id}-${treeGen}`}
                node={node}
                depth={0}
                maxCount={maxCount}
                filters={filters}
                autoOpen={nodeAutoOpen}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default PartsView;

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
} from "lucide-react";
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
 *
 * Dark theme is handled entirely via Tailwind `dark:` classes (no isDark prop needed).
 */

// Per-level visual treatment (icon + accent), so the tree reads like DevRev's.
const LEVEL_META = {
  product: { Icon: Package, accent: "text-indigo-500", bar: "bg-indigo-500", chip: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300" },
  capability: { Icon: Layers, accent: "text-blue-500", bar: "bg-blue-500", chip: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300" },
  feature: { Icon: GitBranch, accent: "text-emerald-500", bar: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300" },
  unknown: { Icon: AlertCircle, accent: "text-amber-500", bar: "bg-amber-500", chip: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300" },
};
const levelMeta = (type) => LEVEL_META[type] || LEVEL_META.feature;

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
};

// ── Recursively filter the tree by a search query (matches name OR display_id) ──
// Keeps a node if it matches, or if any descendant matches (so the path stays visible).
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

  // Reload from page 1 whenever the part or filters change.
  useEffect(() => {
    load(1);
  }, [load]);

  if (loading && tickets.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading tickets…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-rose-500">
        <AlertCircle className="w-3.5 h-3.5" /> {error}
      </div>
    );
  }
  if (tickets.length === 0) {
    return <div className="px-3 py-3 text-xs italic text-slate-400">No tickets match the current filters.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-400 text-left">
            <th className="font-medium px-3 py-1.5">ID</th>
            <th className="font-medium px-3 py-1.5">Title</th>
            <th className="font-medium px-3 py-1.5">Account</th>
            <th className="font-medium px-3 py-1.5">Priority</th>
            <th className="font-medium px-3 py-1.5">Status</th>
            <th className="font-medium px-3 py-1.5">Created</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr
              key={t.ticket_id || t.display_id}
              className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              <td className="px-3 py-1.5 whitespace-nowrap">
                <a
                  href={t.devrevUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  {t.display_id}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </td>
              <td className="px-3 py-1.5 max-w-[320px] truncate text-slate-700 dark:text-slate-200" title={t.title}>
                {t.is_active && (
                  <span className="mr-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 align-middle" title="Active ticket" />
                )}
                {t.title}
              </td>
              <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{t.account_name || "—"}</td>
              <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400 uppercase">{t.priority || "—"}</td>
              <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{t.status || "—"}</td>
              <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{fmtDate(t.created_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] text-slate-400">
          Showing {tickets.length} of {total}
        </span>
        {hasMore && (
          <button
            onClick={() => load(page + 1)}
            disabled={loading}
            className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
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

  // Chevron toggles children when present; for a leaf it toggles the ticket list.
  const onToggle = () => {
    if (hasChildren) setOpen((o) => !o);
    else setShowTickets((s) => !s);
  };
  const expanded = hasChildren ? open : showTickets;

  return (
    <li role="treeitem" aria-expanded={node.count > 0 ? expanded : undefined} className="select-none">
      <div
        className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50"
        style={{ paddingLeft: `${depth * 18 + 8}px` }}
      >
        {/* Expand/collapse control */}
        <button
          onClick={onToggle}
          disabled={node.count === 0 && !hasChildren}
          aria-label={expanded ? "Collapse" : "Expand"}
          className="flex items-center justify-center w-5 h-5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 disabled:cursor-default"
        >
          {(hasChildren || node.count > 0) && (
            <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} />
          )}
        </button>

        <Icon className={`w-4 h-4 shrink-0 ${meta.accent}`} />

        {/* Name + level chip */}
        <button
          onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-2 text-left"
          title={node.name}
        >
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
          <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${pct}%` }} />
        </div>

        {/* Rolled-up count badge — click to view this subtree's tickets */}
        <button
          onClick={() => node.count > 0 && setShowTickets((s) => !s)}
          disabled={node.count === 0}
          title={node.count > 0 ? "View tickets in this part" : "No tickets"}
          className={`shrink-0 min-w-[2.5rem] text-center text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums
            ${node.count > 0
              ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 hover:ring-1 hover:ring-indigo-400 cursor-pointer"
              : "bg-transparent text-slate-300 dark:text-slate-600 cursor-default"}`}
        >
          {node.count}
        </button>
      </div>

      {/* Inline ticket list for this node (subtree) */}
      {showTickets && node.count > 0 && (
        <div
          className="ml-6 my-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60"
          style={{ marginLeft: `${depth * 18 + 28}px` }}
        >
          <TicketDrilldown partId={node.id} filters={filters} />
        </div>
      )}

      {/* Children */}
      {hasChildren && open && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
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
const PartsView = ({ filterOptions = {}, tickets = [] }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [treeGen, setTreeGen] = useState(0); // bump to remount nodes (expand/collapse all)
  const [expandAll, setExpandAll] = useState(false);

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

  // Priority options derived from the live ticket set (analyticstickets stores the
  // same `priority` values, so this stays consistent with what the backend filters on).
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
  const maxCount = useMemo(
    () => (data?.tree || []).reduce((m, n) => Math.max(m, n.count || 0), 0),
    [data],
  );

  const searchActive = q.length > 0;
  const nodeAutoOpen = searchActive || expandAll;

  const setExpandAllMode = (mode) => {
    setExpandAll(mode);
    setTreeGen((g) => g + 1); // remount nodes so they pick up the new default
  };

  const activeFilterCount =
    priorities.length + statuses.length + accounts.length + (dateRange?.start ? 1 : 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Filter / control bar */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 mb-3">
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parts or tickets…"
            aria-label="Search parts by name or id"
            className="w-full pl-8 pr-2 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-400 dark:text-slate-200"
          />
        </div>

        {priorityOptions.length > 0 && (
          <MultiSelectFilter icon={FilterIcon} label="Priority" options={priorityOptions} selected={priorities} onChange={setPriorities} />
        )}
        <MultiSelectFilter icon={FilterIcon} label="Status" options={statusOptions} selected={statuses} onChange={setStatuses} />
        {accountOptions.length > 0 && (
          <MultiSelectFilter icon={FilterIcon} label="Account" options={accountOptions} selected={accounts} onChange={setAccounts} />
        )}
        <SmartDateRangePicker value={dateRange} onChange={setDateRange} />

        <div className="flex-1" />

        <button
          onClick={() => setExpandAllMode(!expandAll)}
          className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          title={expandAll ? "Collapse all" : "Expand all"}
        >
          {expandAll ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
          {expandAll ? "Collapse" : "Expand"}
        </button>
        <button
          onClick={loadTree}
          className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Summary strip */}
      {data && !loading && !error && (
        <div className="shrink-0 flex items-center gap-3 mb-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <TreePine className="w-3.5 h-3.5 text-indigo-500" />
            <strong className="text-slate-700 dark:text-slate-200 tabular-nums">{data.totalTickets}</strong> tickets across{" "}
            <strong className="text-slate-700 dark:text-slate-200 tabular-nums">{visibleTree.length}</strong> products
          </span>
          {activeFilterCount > 0 && <span className="text-indigo-500">· {activeFilterCount} filter(s) active</span>}
        </div>
      )}

      {/* Tree / states */}
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
            <button
              onClick={loadTree}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
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
                : "Once the parts-sync job has tagged tickets with their DevRev part, the hierarchy will appear here."}
            </p>
          </div>
        ) : (
          <ul role="tree" aria-label="DevRev part hierarchy" className="py-2 pr-2">
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

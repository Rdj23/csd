import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronRight,
  Package,
  Layers,
  GitBranch,
  AlertCircle,
  Search,
  RefreshCw,
  TreePine,
  Filter as FilterIcon,
  ChevronsDownUp,
  ChevronsUpDown,
  X,
  BarChart3,
  LineChart,
  Pin,
  PinOff,
  Tag,
  Globe,
} from "lucide-react";
import MultiSelectFilter from "../../../components/common/MultiSelectFilter";
import SmartDateRangePicker from "../../../components/common/SmartDateRangePicker";
import { fetchPartsTree } from "../../../api/partsApi";
import { usePersistentState } from "../hooks/usePersistentState";
import { filterTree, flattenTree, collectRootIds, collectAllIds, findPath, INDENT, rowHeightFor } from "../lib/treeUtils";
import { MagnitudeBar, Sparkline, TrendDelta } from "./primitives";
import TicketDrilldown from "./TicketDrilldown";
import CompositionChart from "./CompositionChart";
import PartsTrendChart from "./PartsTrendChart";

/**
 * PartsView — redesigned. A virtualized, depth-aware hierarchy of DevRev parts with
 * rolled-up counts, magnitude bars, a 7-day trend signal, and inline ticket drilldown.
 * Data comes only from /api/parts-tree + /api/parts/:id/tickets.
 */

// Per-depth visual treatment. Hierarchy reads at a glance: products are heaviest with
// a faint band, capabilities medium, features light/smaller. The icon encodes type —
// no redundant text chips, only the muted monospace id.
const TYPE = {
  product: {
    Icon: Package,
    icon: "text-indigo-500 dark:text-indigo-400",
    name: "text-[14px] font-semibold text-slate-800 dark:text-slate-100",
    band: "bg-slate-50/80 dark:bg-white/[0.025]",
  },
  capability: {
    Icon: Layers,
    icon: "text-blue-500 dark:text-blue-400",
    name: "text-[13px] font-medium text-slate-700 dark:text-slate-200",
    band: "",
  },
  feature: {
    Icon: GitBranch,
    icon: "text-emerald-500 dark:text-emerald-400",
    name: "text-[12.5px] font-normal text-slate-600 dark:text-slate-300",
    band: "",
  },
  unknown: {
    Icon: AlertCircle,
    icon: "text-amber-500 dark:text-amber-400",
    name: "text-[13px] font-medium text-slate-600 dark:text-slate-300",
    band: "",
  },
};
const typeOf = (t) => TYPE[t] || TYPE.feature;

// ── Connector guides ──────────────────────────────────────────────────────
// Columns 0..D-2 draw an ancestor's continuing vertical line (guides[k+1]); the
// rightmost column draws this node's elbow (tee if it has a following sibling, else
// a corner). guides[0] (the product level) never renders a line.
const GuideRail = ({ depth, guides, isLast }) => {
  if (depth === 0) return null;
  const cols = [];
  for (let k = 0; k < depth; k++) {
    const isElbow = k === depth - 1;
    if (isElbow) {
      cols.push(
        <span key={k} className="relative inline-block shrink-0" style={{ width: INDENT, height: "100%" }} aria-hidden="true">
          {/* vertical: top → center (connect up) + center → bottom if not last */}
          <span className="absolute left-1/2 top-0 w-px bg-slate-300/70 dark:bg-slate-600/50" style={{ height: isLast ? "50%" : "100%" }} />
          {/* horizontal elbow: center → right */}
          <span className="absolute left-1/2 right-0 bg-slate-300/70 dark:bg-slate-600/50" style={{ top: "50%", height: 1 }} />
        </span>,
      );
    } else {
      const draw = guides[k + 1];
      cols.push(
        <span key={k} className="relative inline-block shrink-0" style={{ width: INDENT, height: "100%" }} aria-hidden="true">
          {draw && <span className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300/70 dark:bg-slate-600/50" />}
        </span>,
      );
    }
  }
  return <span className="flex self-stretch shrink-0">{cols}</span>;
};

// ── Single tree row ─────────────────────────────────────────────────────────
const PartRow = ({ row, isFocused, isContext, onActivate }) => {
  const { node, depth, guides, isLast, hasChildren, expanded, siblingMax } = row;
  const t = typeOf(node.type);
  const Icon = t.Icon;
  const canExpand = hasChildren || node.count > 0;
  const up = node.delta > 0 ? true : node.delta < 0 ? false : null;

  return (
    <div
      role="treeitem"
      aria-expanded={canExpand ? expanded : undefined}
      aria-level={depth + 1}
      tabIndex={-1}
      onClick={() => onActivate(node)}
      className={`group flex items-stretch h-full cursor-pointer outline-none ${t.band}
        ${isFocused ? "ring-2 ring-inset ring-indigo-500/70" : isContext ? "bg-indigo-50/60 dark:bg-indigo-500/[0.07]" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"}`}
    >
      <GuideRail depth={depth} guides={guides} isLast={isLast} />

      {/* chevron */}
      <span className="flex items-center justify-center shrink-0" style={{ width: 22 }}>
        {canExpand && (
          <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} />
        )}
      </span>

      {/* icon */}
      <span className="flex items-center shrink-0 pr-2">
        <Icon className={`${node.type === "product" ? "w-[18px] h-[18px]" : "w-4 h-4"} ${t.icon}`} />
      </span>

      {/* name + muted id */}
      <span className="flex items-center gap-2 min-w-0 flex-1 pr-3">
        <span className={`truncate ${t.name}`}>{node.name}</span>
        {node.display_id && (
          <span className="hidden sm:inline font-mono text-[10px] text-slate-400/80 dark:text-slate-500 shrink-0">{node.display_id}</span>
        )}
      </span>

      {/* trend cluster: sparkline + delta */}
      <span className="hidden md:flex items-center gap-2 shrink-0 pr-3" style={{ width: 116 }}>
        <Sparkline data={node.spark || []} up={up} />
        <span className="w-9 text-right"><TrendDelta delta={node.delta || 0} /></span>
      </span>

      {/* magnitude bar (fill = count / max sibling) */}
      <span className="flex items-center shrink-0 pr-3" style={{ width: 176 }}>
        <MagnitudeBar count={node.count} max={siblingMax} type={node.type} />
      </span>
    </div>
  );
};

// ── Skeleton loading rows ────────────────────────────────────────────────────
const SkeletonRows = () => (
  <div className="p-3 space-y-2">
    {Array.from({ length: 9 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3" style={{ paddingLeft: (i % 3) * INDENT }}>
        <div className="w-4 h-4 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
        <div className="h-3 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" style={{ width: `${30 + (i % 4) * 12}%` }} />
        <div className="flex-1" />
        <div className="h-[18px] w-40 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
      </div>
    ))}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
const PartsView = ({ filterOptions = {}, tickets = [] }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [contextId, setContextId] = useState(null); // the part whose composition the donut shows
  const [pendingScrollId, setPendingScrollId] = useState(null);
  const [showChart, setShowChart] = usePersistentState("parts.showChart", true);
  const [showTrend, setShowTrend] = usePersistentState("parts.showTrend", true);
  // Pin = expand the donut; unpinned (default) keeps the breakdown a compact strip so
  // it doesn't eat half the screen. The "Breakdown" button still fully hides the panel.
  const [chartPinned, setChartPinned] = usePersistentState("parts.chartPinned", false);

  // Persisted across reloads
  const [expandedIds, setExpandedIds] = usePersistentState("parts.expanded", []);
  const [pFilters, setPFilters] = usePersistentState("parts.filters", {
    priorities: [], statuses: [], accounts: [], subtypes: [], regions: [], dateRange: { start: "", end: "" },
  });
  // NOTE: `statuses` is intentionally NOT destructured/sent. The Parts tab reads cold,
  // solved-only data, so Open/Pending/On Hold would match nothing and Solved matches
  // everything — the Status filter was removed. We also drop any value a user persisted
  // before this change so a stale "pending" can't silently empty the tree.
  const { priorities, accounts, subtypes = [], regions = [], dateRange } = pFilters;
  const patch = (key, val) => setPFilters((f) => ({ ...f, [key]: val }));

  const filters = useMemo(
    () => ({ priorities, accounts, subtypes, regions, dateFrom: dateRange?.start || undefined, dateTo: dateRange?.end || undefined }),
    [priorities, accounts, subtypes, regions, dateRange],
  );

  const priorityOptions = useMemo(() => {
    const set = new Set();
    tickets.forEach((t) => t.priority && set.add(t.priority));
    return Array.from(set).sort();
  }, [tickets]);
  const accountOptions = filterOptions.accounts || [];
  const regionOptions = filterOptions.regions || [];
  // DevRev ticket classification. Sent lowercased; matched case-insensitively backend-side.
  const subtypeOptions = ["Query", "Bug", "Feature"];

  const loadTree = useCallback(async ({ fresh = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchPartsTree(filters, { fresh }));
    } catch (e) {
      setError(e?.response?.data?.error?.message || "Failed to load the parts tree");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { loadTree(); }, [loadTree]);

  const q = search.trim().toLowerCase();
  const roots = useMemo(() => filterTree(data?.tree || [], q), [data, q]);

  // Donut context: the selected node's children, or products at the top. A leaf with
  // no children falls back to its parent's children (its siblings) so the slice stays
  // meaningful. `path` powers the breadcrumb.
  const context = useMemo(() => {
    const tree = data?.tree || [];
    if (!contextId) return { slices: tree, name: "All products", total: data?.totalTickets || 0, path: [] };
    const path = findPath(tree, contextId);
    const node = path[path.length - 1];
    if (!node) return { slices: tree, name: "All products", total: data?.totalTickets || 0, path: [] };
    if (node.children?.length) return { slices: node.children, name: node.name, total: node.count, path };
    const parent = path[path.length - 2];
    if (parent?.children?.length) return { slices: parent.children, name: parent.name, total: parent.count, path: path.slice(0, -1) };
    return { slices: [node], name: node.name, total: node.count, path };
  }, [data, contextId]);

  // Trendline scope: the actually-selected part (contextId), independent of the donut's
  // childless-leaf fallback. Null contextId → the all-products line.
  const trendName = useMemo(() => {
    if (!contextId) return "All products";
    const p = findPath(data?.tree || [], contextId);
    return p[p.length - 1]?.name || "All products";
  }, [contextId, data]);

  const expandedSet = useMemo(() => {
    if (q) return new Set(collectAllIds(roots)); // auto-expand search matches
    return new Set(expandedIds);
  }, [q, roots, expandedIds]);

  const flatRows = useMemo(() => flattenTree(roots, expandedSet), [roots, expandedSet]);

  // ── Virtualization ──
  const scrollRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => rowHeightFor(flatRows[i]),
    overscan: 14,
    getItemKey: (i) => flatRows[i].key,
    measureElement: typeof window !== "undefined" ? (el) => el?.getBoundingClientRect().height : undefined,
  });

  // ── Expansion controls ──
  const toggle = useCallback((node) => {
    if (q) return; // expansion is forced while searching
    setExpandedIds((prev) => (prev.includes(node.id) ? prev.filter((x) => x !== node.id) : [...prev, node.id]));
  }, [q, setExpandedIds]);

  const expandToCapability = () => setExpandedIds(collectRootIds(data?.tree || []));
  const collapseAll = () => setExpandedIds([]);

  // ── Keyboard navigation ──
  const [focusedKey, setFocusedKey] = useState(null);
  const focusedIndex = useMemo(() => flatRows.findIndex((r) => r.key === focusedKey), [flatRows, focusedKey]);

  const moveFocus = useCallback((idx) => {
    const clamped = Math.max(0, Math.min(flatRows.length - 1, idx));
    const r = flatRows[clamped];
    if (!r) return;
    setFocusedKey(r.key);
    virtualizer.scrollToIndex(clamped, { align: "auto" });
  }, [flatRows, virtualizer]);

  const onKeyDown = (e) => {
    if (!flatRows.length) return;
    const cur = focusedIndex < 0 ? 0 : focusedIndex;
    const row = flatRows[cur];
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); moveFocus(cur + 1); break;
      case "ArrowUp": e.preventDefault(); moveFocus(cur - 1); break;
      case "Home": e.preventDefault(); moveFocus(0); break;
      case "End": e.preventDefault(); moveFocus(flatRows.length - 1); break;
      case "ArrowRight":
        e.preventDefault();
        if (row?.kind === "part" && (row.hasChildren || row.node.count > 0) && !row.expanded) toggle(row.node);
        else moveFocus(cur + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (row?.kind === "part" && row.expanded) toggle(row.node);
        else {
          // jump to parent (nearest shallower row above)
          for (let i = cur - 1; i >= 0; i--) if (flatRows[i].depth < row.depth) { moveFocus(i); break; }
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (row?.kind === "part" && (row.hasChildren || row.node.count > 0)) toggle(row.node);
        break;
      default: break;
    }
  };

  // Click a tree row → make it the donut context, focus it, toggle its expansion.
  const activateRow = useCallback((node) => {
    setFocusedKey(node.id);
    setContextId(node.id);
    toggle(node);
  }, [toggle]);

  // Click a donut slice → open the path in the tree, set context, scroll to it.
  const drillTo = useCallback((id) => {
    const path = findPath(data?.tree || [], id);
    if (path.length) setExpandedIds((prev) => Array.from(new Set([...prev, ...path.map((n) => n.id)])));
    setContextId(id);
    setPendingScrollId(id);
  }, [data, setExpandedIds]);

  useEffect(() => {
    if (!pendingScrollId) return;
    const idx = flatRows.findIndex((r) => r.kind === "part" && r.node.id === pendingScrollId);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: "center" });
      setFocusedKey(flatRows[idx].key);
    }
    setPendingScrollId(null);
  }, [pendingScrollId, flatRows, virtualizer]);

  const activeFilterCount = priorities.length + accounts.length + subtypes.length + regions.length + (dateRange?.start ? 1 : 0);
  const clearFilters = () => setPFilters({ priorities: [], statuses: [], accounts: [], subtypes: [], regions: [], dateRange: { start: "", end: "" } });

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <TreePine className="w-4 h-4 text-indigo-500" /> Parts View
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {data ? `${(data.totalTickets || 0).toLocaleString()} solved tickets across the DevRev part hierarchy` : "Solved tickets by DevRev part hierarchy"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowTrend((s) => !s)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 ${showTrend ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"}`}>
            <LineChart className="w-3.5 h-3.5" /> Trend
          </button>
          <button onClick={() => setShowChart((s) => !s)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 ${showChart ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"}`}>
            <BarChart3 className="w-3.5 h-3.5" /> Breakdown
          </button>
          <button onClick={expandToCapability}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <ChevronsUpDown className="w-3.5 h-3.5" /> Expand
          </button>
          <button onClick={collapseAll}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <ChevronsDownUp className="w-3.5 h-3.5" /> Collapse
          </button>
          <button onClick={() => loadTree({ fresh: true })} title="Re-aggregate the latest synced data (bypasses the 10-min cache)"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Volume trendline — analytics-style area chart of ticket volume over time for the
          focused part (or all products), with its own daily/weekly/monthly toggle. */}
      {showTrend && data && !error && (
        <div className="shrink-0">
          <PartsTrendChart partId={contextId} contextName={trendName} filters={filters} />
        </div>
      )}

      {/* Composition donut — reflects the current context, drives the tree.
          Unpinned (default) it's a compact strip; pin to expand the donut. */}
      {showChart && data && !error && (
        <div className="shrink-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 pt-3 pb-3"
             style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex items-start justify-between gap-2 mb-2">
            {/* Breadcrumb — where the donut is focused; crumbs navigate up */}
            <div className="flex items-center gap-1 text-[11px] flex-wrap min-w-0">
              <span className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mr-1">Breakdown</span>
              <button
                onClick={() => setContextId(null)}
                className={`hover:underline ${contextId ? "text-indigo-500" : "text-slate-700 dark:text-slate-200 font-medium"}`}
              >
                All products
              </button>
              {context.path.map((n) => (
                <span key={n.id} className="flex items-center gap-1">
                  <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                  <button
                    onClick={() => setContextId(n.id)}
                    className={`hover:underline ${n.id === contextId ? "text-slate-700 dark:text-slate-200 font-medium" : "text-indigo-500"}`}
                  >
                    {n.name}
                  </button>
                </span>
              ))}
            </div>
            {/* Pin toggle — expand/collapse the donut to reclaim screen space */}
            <button
              onClick={() => setChartPinned((p) => !p)}
              title={chartPinned ? "Unpin — collapse the chart" : "Pin — expand the chart"}
              aria-pressed={chartPinned}
              className={`shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md ${chartPinned ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10" : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            >
              {chartPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              {chartPinned ? "Unpin" : "Pin"}
            </button>
          </div>
          {chartPinned ? (
            <CompositionChart slices={context.slices} contextName={context.name} total={context.total} onSlice={drillTo} />
          ) : (
            <button
              onClick={() => setChartPinned(true)}
              className="w-full flex items-center gap-2 text-left text-[12px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <BarChart3 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="truncate">
                <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{(context.total || 0).toLocaleString()}</span>
                {" "}tickets in <span className="font-medium">{context.name}</span> · pin to see the breakdown
              </span>
            </button>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="shrink-0 flex flex-wrap items-center gap-2">
        <div className="relative w-60">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parts or tickets…" aria-label="Search parts by name or id"
            className="w-full pl-8 pr-7 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-400 dark:text-slate-200"
          />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-2 top-2 text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {priorityOptions.length > 0 && (
          <MultiSelectFilter icon={FilterIcon} label="Priority" options={priorityOptions} selected={priorities} onChange={(v) => patch("priorities", v)} />
        )}
        <MultiSelectFilter icon={Tag} label="Classification" options={subtypeOptions} selected={subtypes} onChange={(v) => patch("subtypes", v)} />
        {regionOptions.length > 0 && (
          <MultiSelectFilter icon={Globe} label="Region" options={regionOptions} selected={regions} onChange={(v) => patch("regions", v)} />
        )}
        {accountOptions.length > 0 && (
          <MultiSelectFilter icon={FilterIcon} label="Account" options={accountOptions} selected={accounts} onChange={(v) => patch("accounts", v)} />
        )}
        <SmartDateRangePicker value={dateRange} onChange={(v) => patch("dateRange", v)} />
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="text-[11px] font-medium text-rose-500 hover:underline">
            Clear filters ({activeFilterCount})
          </button>
        )}
      </div>

      {/* Tree */}
      <div
        ref={scrollRef}
        onKeyDown={onKeyDown}
        role="tree"
        aria-label="DevRev part hierarchy"
        tabIndex={0}
        className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 custom-scrollbar outline-none"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        {loading && !data ? (
          <SkeletonRows />
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-72 gap-3 text-center px-6">
            <AlertCircle className="w-8 h-8 text-rose-500" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{error}</p>
            <button onClick={loadTree} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">Retry</button>
          </div>
        ) : flatRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-72 gap-2 text-center px-6">
            <TreePine className="w-8 h-8 text-slate-300 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{q || activeFilterCount ? "Nothing matches your filters." : "No parts to show yet."}</p>
            <p className="text-xs text-slate-400 max-w-sm">{q || activeFilterCount ? "Try clearing search or filters." : "Once the daily sync tags tickets with their DevRev part, the hierarchy appears here."}</p>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = flatRows[vi.index];
              return (
                <div
                  key={row.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}
                >
                  {row.kind === "tickets" ? (
                    <div style={{ paddingLeft: row.depth * INDENT + 22 }}>
                      <TicketDrilldown partId={row.node.id} filters={filters} />
                    </div>
                  ) : (
                    <div style={{ height: rowHeightFor(row) }}>
                      <PartRow
                        row={row}
                        isFocused={vi.index === focusedIndex}
                        isContext={row.node.id === contextId}
                        onActivate={activateRow}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default PartsView;

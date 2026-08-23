import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { fetchPartTickets } from "../../../api/partsApi";

// Alias so ESLint (no eslint-plugin-react here) sees `motion` used outside JSX.
const MotionDiv = motion.div;

/**
 * TicketDrilldown — the leaf's inline ticket sub-table, rendered on a distinctly
 * inset/elevated surface so it reads as a different layer than the tree. Whole row
 * is clickable (opens the ticket in DevRev). Paginated via "Load more".
 *
 * Animated with a single restrained Framer Motion transition (~180ms fade + lift);
 * the virtualizer measures the resulting height so the tree reflows around it.
 */
const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
};

const HEAD = ["ID", "Title", "Account", "Priority", "Status", "Created"];

const TicketDrilldown = ({ partId, filters }) => {
  const [tickets, setTickets] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(
    async (p) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchPartTickets(partId, filters, { page: p, pageSize: 25 });
        setTickets((prev) => (p === 1 ? res.tickets || [] : [...prev, ...(res.tickets || [])]));
        setTotal(res.total || 0);
        setHasMore(!!res.hasMore);
        setPage(p);
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

  const open = (url) => url && window.open(url, "_blank", "noopener,noreferrer");

  return (
    <MotionDiv
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="my-1.5 ml-1 mr-2 rounded-lg border border-slate-200/80 dark:border-slate-700/60 bg-slate-50 dark:bg-[#0b1322] shadow-inner overflow-hidden"
    >
      {loading && tickets.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-4 text-xs text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading tickets…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 px-4 py-4 text-xs text-rose-500">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      ) : tickets.length === 0 ? (
        <div className="px-4 py-4 text-xs italic text-slate-400">No tickets match the current filters.</div>
      ) : (
        <div className="max-h-[340px] overflow-y-auto custom-scrollbar">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 bg-slate-100/90 dark:bg-[#0b1322]/95 backdrop-blur">
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                {HEAD.map((h) => (
                  <th key={h} className="font-semibold px-4 py-2 border-b border-slate-200 dark:border-slate-700/60">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr
                  key={t.ticket_id || t.display_id}
                  onClick={() => open(t.devrevUrl)}
                  className="cursor-pointer group hover:bg-white dark:hover:bg-slate-800/50 transition-colors"
                >
                  <td className="px-4 py-2 whitespace-nowrap border-b border-slate-100 dark:border-slate-800/60">
                    <span className="inline-flex items-center gap-1 font-mono text-indigo-600 dark:text-indigo-400 group-hover:underline">
                      {t.display_id}
                      <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                    </span>
                  </td>
                  <td className="px-4 py-2 max-w-[360px] truncate text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800/60" title={t.title}>
                    {t.is_active && <span className="mr-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 align-middle" title="Active" />}
                    {t.title}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800/60">{t.account_name || "—"}</td>
                  <td className="px-4 py-2 whitespace-nowrap border-b border-slate-100 dark:border-slate-800/60">
                    {t.priority ? (
                      <span className="uppercase text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{t.priority}</span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800/60">{t.status || "—"}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800/60">{fmtDate(t.created_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-2 bg-slate-100/50 dark:bg-transparent">
            <span className="text-[11px] text-slate-400 tabular-nums">Showing {tickets.length} of {total}</span>
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
      )}
    </MotionDiv>
  );
};

export default TicketDrilldown;

/**
 * AttentionBell — header bell + centered "Attention Queue" modal.
 *
 * Visibility: GST members only (email resolves via EMAIL_TO_NAME_MAP), and
 * strictly per-user — the backend derives the member from the JWT, so this
 * component can only ever see the logged-in user's own queue.
 *
 * Rendered through a portal to document.body: the header container is a
 * flex item with z-20, which creates a stacking context that would trap a
 * "fixed" overlay underneath the tab headers — the original far-right
 * slide-over bug.
 *
 * The refresh action IS verification: it re-checks every ticket against
 * live DevRev and drops the ones whose stage changed / that were actioned.
 * Remarks + @tagging reuse the existing RemarkPopover as-is.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  X,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Star,
  RefreshCw,
  AlertTriangle,
  MessageSquare,
  Clock,
  ChevronDown,
} from "lucide-react";
import { useTicketStore } from "../../../store";
import { EMAIL_TO_NAME_MAP } from "../../../utils";
import { fetchMyAttentionQueue, verifyClearAttentionQueue } from "../../../api/attentionApi";
import RemarkPopover from "../../remarks/components/RemarkPopover";

const DEVREV_URL = (id) => `https://app.devrev.ai/clevertapsupport/works/${id}`;

const BUCKET_META = {
  open: {
    label: "Open",
    dot: "bg-orange-400",
    activeTab: "bg-orange-500/15 text-orange-600 dark:text-orange-300 border-orange-500/40",
    bar: "from-orange-400 to-amber-500",
    hint: "Waiting on you — reply to the customer today",
  },
  pending: {
    label: "Pending",
    dot: "bg-amber-400",
    activeTab: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/40",
    bar: "from-amber-400 to-yellow-500",
    hint: "Customer went quiet — nudge or close",
  },
  onHold: {
    label: "On Hold",
    dot: "bg-sky-400",
    activeTab: "bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/40",
    bar: "from-sky-400 to-blue-500",
    hint: "Keep the customer updated every 2 days",
  },
};
const BUCKET_ORDER = ["open", "pending", "onHold"];

const daysSince = (d) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000)) : null);

const AgeChip = ({ label, days }) => {
  if (days === null) return null;
  const tone =
    days >= 10
      ? "bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/20"
      : days >= 5
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
        : "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium ${tone}`}>
      <Clock className="w-2.5 h-2.5" />
      {label} {days === 0 ? "today" : `${days}d`}
    </span>
  );
};

const AttentionBell = () => {
  const currentUser = useTicketStore((s) => s.currentUser);
  const socket = useTicketStore((s) => s.socket);

  const gstName = EMAIL_TO_NAME_MAP[currentUser?.email?.toLowerCase()];

  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [justCleared, setJustCleared] = useState(false);
  const [activeBucket, setActiveBucket] = useState("all");
  const [showClearedList, setShowClearedList] = useState(false);
  const [remarkData, setRemarkData] = useState(null); // { ticket, rect }

  const refresh = useCallback(async () => {
    if (!gstName) return;
    setLoading(true);
    try {
      const data = await fetchMyAttentionQueue();
      setQueue(data?.queue || null);
    } catch {
      /* keep whatever we had */
    } finally {
      setLoading(false);
    }
  }, [gstName]);

  // "Refresh" inside the modal = live verification: stage changed / actioned
  // tickets disappear from the pending list.
  const verify = useCallback(async () => {
    setVerifying(true);
    try {
      const data = await verifyClearAttentionQueue();
      if (data?.queue) {
        setQueue(data.queue);
        if (data.queue.status === "cleared") setJustCleared(true);
      } else {
        await refresh();
      }
    } catch {
      /* cards keep their previous state */
    } finally {
      setVerifying(false);
    }
  }, [refresh]);

  useEffect(() => {
    if (!gstName) return;
    refresh();
    const t = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [gstName, refresh]);

  useEffect(() => {
    if (!socket || !gstName) return;
    const email = currentUser?.email?.toLowerCase();
    const onEvent = (payload) => {
      if ((payload?.email || "").toLowerCase() !== email) return;
      refresh();
    };
    socket.on("ATTENTION_QUEUE", onEvent);
    socket.on("ATTENTION_QUEUE_UPDATED", onEvent);
    return () => {
      socket.off("ATTENTION_QUEUE", onEvent);
      socket.off("ATTENTION_QUEUE_UPDATED", onEvent);
    };
  }, [socket, gstName, currentUser?.email, refresh]);

  const items = queue?.items || [];
  const pendingItems = useMemo(
    () => (queue?.status === "pending" ? items.filter((i) => i.status !== "cleared") : []),
    [queue, items],
  );
  const clearedItems = useMemo(() => items.filter((i) => i.status === "cleared"), [items]);
  const bucketCounts = useMemo(() => {
    const c = { open: 0, pending: 0, onHold: 0 };
    for (const i of pendingItems) c[i.bucket] = (c[i.bucket] || 0) + 1;
    return c;
  }, [pendingItems]);

  const visibleItems = activeBucket === "all" ? pendingItems : pendingItems.filter((i) => i.bucket === activeBucket);
  const progress = items.length ? Math.round((clearedItems.length / items.length) * 100) : 0;

  if (!gstName) return null;

  const badge = pendingItems.length;

  const modal = open
    ? createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />

          <div className="relative w-full max-w-4xl h-[88vh] flex flex-col rounded-2xl overflow-hidden bg-white dark:bg-[#0B1322] border border-slate-200 dark:border-slate-700/60 shadow-2xl shadow-black/40 animate-[attnPop_.22s_ease-out]">
            <style>{`@keyframes attnPop { from { transform: scale(.97) translateY(8px); opacity: 0 } to { transform: scale(1) translateY(0); opacity: 1 } }`}</style>

            {/* ── Header ─────────────────────────────────────────── */}
            <div className="shrink-0 px-6 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-b from-slate-50/80 to-transparent dark:from-slate-900/60">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-md shadow-amber-500/30">
                  <Bell className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-[16px] font-semibold text-slate-900 dark:text-white leading-tight">
                    Attention Queue
                  </h2>
                  <p className="text-[11.5px] text-slate-400 dark:text-slate-500 mt-0.5">
                    {queue
                      ? `${queue.shift || ""}${queue.shift ? " · " : ""}${queue.shift_date || ""} — clear it before your shift ends`
                      : "Aging tickets that need action before shift end"}
                  </p>
                </div>
                <button
                  onClick={verify}
                  disabled={verifying || !queue || queue.status !== "pending"}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-500 transition-colors disabled:opacity-40"
                  title="Re-check every ticket against live DevRev — actioned / stage-changed tickets disappear"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${verifying ? "animate-spin" : ""}`} />
                  Refresh
                </button>
                <button onClick={() => setOpen(false)} className="btn-icon" title="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Progress */}
              {queue && queue.status !== "empty" && items.length > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="text-[10.5px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      Progress
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-300 tabular-nums">
                      {clearedItems.length}/{items.length} cleared
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${progress === 100 ? "bg-gradient-to-r from-emerald-400 to-teal-500" : "bg-gradient-to-r from-indigo-400 to-purple-500"}`}
                      style={{ width: `${Math.max(progress, 2)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Bucket tabs */}
              {pendingItems.length > 0 && (
                <div className="mt-4 flex items-center gap-1.5">
                  <button
                    onClick={() => setActiveBucket("all")}
                    className={`px-3 py-1.5 rounded-lg text-[11.5px] font-semibold border transition-all ${
                      activeBucket === "all"
                        ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/40"
                        : "border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                    }`}
                  >
                    All <span className="ml-1 tabular-nums opacity-70">{pendingItems.length}</span>
                  </button>
                  {BUCKET_ORDER.map((b) => (
                    <button
                      key={b}
                      onClick={() => setActiveBucket(b)}
                      disabled={!bucketCounts[b]}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold border transition-all disabled:opacity-30 ${
                        activeBucket === b
                          ? BUCKET_META[b].activeTab
                          : "border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${BUCKET_META[b].dot}`} />
                      {BUCKET_META[b].label}
                      <span className="tabular-nums opacity-70">{bucketCounts[b]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Body ───────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* No queue yet */}
              {!queue && (
                <div className="h-full flex flex-col items-center justify-center text-center px-8">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center mb-4">
                    <Bell className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No queue yet</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed max-w-xs">
                    Your attention queue appears here ~30 minutes before your shift ends, with any tickets that need action.
                  </p>
                </div>
              )}

              {/* Superstar */}
              {queue?.status === "empty" && (
                <div className="h-full flex flex-col items-center justify-center text-center px-8">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-yellow-300 to-amber-500 flex items-center justify-center mb-4 shadow-lg shadow-amber-500/25">
                    <Star className="w-7 h-7 text-white fill-white" />
                  </div>
                  <p className="text-[15px] font-semibold text-slate-900 dark:text-white">Superstar! 🌟</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed max-w-xs">
                    No tickets in your attention queue today. Enjoy the end of your shift.
                  </p>
                </div>
              )}

              {/* Cleared celebration */}
              {(queue?.status === "cleared" || justCleared) && queue?.status !== "empty" && queue && (
                <div className="mb-5 rounded-xl border border-emerald-500/25 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 px-5 py-4 flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/25">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-[13.5px] font-semibold text-emerald-600 dark:text-emerald-300">
                      Queue cleared — nice work! 🎉
                    </p>
                    <p className="text-[11px] text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">
                      {items.length} ticket{items.length === 1 ? "" : "s"} actioned · the team has been told on Slack
                    </p>
                  </div>
                </div>
              )}

              {/* Pending cards */}
              {visibleItems.length > 0 && (
                <div className="space-y-2.5">
                  {visibleItems.map((item) => {
                    const meta = BUCKET_META[item.bucket] || BUCKET_META.open;
                    return (
                      <div
                        key={item.display_id}
                        className="group relative rounded-xl border border-slate-200 dark:border-slate-700/70 bg-slate-50/70 dark:bg-slate-800/40 hover:bg-white dark:hover:bg-slate-800/70 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md hover:shadow-black/5 transition-all overflow-hidden"
                      >
                        {/* bucket accent bar */}
                        <div className={`absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b ${meta.bar}`} />

                        <div className="pl-5 pr-4 py-3.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <a
                              href={DEVREV_URL(item.display_id)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[13px] font-bold text-indigo-500 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                            >
                              {item.display_id}
                              <ExternalLink className="w-3 h-3 opacity-50" />
                            </a>
                            {item.severity && (
                              <span className="text-[9.5px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-700/70 text-slate-500 dark:text-slate-300">
                                {item.severity}
                              </span>
                            )}
                            {item.account && (
                              <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-[180px]">
                                {item.account}
                              </span>
                            )}
                            <div className="ml-auto flex items-center gap-1.5">
                              <AgeChip label="opened" days={daysSince(item.created_date)} />
                            </div>
                          </div>

                          {item.title && (
                            <p className="text-[12.5px] text-slate-600 dark:text-slate-300 mt-1.5 truncate">
                              {item.title}
                            </p>
                          )}

                          <p className="text-[11.5px] text-slate-400 dark:text-slate-500 mt-1">{item.reason}</p>

                          {item.block_reason && (
                            <p className="text-[11px] text-rose-500 dark:text-rose-400 mt-1.5 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              {item.block_reason}
                            </p>
                          )}

                          {/* Card actions */}
                          <div className="flex items-center gap-2 mt-2.5">
                            <button
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setRemarkData({
                                  ticket: { id: item.ticket_id, display_id: item.display_id },
                                  rect,
                                });
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10.5px] font-semibold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
                            >
                              <MessageSquare className="w-3 h-3" />
                              Remark
                            </button>
                            <a
                              href={DEVREV_URL(item.display_id)}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10.5px] font-semibold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Open in DevRev
                            </a>
                            <span className="ml-auto text-[10px] text-slate-300 dark:text-slate-600 italic hidden group-hover:inline">
                              {meta.hint}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Cleared (collapsed) */}
              {clearedItems.length > 0 && queue?.status === "pending" && (
                <div className="mt-5">
                  <button
                    onClick={() => setShowClearedList((v) => !v)}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-500 dark:text-emerald-400 hover:opacity-80 transition-opacity"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Cleared ({clearedItems.length})
                    <ChevronDown className={`w-3 h-3 transition-transform ${showClearedList ? "rotate-180" : ""}`} />
                  </button>
                  {showClearedList && (
                    <div className="mt-2 space-y-1.5">
                      {clearedItems.map((item) => (
                        <div
                          key={item.display_id}
                          className="flex items-center gap-2.5 rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-3.5 py-2 opacity-70"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          <span className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">
                            {item.display_id}
                          </span>
                          <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate line-through decoration-slate-300 dark:decoration-slate-600">
                            {item.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Footer ─────────────────────────────────────────── */}
            {queue?.status === "pending" && (
              <div className="shrink-0 px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/50">
                <button
                  onClick={verify}
                  disabled={verifying}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white text-[13px] font-semibold py-2.5 shadow-lg shadow-indigo-500/25 transition-all disabled:opacity-60 active:scale-[.99]"
                >
                  {verifying ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Verifying against DevRev…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" /> Verify &amp; Clear ({pendingItems.length} left)
                    </>
                  )}
                </button>
                <p className="text-[10.5px] text-center text-slate-400 dark:text-slate-500 mt-2">
                  Re-checks live DevRev — tickets clear only once they're genuinely actioned.
                </p>
              </div>
            )}
          </div>

          {/* Remarks + @tagging — the existing popover, reused as-is */}
          {remarkData && (
            <RemarkPopover
              ticket={remarkData.ticket}
              anchorRect={remarkData.rect}
              onClose={() => setRemarkData(null)}
            />
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        onClick={() => { setOpen(true); setJustCleared(false); setActiveBucket("all"); refresh(); }}
        className="btn-icon relative"
        title="Attention Queue"
      >
        <Bell className={`w-4 h-4 ${badge ? "text-amber-500 dark:text-amber-400" : ""} ${loading ? "opacity-60" : ""}`} />
        {badge > 0 && (
          <>
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-0.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white shadow-sm">
              {badge}
            </span>
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-amber-500 animate-ping opacity-30" />
          </>
        )}
      </button>
      {modal}
    </>
  );
};

export default AttentionBell;

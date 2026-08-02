/**
 * AttentionBell — header bell + "Attention Queue" slide-over panel.
 *
 * Visibility: GST members only (email resolves via EMAIL_TO_NAME_MAP), and
 * strictly per-user — the backend derives the member from the JWT, so this
 * component can only ever see the logged-in user's own queue.
 *
 * Real-time: listens for ATTENTION_QUEUE / ATTENTION_QUEUE_UPDATED socket
 * events addressed to this user's email (events carry counts only — queue
 * content always comes from the authenticated endpoint), plus a 5-min poll
 * as a fallback.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Bell,
  X,
  CheckCircle2,
  Circle,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  Star,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { useTicketStore } from "../../../store";
import { EMAIL_TO_NAME_MAP } from "../../../utils";
import { fetchMyAttentionQueue, verifyClearAttentionQueue } from "../../../api/attentionApi";

const DEVREV_URL = (id) => `https://app.devrev.ai/clevertapsupport/works/${id}`;

const BUCKETS = [
  { key: "open", label: "Open", dot: "bg-orange-400", chip: "bg-orange-500/10 text-orange-500 dark:text-orange-300 border-orange-500/20" },
  { key: "pending", label: "Pending", dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-500 dark:text-amber-300 border-amber-500/20" },
  { key: "onHold", label: "On Hold", dot: "bg-sky-400", chip: "bg-sky-500/10 text-sky-500 dark:text-sky-300 border-sky-500/20" },
];

const timeAgo = (d) => {
  if (!d) return null;
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days <= 0) return "today";
  return `${days}d ago`;
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

  // Initial load + 5-min poll fallback
  useEffect(() => {
    if (!gstName) return;
    refresh();
    const t = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [gstName, refresh]);

  // Live push — refetch only when the event is addressed to this user
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

  const pendingItems = useMemo(
    () => (queue?.status === "pending" ? (queue.items || []).filter((i) => i.status !== "cleared") : []),
    [queue],
  );

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const data = await verifyClearAttentionQueue();
      if (data?.queue) {
        setQueue(data.queue);
        if (data.queue.status === "cleared") setJustCleared(true);
      }
    } catch {
      /* surface nothing — cards keep their previous state */
    } finally {
      setVerifying(false);
    }
  };

  if (!gstName) return null;

  const badge = pendingItems.length;

  return (
    <>
      {/* Bell */}
      <button
        onClick={() => { setOpen(true); setJustCleared(false); refresh(); }}
        className="btn-icon relative"
        title="Attention Queue"
      >
        <Bell className={`w-4 h-4 ${badge ? "text-amber-500 dark:text-amber-400" : ""}`} />
        {badge > 0 && (
          <>
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-0.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white shadow-sm">
              {badge}
            </span>
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-amber-500 animate-ping opacity-30" />
          </>
        )}
        {queue?.status === "empty" && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-gradient-to-br from-yellow-300 to-amber-500" />
        )}
      </button>

      {/* Slide-over */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative h-full w-full max-w-[440px] flex flex-col bg-white dark:bg-[#0A1220] border-l border-slate-200 dark:border-slate-800 shadow-2xl animate-[slideIn_.25s_ease-out]">
            <style>{`@keyframes slideIn { from { transform: translateX(24px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>

            {/* Header */}
            <div className="shrink-0 px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm shadow-amber-500/30">
                <Bell className="w-4.5 h-4.5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white leading-tight">
                  Attention Queue
                </h2>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  {queue
                    ? `${queue.shift || ""} · ${queue.shift_date || ""}`.replace(/^ · /, "")
                    : "Aging tickets that need action before shift end"}
                </p>
              </div>
              <button onClick={refresh} className="btn-icon" title="Refresh">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button onClick={() => setOpen(false)} className="btn-icon" title="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {!queue && (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center mb-4">
                    <Bell className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No queue yet</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed">
                    Your attention queue appears here ~30 minutes before your shift ends, with any tickets that need action.
                  </p>
                </div>
              )}

              {queue?.status === "empty" && (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-yellow-300 to-amber-500 flex items-center justify-center mb-4 shadow-lg shadow-amber-500/25">
                    <Star className="w-7 h-7 text-white fill-white" />
                  </div>
                  <p className="text-[15px] font-semibold text-slate-900 dark:text-white">Superstar! 🌟</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed">
                    No tickets in your attention queue today. Enjoy the end of your shift.
                  </p>
                </div>
              )}

              {(queue?.status === "cleared" || justCleared) && queue?.status !== "empty" && queue && (
                <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3.5 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-300">Queue cleared — nice work! 🎉</p>
                    <p className="text-[11px] text-emerald-600/70 dark:text-emerald-400/70">
                      {(queue.items || []).length} ticket{(queue.items || []).length === 1 ? "" : "s"} actioned · the team has been told on Slack
                    </p>
                  </div>
                </div>
              )}

              {queue && queue.status !== "empty" && (queue.items || []).length > 0 && (
                <div className="space-y-5">
                  {BUCKETS.map(({ key, label, dot, chip }) => {
                    const rows = (queue.items || []).filter((i) => i.bucket === key);
                    if (!rows.length) return null;
                    return (
                      <div key={key}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {label}
                          </h3>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${chip}`}>
                            {rows.filter((r) => r.status !== "cleared").length}/{rows.length}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {rows.map((item) => {
                            const cleared = item.status === "cleared";
                            return (
                              <div
                                key={item.display_id}
                                className={`rounded-xl border px-3.5 py-3 transition-all ${
                                  cleared
                                    ? "border-emerald-500/20 bg-emerald-500/5 opacity-70"
                                    : "border-slate-200 dark:border-slate-700/70 bg-slate-50 dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-600"
                                }`}
                              >
                                <div className="flex items-start gap-2.5">
                                  {cleared ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                  ) : (
                                    <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <a
                                        href={DEVREV_URL(item.display_id)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[12.5px] font-semibold text-indigo-500 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                                      >
                                        {item.display_id}
                                        <ExternalLink className="w-3 h-3 opacity-60" />
                                      </a>
                                      {item.account && (
                                        <span className="text-[10.5px] text-slate-400 dark:text-slate-500 truncate">
                                          {item.account}
                                        </span>
                                      )}
                                    </div>
                                    {item.title && (
                                      <p className={`text-[12px] mt-0.5 truncate ${cleared ? "text-slate-400 line-through decoration-slate-300" : "text-slate-600 dark:text-slate-300"}`}>
                                        {item.title}
                                      </p>
                                    )}
                                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                                      {item.reason}
                                      {item.created_date && ` · opened ${timeAgo(item.created_date)}`}
                                    </p>
                                    {!cleared && item.block_reason && (
                                      <p className="text-[11px] text-rose-500 dark:text-rose-400 mt-1.5 flex items-center gap-1">
                                        <AlertTriangle className="w-3 h-3 shrink-0" />
                                        {item.block_reason}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer — Verify & Clear */}
            {queue?.status === "pending" && (
              <div className="shrink-0 px-5 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/40">
                <button
                  onClick={handleVerify}
                  disabled={verifying}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white text-[13px] font-semibold py-2.5 shadow-md shadow-indigo-500/25 transition-all disabled:opacity-60"
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
        </div>
      )}
    </>
  );
};

export default AttentionBell;

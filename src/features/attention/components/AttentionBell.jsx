/**
 * AttentionBell — header bell + centered "Attention Queue" modal.
 *
 * Visibility (2026-08-03): server-driven via /api/attention/team-queues —
 * a GST member sees their own queue plus their teammates' (same TEAMS
 * block), supervisors (Anmol / Mashnu) see all of GST, everyone else gets
 * { visible: false } and no bell.
 *
 * Layout: main queue panel + right-side member rail. Profiles stack by
 * workload (most pending first); clicking one opens that member's queue in
 * place. Verify is allowed on any visible queue — it's evidence-based
 * (backend re-checks live DevRev), so it can never wrongly clear.
 *
 * Rendered through a portal to document.body: the header container is a
 * flex item with z-20, which creates a stacking context that would trap a
 * "fixed" overlay underneath the tab headers — the original far-right
 * slide-over bug.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  Users,
  Moon,
} from "lucide-react";
import { useTicketStore } from "../../../store";
import { fetchTeamAttentionQueues, verifyClearAttentionQueue } from "../../../api/attentionApi";
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
    hint: "Follow-up automation is off track — nudge or close",
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

/** Deterministic avatar gradient per member name. */
const AVATAR_GRADIENTS = [
  "from-indigo-400 to-violet-500",
  "from-sky-400 to-blue-500",
  "from-emerald-400 to-teal-500",
  "from-amber-400 to-orange-500",
  "from-rose-400 to-pink-500",
  "from-fuchsia-400 to-purple-500",
  "from-cyan-400 to-sky-500",
  "from-lime-400 to-green-500",
];
const avatarGradient = (name = "") => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
};
const initials = (name = "?") => {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
};

// Actionable = still alerting. "partial" (remark-tracked) items are open but
// deliberately excluded from every alert count — managers see them, nobody
// gets paged over them.
const pendingCountOf = (queue) =>
  queue?.status === "pending" ? (queue.items || []).filter((i) => i.status === "pending").length : 0;
const trackedCountOf = (queue) =>
  queue && queue.status !== "empty" ? (queue.items || []).filter((i) => i.status === "partial").length : 0;

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

const Avatar = ({ name, size = "w-9 h-9", ring = false }) => (
  <div
    className={`${size} shrink-0 rounded-full bg-gradient-to-br ${avatarGradient(name)} flex items-center justify-center text-white font-bold shadow-sm ${
      ring ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-[#0B1322]" : ""
    }`}
    style={{ fontSize: "0.68rem", letterSpacing: "0.02em" }}
  >
    {initials(name)}
  </div>
);

/** One row in the member rail. */
const MemberRow = ({ entry, selected, onSelect, showTeam }) => {
  const { member, isSelf, team, queue } = entry;
  const count = pendingCountOf(queue);
  const tracked = trackedCountOf(queue);
  const status = !queue
    ? { text: "No queue yet", tone: "text-slate-400 dark:text-slate-600" }
    : queue.status === "empty"
      ? { text: "All clear", tone: "text-emerald-500 dark:text-emerald-400" }
      : queue.status === "cleared"
        ? { text: `Cleared${tracked ? ` · ${tracked} tracked` : ""}`, tone: "text-emerald-500 dark:text-emerald-400" }
        : count > 0
          ? { text: `${count} to clear${tracked ? ` · ${tracked} tracked` : ""}`, tone: "text-amber-600 dark:text-amber-400" }
          : { text: `${tracked} tracked`, tone: "text-violet-500 dark:text-violet-400" };

  return (
    <button
      onClick={() => onSelect(member)}
      className={`w-full flex items-center gap-2.5 rounded-xl px-2 md:px-2.5 py-2 text-left transition-all ${
        selected
          ? "bg-indigo-500/10 dark:bg-indigo-500/15 shadow-sm"
          : "hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
      }`}
      title={`${member} — ${status.text}`}
    >
      <div className="relative">
        <Avatar name={member} ring={selected} />
        {/* count badge doubles as the only signal when the rail is collapsed on small screens */}
        {count > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-0.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white shadow md:hidden">
            {count}
          </span>
        )}
        {queue && count === 0 && queue.status !== "pending" && (
          <span className="absolute -bottom-0.5 -right-0.5 md:hidden">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 bg-white dark:bg-[#0B1322] rounded-full" />
          </span>
        )}
      </div>

      <div className="hidden md:block flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[12.5px] font-semibold truncate ${
              selected ? "text-indigo-600 dark:text-indigo-300" : "text-slate-700 dark:text-slate-200"
            }`}
          >
            {member}
          </span>
          {isSelf && (
            <span className="shrink-0 text-[8.5px] uppercase tracking-wider font-bold px-1 py-px rounded bg-indigo-500/15 text-indigo-500 dark:text-indigo-300">
              You
            </span>
          )}
        </div>
        <p className={`text-[10.5px] mt-px truncate ${status.tone}`}>
          {status.text}
          {showTeam && team ? <span className="text-slate-400 dark:text-slate-600"> · {team}'s team</span> : null}
        </p>
      </div>

      <div className="hidden md:flex items-center shrink-0">
        {count > 0 ? (
          <span className="flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10.5px] font-bold tabular-nums">
            {count}
          </span>
        ) : tracked > 0 ? (
          <span className="flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-violet-500/15 text-violet-500 dark:text-violet-400 text-[10.5px] font-bold tabular-nums">
            {tracked}
          </span>
        ) : queue ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-500/80" />
        ) : (
          <Moon className="w-3.5 h-3.5 text-slate-300 dark:text-slate-700" />
        )}
      </div>
    </button>
  );
};

const AttentionBell = () => {
  const currentUser = useTicketStore((s) => s.currentUser);
  const socket = useTicketStore((s) => s.socket);

  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null); // { visible, viewer, members }
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [selected, setSelected] = useState(null);
  const [justClearedFor, setJustClearedFor] = useState(null);
  const [activeBucket, setActiveBucket] = useState("all");
  const [showClearedList, setShowClearedList] = useState(false);
  const [remarkData, setRemarkData] = useState(null); // { ticket, rect }
  const emailsRef = useRef(new Set());

  const refresh = useCallback(async () => {
    try {
      const d = await fetchTeamAttentionQueues();
      if (!d?.visible) {
        setData({ visible: false, viewer: null, members: [] });
        return;
      }
      emailsRef.current = new Set(d.members.map((m) => (m.email || "").toLowerCase()).filter(Boolean));
      setData(d);
      setSelected((prev) => {
        if (prev && d.members.some((m) => m.member === prev)) return prev;
        // default: own queue, else the heaviest one
        const self = d.members.find((m) => m.isSelf);
        if (self) return self.member;
        const heaviest = [...d.members].sort((a, b) => pendingCountOf(b.queue) - pendingCountOf(a.queue))[0];
        return heaviest?.member || null;
      });
    } catch {
      /* keep whatever we had */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentUser?.email) return;
    refresh();
    // 15 min is only the fallback — the ATTENTION_QUEUE(_UPDATED) socket
    // events below push real-time refreshes, so a tight poll adds nothing.
    const t = setInterval(refresh, 15 * 60 * 1000);
    return () => clearInterval(t);
  }, [currentUser?.email, refresh]);

  useEffect(() => {
    if (!socket) return;
    const onEvent = (payload) => {
      const email = (payload?.email || "").toLowerCase();
      if (email && !emailsRef.current.has(email)) return;
      refresh();
    };
    socket.on("ATTENTION_QUEUE", onEvent);
    socket.on("ATTENTION_QUEUE_UPDATED", onEvent);
    return () => {
      socket.off("ATTENTION_QUEUE", onEvent);
      socket.off("ATTENTION_QUEUE_UPDATED", onEvent);
    };
  }, [socket, refresh]);

  const members = data?.members || [];
  const viewer = data?.viewer || null;

  // Rail order: heaviest queue first (the ask: "profiles stack according to
  // the queue"), self wins ties, then alphabetical.
  const sortedMembers = useMemo(
    () =>
      [...members].sort((a, b) => {
        const diff = pendingCountOf(b.queue) - pendingCountOf(a.queue);
        if (diff) return diff;
        if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
        return a.member.localeCompare(b.member);
      }),
    [members],
  );

  // Supervisor view: rail grouped team-wise (per Rohan 2026-08-03), heaviest
  // team first, members load-sorted within their team. Teamless → "Others".
  const teamGroups = useMemo(() => {
    if (viewer?.scope !== "all") return [];
    const groups = new Map();
    for (const m of sortedMembers) {
      const key = m.team ? `${m.team}'s team` : "Others";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    const load = (arr) => arr.reduce((s, m) => s + pendingCountOf(m.queue), 0);
    return [...groups.entries()].sort((a, b) => load(b[1]) - load(a[1]));
  }, [sortedMembers, viewer?.scope]);

  const selectedEntry = members.find((m) => m.member === selected) || null;
  const queue = selectedEntry?.queue || null;
  const isSelf = !!selectedEntry?.isSelf;

  const items = queue?.items || [];
  // Actionable = open/pending/onHold tickets still alerting. Tracked =
  // remark-tracked ("partial") — own tab, visible even after the queue
  // clears. Server order (longest silence first) is preserved in both.
  const pendingItems = useMemo(
    () => (queue?.status === "pending" ? items.filter((i) => i.status === "pending") : []),
    [queue, items],
  );
  const trackedItems = useMemo(
    () => (queue && queue.status !== "empty" ? items.filter((i) => i.status === "partial") : []),
    [queue, items],
  );
  const actionableCount = pendingItems.length;
  const clearedItems = useMemo(() => items.filter((i) => i.status === "cleared"), [items]);
  const bucketCounts = useMemo(() => {
    const c = { open: 0, pending: 0, onHold: 0 };
    for (const i of pendingItems) c[i.bucket] = (c[i.bucket] || 0) + 1;
    return c;
  }, [pendingItems]);

  const visibleItems =
    activeBucket === "tracked"
      ? trackedItems
      : activeBucket === "all"
        ? pendingItems
        : pendingItems.filter((i) => i.bucket === activeBucket);
  // Progress over the actionable universe only — tracked items don't block
  // a 100% clear (they don't block the queue clearing either).
  const actionableTotal = items.length - trackedItems.length;
  const progress = actionableTotal ? Math.round((clearedItems.length / actionableTotal) * 100) : 0;

  const verify = useCallback(async () => {
    if (!selected) return;
    setVerifying(true);
    try {
      const d = await verifyClearAttentionQueue(isSelf ? undefined : selected);
      if (d?.queue) {
        setData((prev) =>
          prev
            ? { ...prev, members: prev.members.map((m) => (m.member === selected ? { ...m, queue: d.queue } : m)) }
            : prev,
        );
        if (d.queue.status === "cleared") setJustClearedFor(selected);
      } else {
        await refresh();
      }
    } catch {
      /* cards keep their previous state */
    } finally {
      setVerifying(false);
    }
  }, [selected, isSelf, refresh]);

  const selectMember = useCallback((name) => {
    setSelected(name);
    setActiveBucket("all");
    setShowClearedList(false);
  }, []);

  if (!data || !data.visible) return null;

  const selfEntry = members.find((m) => m.isSelf);
  const badge = selfEntry
    ? pendingCountOf(selfEntry.queue)
    : members.filter((m) => pendingCountOf(m.queue) > 0).length;

  const scopeLabel =
    viewer?.scope === "all" ? "All of GST" : viewer?.scope === "team" ? "Your team" : "Your queue";
  const whoseQueue = !selectedEntry ? "" : isSelf ? "Your queue" : `${selectedEntry.member}'s queue`;

  const modal = open
    ? createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />

          <div className="relative w-full max-w-5xl h-[88vh] flex rounded-2xl overflow-hidden bg-white dark:bg-[#0B1322] border border-slate-200 dark:border-slate-700/60 shadow-2xl shadow-black/40 animate-[attnPop_.22s_ease-out]">
            <style>{`@keyframes attnPop { from { transform: scale(.97) translateY(8px); opacity: 0 } to { transform: scale(1) translateY(0); opacity: 1 } }`}</style>

            {/* ══ Main panel ══════════════════════════════════════ */}
            <div className="flex-1 min-w-0 flex flex-col">
              {/* ── Header ─────────────────────────────────────── */}
              <div className="shrink-0 px-6 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-b from-slate-50/80 to-transparent dark:from-slate-900/60">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-md shadow-amber-500/30">
                    <Bell className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-[16px] font-semibold text-slate-900 dark:text-white leading-tight flex items-center gap-2">
                      Attention Queue
                      {whoseQueue && (
                        <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                          · {whoseQueue}
                        </span>
                      )}
                    </h2>
                    <p className="text-[11.5px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                      {queue
                        ? `${queue.shift || ""}${queue.shift ? " · " : ""}${queue.shift_date || ""}${isSelf ? " — clear it before your shift ends" : ""}`
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

                {/* Bucket tabs — Open / Pending / On Hold / Tracked */}
                {(pendingItems.length > 0 || trackedItems.length > 0) && (
                  <div className="mt-4 flex items-center gap-1.5 flex-wrap">
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
                    <button
                      onClick={() => setActiveBucket("tracked")}
                      disabled={!trackedItems.length}
                      title="Internal remark added today — being tracked, no alerts. Still-blocked tickets return to their bucket in tomorrow's queue."
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold border transition-all disabled:opacity-30 ${
                        activeBucket === "tracked"
                          ? "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/40"
                          : "border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                      Tracked
                      <span className="tabular-nums opacity-70">{trackedItems.length}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* ── Body ───────────────────────────────────────── */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {/* No queue yet */}
                {!queue && (
                  <div className="h-full flex flex-col items-center justify-center text-center px-8">
                    {selectedEntry && <Avatar name={selectedEntry.member} size="w-14 h-14" />}
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mt-4">No queue yet</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5 leading-relaxed max-w-xs">
                      {isSelf
                        ? "Your attention queue appears here after its first build (~45 min before shift end) and then stays visible all day, refreshing each shift."
                        : `${selectedEntry?.member || "This member"}'s queue appears here after their first build and then stays visible day-to-day.`}
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
                      {isSelf
                        ? "No tickets in your attention queue today. Enjoy the end of your shift."
                        : `No tickets in ${selectedEntry?.member}'s attention queue today.`}
                    </p>
                  </div>
                )}

                {/* Cleared celebration */}
                {(queue?.status === "cleared" || justClearedFor === selected) &&
                  queue?.status !== "empty" &&
                  queue && (
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
                      const isTracked = item.status === "partial";
                      return (
                        <div
                          key={item.display_id}
                          className={`group relative rounded-xl border bg-slate-50/70 dark:bg-slate-800/40 hover:bg-white dark:hover:bg-slate-800/70 hover:shadow-md hover:shadow-black/5 transition-all overflow-hidden ${
                            isTracked
                              ? "border-violet-300/50 dark:border-violet-700/40 opacity-80"
                              : "border-slate-200 dark:border-slate-700/70 hover:border-slate-300 dark:hover:border-slate-600"
                          }`}
                        >
                          {/* bucket accent bar — violet when remark-tracked */}
                          <div className={`absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b ${isTracked ? "from-violet-400 to-purple-500" : meta.bar}`} />

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
                              {isTracked && (
                                <span
                                  className="text-[9px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-600 dark:text-violet-300"
                                  title="Internal remark added after the queue was built — being tracked, no alerts. Clears once the ticket is actioned in DevRev."
                                >
                                  Tracked
                                </span>
                              )}
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

              {/* ── Footer ─────────────────────────────────────── */}
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
                        <ShieldCheck className="w-4 h-4" />
                        {isSelf
                          ? `Verify & Clear (${actionableCount} to action${trackedItems.length ? `, ${trackedItems.length} tracked` : ""})`
                          : `Verify ${selectedEntry?.member}'s queue (${actionableCount} to action)`}
                      </>
                    )}
                  </button>
                  <p className="text-[10.5px] text-center text-slate-400 dark:text-slate-500 mt-2">
                    Re-checks live DevRev — tickets clear only once they're genuinely actioned.
                  </p>
                </div>
              )}
            </div>

            {/* ══ Member rail ═════════════════════════════════════ */}
            {members.length > 1 && (
              <div className="shrink-0 w-[68px] md:w-64 flex flex-col border-l border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
                <div className="shrink-0 px-3 md:px-4 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2 justify-center md:justify-start">
                    <Users className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                    <span className="hidden md:inline text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {scopeLabel}
                    </span>
                  </div>
                  <p className="hidden md:block text-[10px] text-slate-300 dark:text-slate-600 mt-1">
                    Heaviest queue on top — tap to view
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto px-1.5 md:px-2 py-2 space-y-0.5">
                  {loading && !members.length
                    ? [...Array(4)].map((_, i) => (
                        <div key={i} className="flex items-center gap-2.5 px-2.5 py-2 animate-pulse">
                          <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-800" />
                          <div className="hidden md:block flex-1 space-y-1.5">
                            <div className="h-2.5 w-20 rounded bg-slate-200 dark:bg-slate-800" />
                            <div className="h-2 w-14 rounded bg-slate-100 dark:bg-slate-800/60" />
                          </div>
                        </div>
                      ))
                    : viewer?.scope === "all"
                      ? teamGroups.map(([teamName, entries]) => (
                          <div key={teamName}>
                            <div className="hidden md:block px-2.5 pt-3 pb-1">
                              <span className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600">
                                {teamName}
                              </span>
                            </div>
                            {entries.map((entry) => (
                              <MemberRow
                                key={entry.member}
                                entry={entry}
                                selected={entry.member === selected}
                                onSelect={selectMember}
                                showTeam={false}
                              />
                            ))}
                          </div>
                        ))
                      : sortedMembers.map((entry) => (
                          <MemberRow
                            key={entry.member}
                            entry={entry}
                            selected={entry.member === selected}
                            onSelect={selectMember}
                            showTeam={false}
                          />
                        ))}
                </div>
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
        onClick={() => { setOpen(true); setJustClearedFor(null); setActiveBucket("all"); refresh(); }}
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

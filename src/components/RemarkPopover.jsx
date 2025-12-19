import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Send,
  User,
  Loader2,
  AtSign,
  Sparkles,
  MessageSquare,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useTicketStore } from "../store";
import { FLAT_TEAM_MAP, TEAM_GROUPS } from "../utils";

// --- HELPER: CLEAN RAW IDS FROM TEXT ---
// Turns "don:identity...devu/1111 please check" -> "@Rohan please check"
const cleanCommentBody = (text) => {
  if (!text) return "";

  // 1. Find all DevRev User IDs
  return text.replace(
    /don:identity:[\w:-]+\/(\w+)\/(\d+)/g,
    (match, type, id) => {
      // Construct the short ID (e.g., DEVU-1111) to look up in our map
      // Note: Our map keys are "DEVU-1111", but the raw string has "devu/1111".
      const shortId = `${type.toUpperCase()}-${id}`;
      const name = FLAT_TEAM_MAP[shortId];
      return name ? `@${name}` : "@User";
    }
  );
};

const RemarkPopover = ({ ticket, anchorRect, onClose }) => {
  const { postTicketComment, fetchTicketTimeline, currentUser } =
    useTicketStore();

  const [history, setHistory] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [mentionQuery, setMentionQuery] = useState(null);

  const textareaRef = useRef(null);
  const listRef = useRef(null);

  // Position Logic
  const modalHeight = 500;
  const viewportHeight = window.innerHeight;

  const top = anchorRect
    ? Math.min(
        anchorRect.bottom + window.scrollY + 8,
        viewportHeight - modalHeight - 20
      )
    : 0;

  const left = anchorRect ? anchorRect.left + window.scrollX - 420 : 0;

  // 1. Load Trail
  useEffect(() => {
    let mounted = true;
    fetchTicketTimeline(ticket.id).then((data) => {
      if (mounted) {
        setHistory(data.reverse());
        setLoadingHistory(false);
        setTimeout(
          () =>
            listRef.current?.scrollTo({
              top: listRef.current.scrollHeight,
              behavior: "smooth",
            }),
          100
        );
      }
    });
    return () => (mounted = false);
  }, [ticket.id]);

  // 2. Handle Send
  const handleSend = async () => {
    if (!newComment.trim()) return;
    setSending(true);

    // Optimistic UI Update text
    const textForDisplay = newComment;

    try {
      await postTicketComment(ticket.id, newComment);

      const newEntry = {
        id: "temp-" + Date.now(),
        body: textForDisplay,
        created_date: new Date().toISOString(),
        created_by: { display_name: currentUser.name },
      };

      setHistory([...history, newEntry]);
      setNewComment("");
      setTimeout(
        () =>
          listRef.current?.scrollTo({
            top: listRef.current.scrollHeight,
            behavior: "smooth",
          }),
        100
      );
    } catch (err) {
      alert("Sync failed.");
    } finally {
      setSending(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  // 3. Handle Mentions
  const handleInput = (e) => {
    const val = e.target.value;
    setNewComment(val);

    if (val.endsWith("@")) {
      setMentionQuery("");
    } else if (mentionQuery !== null) {
      const parts = val.split("@");
      const lastPart = parts[parts.length - 1];
      if (lastPart.includes(" ")) {
        setMentionQuery(null);
      } else {
        setMentionQuery(lastPart);
      }
    }
  };

  const insertMention = (name) => {
    const parts = newComment.split("@");
    parts.pop();
    const text = parts.join("@") + "@" + name + " ";
    setNewComment(text);
    setMentionQuery(null);
    textareaRef.current.focus();
  };

  const mentionOptions =
    mentionQuery !== null
      ? Object.values(FLAT_TEAM_MAP).filter((name) =>
          name.toLowerCase().includes(mentionQuery.toLowerCase())
        )
      : [];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-transparent" onClick={onClose} />

      <div
        className="fixed z-50 bg-white rounded-2xl shadow-2xl border border-slate-200 w-[400px] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 ring-1 ring-slate-900/5 font-sans"
        style={{
          top: Math.max(20, top),
          left: Math.max(20, left),
          height: "500px",
        }}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-white border-b border-slate-50 flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              Justification Trail
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
              Ref:{" "}
              <span className="font-mono text-indigo-600">
                {ticket.display_id}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-300 hover:text-slate-600 transition-colors bg-slate-50 p-1.5 rounded-full"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* THE TRAIL */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50/50"
        >
          {loadingHistory ? (
            <div className="flex justify-center items-center h-full text-slate-400 gap-2 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> Fetching updates...
            </div>
          ) : history.length === 0 ? (
            <div className="text-center mt-20 opacity-50">
              <div className="bg-white w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-slate-100">
                <MessageSquare className="w-5 h-5 text-slate-300" />
              </div>
              <p className="text-xs text-slate-400 font-medium">
                No justifications yet.
              </p>
            </div>
          ) : (
            history.map((entry, i) => (
              <div
                key={entry.id || i}
                className="flex gap-3 animate-in slide-in-from-bottom-2"
              >
                <div className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[10px] font-bold text-indigo-600 shrink-0 shadow-sm mt-1">
                  {entry.created_by?.display_name?.[0] || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="text-xs font-bold text-slate-700">
                      {entry.created_by?.display_name}
                    </span>
                    <span className="text-[9px] text-slate-400 font-medium">
                      {format(parseISO(entry.created_date), "MMM d, h:mm a")}
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-lg rounded-tl-none border border-slate-200 text-xs text-slate-600 shadow-sm leading-relaxed whitespace-pre-wrap break-words">
                    {/* APPLY CLEANING HERE */}
                    {cleanCommentBody(entry.body)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-slate-100 shrink-0 relative z-50">
          {/* TAGGING DROPDOWN (Fixed Positioning) */}
          {mentionQuery !== null && mentionOptions.length > 0 && (
            <div className="absolute bottom-[100%] left-4 mb-2 w-56 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-40 overflow-y-auto ring-1 ring-black/5">
              <div className="px-3 py-2 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                Suggested Members
              </div>
              {mentionOptions.map((name) => (
                <button
                  key={name}
                  onClick={() => insertMention(name)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-indigo-50 text-slate-700 flex items-center gap-2 transition-colors border-b border-slate-50 last:border-0"
                >
                  <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold">
                    {name[0]}
                  </div>
                  {name}
                </button>
              ))}
            </div>
          )}

          <div className="relative bg-slate-50 rounded-xl border border-slate-200 focus-within:border-indigo-300 focus-within:ring-1 focus-within:ring-indigo-100 transition-all p-1">
            <textarea
              ref={textareaRef}
              className="w-full text-sm text-slate-700 placeholder:text-slate-400 resize-none focus:outline-none bg-transparent min-h-[50px] max-h-[100px] leading-relaxed p-2"
              placeholder="Write an update... use @ to tag"
              value={newComment}
              onChange={handleInput}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <div className="flex justify-between items-center px-2 pb-1">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <AtSign
                  className={`w-3.5 h-3.5 transition-colors ${
                    mentionQuery !== null ? "text-indigo-500" : "text-slate-300"
                  }`}
                />
              </div>
              <button
                onClick={handleSend}
                disabled={sending || !newComment.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-black text-white text-[10px] font-bold rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:shadow-none"
              >
                {sending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Send className="w-3 h-3" />
                )}
                Post
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default RemarkPopover;

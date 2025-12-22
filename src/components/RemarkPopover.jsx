import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import {
  X,
  Send,
  Loader2,
  AtSign,
  Sparkles,
  MessageSquare,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useTicketStore } from "../store";

const RemarkPopover = ({ ticket, anchorRect, onClose }) => {
  const { postTicketComment, fetchTicketTimeline, currentUser } =
    useTicketStore();

  const [history, setHistory] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [mentionQuery, setMentionQuery] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const textareaRef = useRef(null);
  const listRef = useRef(null);
  const mentionListRef = useRef(null);

  // --- POSITIONING LOGIC ---
  // Calculates where to float the window based on the clicked button
  const POPUP_WIDTH = 384; // w-96
  const POPUP_HEIGHT = 500;

  const style = anchorRect
    ? {
        position: "fixed",
        // Align bottom of popup to top of button (with 10px gap)
        top: Math.max(10, anchorRect.top - POPUP_HEIGHT - 10),
        // Align right of popup to right of button (so it stays on screen)
        left: anchorRect.right - POPUP_WIDTH,
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
      }
    : {};

  // 1. FETCH USERS
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
        const res = await axios.get(`${API_URL}/api/users`);
        const formattedUsers = res.data.map((u) => ({
          name: u.full_name || u.display_name,
          id: u.id,
          email: u.email,
        }));
        setUsers(formattedUsers);
      } catch (err) {
        console.error("Failed to load users:", err);
      }
    };
    fetchUsers();
  }, []);

  // 2. LOAD HISTORY (FROM LOCAL SERVER)
  // This ensures comments persist even after refresh!
  useEffect(() => {
    const fetchHistory = async () => {
      if (!ticket) return;
      setLoadingHistory(true);
      try {
        // ✅ Call Local Server (server.js)
        const API_URL = "http://localhost:5000";
        const res = await axios.get(
          `${API_URL}/api/remarks/${ticket.display_id}`
        );

        // ✅ Map Server Data -> UI Format
        const adaptedHistory = res.data.map((item) => ({
          id: item.id,
          body: item.text,
          created_date: item.timestamp,
          created_by: {
            display_name: item.user,
            id: "local",
          },
        }));

        setHistory(adaptedHistory); // No reverse needed if push appends

        // Scroll to bottom
        setTimeout(() => {
          listRef.current?.scrollTo({
            top: listRef.current.scrollHeight,
            behavior: "smooth",
          });
        }, 100);
      } catch (err) {
        console.error("Failed to load local remarks:", err);
      } finally {
        setLoadingHistory(false);
      }
    };

    fetchHistory();
  }, [ticket.display_id]);

  const cleanCommentBody = (text) => {
    if (!text) return "";
    return text.replace(/<((?:don:identity)[^>]+)>/g, (_, id) => {
      const user = users.find((u) => u.id === id);
      return user ? `@${user.name}` : "@Unknown";
    });
  };

  const buildDevRevIdentity = (user) => {
    if (user?.id?.startsWith("don:identity")) return user.id;
    const shortId = user?.display_id || user?.id;
    if (!shortId?.startsWith("DEVU-")) return null;
    const systemId = shortId.toLowerCase().replace("-", "/");
    return `don:identity:dvrv-us-1:devo/1iVu4ClfVV:${systemId}`;
  };

  const handleSend = async () => {
    if (!newComment.trim()) return;
    setSending(true);

    const textForDisplay = newComment;
    let payloadBody = newComment;

    const sortedUsers = [...users].sort(
      (a, b) => b.name.length - a.name.length
    );

    sortedUsers.forEach((u) => {
      if (payloadBody.includes(`@${u.name}`)) {
        payloadBody = payloadBody.replaceAll(`@${u.name}`, `<${u.id}>`);
      }
    });

    const authorIdentity = buildDevRevIdentity(currentUser);
    const signature = authorIdentity ? `\n\n— By <${authorIdentity}>` : "";
    const finalBody = payloadBody + signature;

    try {
      await postTicketComment(ticket.id, finalBody);
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
      console.error(err);
      alert("Sync failed.");
    } finally {
      setSending(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  const handleInput = (e) => {
    const val = e.target.value;
    setNewComment(val);
    const cursorPos = e.target.selectionStart;
    const textUntilCursor = val.slice(0, cursorPos);
    const atIndex = textUntilCursor.lastIndexOf("@");
    if (atIndex === -1) {
      setMentionQuery(null);
      return;
    }
    const afterAt = textUntilCursor.slice(atIndex + 1);
    if (afterAt.includes("\n") || afterAt.includes("@")) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(afterAt.trimStart());
  };

  const insertMention = (user) => {
    const parts = newComment.split("@");
    parts.pop();
    const text = parts.join("@") + "@" + user.name + " ";
    setNewComment(text);
    setMentionQuery(null);
    textareaRef.current?.focus();
  };

  const mentionOptions =
    mentionQuery !== null
      ? users.filter((u) =>
          u.name.toLowerCase().includes(mentionQuery.toLowerCase())
        )
      : [];

  const handleKeyDown = (e) => {
    if (mentionQuery !== null && mentionOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % mentionOptions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + mentionOptions.length) % mentionOptions.length
        );
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionOptions[selectedIndex]);
      } else if (e.key === "Escape") {
        setMentionQuery(null);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    if (mentionListRef.current && mentionOptions.length > 0) {
      const selectedElement = mentionListRef.current.children[selectedIndex];
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }
  }, [selectedIndex]);

  useEffect(() => setSelectedIndex(0), [mentionQuery]);

  // ✅ FIX: Floating Position based on 'style' (No Blur)
  return (
    <>
      {/* Click outside to close (Invisible) */}
      {/* <div className="fixed inset-0 z-40" onClick={onClose} /> */}

      <div
        style={style}
        className="fixed z-50 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
      >
        {/* HEADER */}
        <div className="px-5 py-4 bg-white dark:bg-slate-900 border-b border-slate-50 dark:border-slate-800 flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              Internal Remark
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
              Ref:{" "}
              <a
                href={`https://app.devrev.ai/clevertapsupport/works/${ticket.display_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-indigo-500 hover:underline"
              >
                {ticket.display_id}
              </a>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-300 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* CHAT AREA */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50/50 dark:bg-slate-900/50"
        >
          {loadingHistory ? (
            <div className="flex justify-center items-center h-full text-slate-400 gap-2 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> Fetching updates...
            </div>
          ) : history.length === 0 ? (
            <div className="text-center mt-20 opacity-50">
              <MessageSquare className="w-5 h-5 text-slate-300 mx-auto mb-3" />
              <p className="text-xs text-slate-400">No justifications yet.</p>
            </div>
          ) : (
            history.map((entry, i) => (
              <div
                key={entry.id || i}
                className="flex gap-3 animate-in slide-in-from-bottom-2"
              >
                <div className="w-7 h-7 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-[10px] font-bold text-indigo-600 shrink-0 shadow-sm mt-1">
                  {entry.created_by?.display_name?.[0] || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1.5">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      {entry.created_by?.display_name}
                    </span>
                    <span className="text-[9px] text-slate-400 font-medium">
                      {format(parseISO(entry.created_date), "MMM d, h:mm a")}
                    </span>
                  </div>
                  <div className="bg-white dark:bg-slate-800 p-3 rounded-lg rounded-tl-none border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 shadow-sm leading-relaxed whitespace-pre-wrap break-words">
                    {cleanCommentBody(entry.body)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* INPUT AREA */}
        <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 shrink-0 relative z-50">
          {/* Mention Dropdown */}
          {mentionQuery !== null && mentionOptions.length > 0 && (
            <div
              ref={mentionListRef}
              className="absolute bottom-[100%] left-4 mb-2 w-56 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden max-h-40 overflow-y-auto ring-1 ring-black/5"
            >
              {mentionOptions.map((user, index) => (
                <button
                  key={user.id}
                  onClick={() => insertMention(user)}
                  className={`w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors border-b border-slate-50 dark:border-slate-700 last:border-0 ${
                    index === selectedIndex
                      ? "bg-indigo-50 dark:bg-indigo-900/30"
                      : "hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  <div className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-[10px] font-bold">
                    {user.name.charAt(0)}
                  </div>
                  {user.name}
                </button>
              ))}
            </div>
          )}

          <div className="relative bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 focus-within:border-indigo-300 focus-within:ring-1 focus-within:ring-indigo-100 transition-all p-1">
            <textarea
              ref={textareaRef}
              className="w-full text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 bg-transparent resize-none focus:outline-none min-h-[50px] max-h-[100px] leading-relaxed p-2"
              placeholder="Write an update... use @ to tag"
              value={newComment}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
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
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 dark:bg-slate-700 hover:bg-black dark:hover:bg-slate-600 text-white text-[10px] font-bold rounded-lg shadow-sm transition-all disabled:opacity-50"
              >
                {sending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Send className="w-3 h-3" />
                )}{" "}
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

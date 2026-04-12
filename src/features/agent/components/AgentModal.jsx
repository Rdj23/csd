import React, { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Loader2, AlertCircle, Sparkles, X, Square } from "lucide-react";
import { sendAgentQuery, pollAgentResponse } from "../../../api/agentApi";

const POLL_INTERVAL = 2000;
const MAX_POLLS = 60;
const MAX_CONSECUTIVE_POLL_ERRORS = 4;
const MAX_QUERY_ATTEMPTS = 3;

// Parse inline markdown bold (**text**) within a plain string
function parseBold(str, keyPrefix = 0) {
  const BOLD_REGEX = /\*\*(.+?)\*\*/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = BOLD_REGEX.exec(str)) !== null) {
    if (match.index > lastIndex) {
      parts.push(str.slice(lastIndex, match.index));
    }
    parts.push(<strong key={`b-${keyPrefix}-${match.index}`}>{match[1]}</strong>);
    lastIndex = BOLD_REGEX.lastIndex;
  }

  if (lastIndex < str.length) {
    parts.push(str.slice(lastIndex));
  }

  return parts.length > 0 ? parts : str;
}

// Parse markdown links [text](url) into clickable <a> tags, then apply bold parsing to remaining text
function parseLinks(str, keyPrefix = 0) {
  const LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = LINK_REGEX.exec(str)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...[].concat(parseBold(str.slice(lastIndex, match.index), `${keyPrefix}-${lastIndex}`)));
    }
    const linkText = match[1];
    const url = match[2];
    parts.push(
      <a
        key={`link-${keyPrefix}-${match.index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        download
        className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
      >
        {linkText}
      </a>
    );
    lastIndex = LINK_REGEX.lastIndex;
  }

  if (lastIndex < str.length) {
    parts.push(...[].concat(parseBold(str.slice(lastIndex), `${keyPrefix}-${lastIndex}`)));
  }

  return parts.length > 0 ? parts : parseBold(str, keyPrefix);
}

// Parse inline content: DON URIs → markdown links → bold
function parseInline(text, keyPrefix = 0) {
  const DON_REGEX = /\[?<don:core:[^:]+:[^:]+:ticket\/(\d+)>\]?/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = DON_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...[].concat(parseLinks(text.slice(lastIndex, match.index), `${keyPrefix}-${match.index}`)));
    }
    const ticketNum = match[1];
    parts.push(
      <a
        key={`don-${keyPrefix}-${match.index}`}
        href={`https://app.devrev.ai/clevertapsupport/works/TKT-${ticketNum}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
      >
        TKT-{ticketNum}
      </a>
    );
    lastIndex = DON_REGEX.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(...[].concat(parseLinks(text.slice(lastIndex), `${keyPrefix}-${lastIndex}`)));
  }

  return parts.length > 0 ? parts : text;
}

function isTableSeparator(line) {
  return /^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/.test(line.trim());
}

function renderTable(lines, keyPrefix) {
  const parseRow = (line) =>
    line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  const headerCells = parseRow(lines[0]);
  const dataLines = lines.slice(isTableSeparator(lines[1]) ? 2 : 1);

  return (
    <div key={`tbl-${keyPrefix}`} className="my-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-slate-100 dark:bg-slate-800">
            {headerCells.map((cell, i) => (
              <th
                key={i}
                className="px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap border-b border-slate-200 dark:border-slate-700"
              >
                {parseInline(cell, `th-${keyPrefix}-${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {dataLines.map((line, ri) => {
            const cells = parseRow(line);
            return (
              <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                {headerCells.map((_, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap"
                  >
                    {parseInline(cells[ci] || "", `td-${keyPrefix}-${ri}-${ci}`)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatAgentText(text) {
  const lines = text.split("\n");
  const result = [];
  let i = 0;
  let proseBuffer = [];

  const flushProse = () => {
    if (proseBuffer.length === 0) return;
    const chunk = proseBuffer.join("\n");
    proseBuffer = [];
    if (chunk.trim()) {
      result.push(...[].concat(parseInline(chunk, result.length)));
    } else {
      result.push(chunk);
    }
  };

  while (i < lines.length) {
    if (
      lines[i].includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      flushProse();
      const tableLines = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && !isTableSeparator(lines[i]) && lines[i].trim() !== "") {
        tableLines.push(lines[i]);
        i++;
      }
      result.push(renderTable(tableLines, i));
    } else {
      proseBuffer.push(lines[i]);
      i++;
    }
  }
  flushProse();

  return result;
}

const SUGGESTIONS = [
  "How many open tickets do we have?",
  "Show high priority tickets",
  "Which accounts have most tickets?",
];

export default function AgentModal({ open, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionObject, setSessionObject] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const pollTimerRef = useRef(null);
  const cancelledRef = useRef(false);
  const backdropRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const [loadingStatus, setLoadingStatus] = useState("Thinking...");

  const handleStop = () => {
    cancelledRef.current = true;
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setLoading(false);
    setLoadingStatus("Thinking...");
    inputRef.current?.focus();
  };

  const executeQueryAndPoll = async (query, sessionObj) => {
    if (cancelledRef.current) return { ok: false, retryable: false, cancelled: true };

    let sessionId;
    try {
      const res = await sendAgentQuery(query, sessionObj);
      sessionId = res.sessionId;
    } catch (err) {
      if (cancelledRef.current) return { ok: false, retryable: false, cancelled: true };
      const status = err.response?.status;
      return { ok: false, retryable: !status || status >= 500, error: err };
    }

    if (!sessionObj) {
      setSessionObject(sessionId);
    }

    return new Promise((resolve) => {
      let pollCount = 0;
      let consecutiveErrors = 0;

      pollTimerRef.current = setInterval(async () => {
        if (cancelledRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          resolve({ ok: false, retryable: false, cancelled: true });
          return;
        }

        pollCount++;

        if (pollCount === 15) setLoadingStatus("Still working...");
        else if (pollCount === 30) setLoadingStatus("Taking a bit longer than usual...");
        else if (pollCount === 45) setLoadingStatus("Almost there...");

        try {
          const result = await pollAgentResponse(sessionId);
          consecutiveErrors = 0;

          if (result.status === "done") {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
            resolve({ ok: true, text: result.text, type: result.type });
          } else if (pollCount >= MAX_POLLS) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
            resolve({ ok: false, retryable: true });
          }
        } catch {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
            resolve({ ok: false, retryable: true });
          }
        }
      }, POLL_INTERVAL);
    });
  };

  const handleSend = async (overrideQuery) => {
    const query = (overrideQuery || input).trim();
    if (!query || loading) return;

    cancelledRef.current = false;

    setMessages((prev) => [...prev, { role: "user", text: query }]);
    setInput("");
    setLoading(true);
    setLoadingStatus("Thinking...");

    let lastResult;
    for (let attempt = 0; attempt < MAX_QUERY_ATTEMPTS; attempt++) {
      if (cancelledRef.current) return;

      if (attempt > 0) {
        setLoadingStatus(`Retrying... (attempt ${attempt + 1}/${MAX_QUERY_ATTEMPTS})`);
        await new Promise((r) => setTimeout(r, 1500));
        if (cancelledRef.current) return;
      }

      lastResult = await executeQueryAndPoll(query, sessionObject);

      if (lastResult?.cancelled) return;

      if (lastResult.ok) {
        setMessages((prev) => [...prev, { role: "agent", text: lastResult.text, type: lastResult.type }]);
        setLoading(false);
        inputRef.current?.focus();
        return;
      }

      if (!lastResult.retryable) break;
    }

    if (!cancelledRef.current) {
      const errMsg = lastResult?.error?.response?.data?.error
        || lastResult?.error?.message
        || "Something went wrong. Please try again in a moment.";
      setMessages((prev) => [...prev, { role: "agent", text: errMsg, type: "error" }]);
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      onClick={(e) => e.target === backdropRef.current && onClose()}
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[8vh] px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700/80 flex flex-col overflow-hidden"
        style={{
          maxHeight: "80vh",
          animation: "agentModalIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-[14px] text-slate-800 dark:text-white">InsightX</h3>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">Ask anything about your tickets & data</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar" style={{ minHeight: "200px" }}>
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 flex items-center justify-center mb-4">
                <Bot className="w-8 h-8 text-indigo-400" />
              </div>
              <h4 className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">What can I help you with?</h4>
              <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs mb-5">
                Ask questions about tickets, customers, or support data.
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-md">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    className="px-3.5 py-2 text-[12px] rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-200 dark:hover:border-indigo-700 transition-all duration-150"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "agent" && (
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/40 dark:to-purple-900/40 flex items-center justify-center shrink-0 mt-0.5">
                  {msg.type === "error" ? (
                    <AlertCircle className="w-4 h-4 text-red-500" />
                  ) : (
                    <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  )}
                </div>
              )}
              <div
                className={`max-w-[78%] px-4 py-3 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-br-md shadow-md shadow-indigo-500/10"
                    : msg.type === "error"
                      ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-bl-md"
                      : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-bl-md border border-slate-100 dark:border-slate-700/50"
                }`}
              >
                {msg.role === "agent" ? formatAgentText(msg.text) : msg.text}
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-900/40 dark:to-purple-900/40 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 px-4 py-3 rounded-2xl rounded-bl-md border border-slate-100 dark:border-slate-700/50">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                  <span className="text-xs text-slate-400 transition-all duration-300">{loadingStatus}</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-slate-100 dark:border-slate-800 p-4 bg-slate-50/60 dark:bg-slate-800/30">
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={loading ? "Stop current query to send a new one..." : "Ask the DevRev agent..."}
              disabled={false}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-[13px] text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all"
              style={{ maxHeight: "120px" }}
              onInput={(e) => {
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
            />
            {loading ? (
              <button
                onClick={handleStop}
                className="shrink-0 w-10 h-10 rounded-xl bg-slate-600 hover:bg-slate-700 text-white flex items-center justify-center transition-all shadow-md shadow-slate-500/20"
                title="Stop generating"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-indigo-500/20 disabled:shadow-none"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes agentModalIn {
          from {
            opacity: 0;
            transform: translateY(-20px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}

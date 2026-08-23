import React, { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Loader2, AlertCircle, Plus, MessageSquare, Square } from "lucide-react";
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
  const DON_REGEX = /\[?<don:core:[^:]+:[^:]+:(ticket|issue)\/(\d+)>\]?/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = DON_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...[].concat(parseLinks(text.slice(lastIndex, match.index), `${keyPrefix}-${match.index}`)));
    }
    const prefix = match[1] === "issue" ? "ISS" : "TKT";
    const ticketNum = match[2];
    parts.push(
      <a
        key={`don-${keyPrefix}-${match.index}`}
        href={`https://app.devrev.ai/clevertapsupport/works/${prefix}-${ticketNum}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
      >
        {prefix}-{ticketNum}
      </a>
    );
    lastIndex = DON_REGEX.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(...[].concat(parseLinks(text.slice(lastIndex), `${keyPrefix}-${lastIndex}`)));
  }

  return parts.length > 0 ? parts : text;
}

// Detect whether a line is a markdown table separator (e.g. |---|---|)
function isTableSeparator(line) {
  return /^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/.test(line.trim());
}

// Parse a block of markdown table lines into a styled <table>
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

// Top-level formatter: splits text into table blocks and prose, renders each appropriately
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
    // Detect start of a table: a pipe-containing line followed by a separator line
    if (
      lines[i].includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      flushProse();
      const tableLines = [lines[i], lines[i + 1]];
      i += 2;
      // Collect remaining data rows
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

export default function AgentChat() {
  // Each chat has its own sessionObject for DevRev conversation memory
  const [chats, setChats] = useState([{ id: Date.now(), title: "New Chat", messages: [], sessionObject: null }]);
  const [activeChatId, setActiveChatId] = useState(chats[0].id);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const pollTimerRef = useRef(null);
  const cancelledRef = useRef(false);

  const activeChat = chats.find((c) => c.id === activeChatId) || chats[0];
  const messages = activeChat.messages;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const updateActiveChat = (updater) => {
    setChats((prev) =>
      prev.map((c) => (c.id === activeChatId ? updater(c) : c))
    );
  };

  const handleNewChat = () => {
    if (loading) return;
    const newChat = { id: Date.now(), title: "New Chat", messages: [], sessionObject: null };
    setChats((prev) => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setInput("");
    inputRef.current?.focus();
  };

  const switchChat = (chatId) => {
    if (loading) return;
    setActiveChatId(chatId);
    setInput("");
  };

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
      updateActiveChat((c) => ({ ...c, sessionObject: sessionId }));
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

    updateActiveChat((c) => ({
      ...c,
      title: c.messages.length === 0 ? query.substring(0, 40) + (query.length > 40 ? "..." : "") : c.title,
      messages: [...c.messages, { role: "user", text: query }],
    }));
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

      lastResult = await executeQueryAndPoll(query, activeChat.sessionObject);

      if (lastResult?.cancelled) return;

      if (lastResult.ok) {
        updateActiveChat((c) => ({
          ...c,
          messages: [...c.messages, { role: "agent", text: lastResult.text, type: lastResult.type }],
        }));
        setLoading(false);
        inputRef.current?.focus();
        return;
      }

      if (!lastResult.retryable) break;
    }

    // All attempts exhausted
    if (!cancelledRef.current) {
      const errMsg = lastResult?.error?.response?.data?.error
        || lastResult?.error?.message
        || "Something went wrong. Please try again in a moment.";
      updateActiveChat((c) => ({
        ...c,
        messages: [...c.messages, { role: "agent", text: errMsg, type: "error" }],
      }));
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full gap-0 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden"
         style={{ boxShadow: "var(--shadow-card)" }}>

      {/* Sidebar — Chat history */}
      <div className="w-56 shrink-0 bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
        <div className="p-3 border-b border-slate-200 dark:border-slate-800">
          <button
            onClick={handleNewChat}
            disabled={loading}
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {chats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => switchChat(chat.id)}
              className={`w-full text-left px-3 py-2 text-[12px] rounded-lg transition-colors truncate flex items-center gap-2 ${
                chat.id === activeChatId
                  ? "bg-indigo-50 text-indigo-700 font-semibold dark:bg-indigo-900/30 dark:text-indigo-300"
                  : "text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800"
              }`}
            >
              <MessageSquare className="w-3 h-3 shrink-0" />
              <span className="truncate">{chat.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col bg-white dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
              <Bot className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="font-semibold text-[13px] text-slate-700 dark:text-slate-200">InsightX</h3>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">Ask anything about your tickets & data</p>
            </div>
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
                <Bot className="w-7 h-7 text-indigo-400" />
              </div>
              <h4 className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">InsightX</h4>
              <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs">
                Ask questions about your tickets, customers, or support data. The agent will query DevRev and respond.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 justify-center max-w-md">
                {[
                  "How many open tickets do we have?",
                  "Show high priority tickets",
                  "Which accounts have most tickets?",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                    className="px-3 py-1.5 text-[11px] rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-200 dark:hover:border-indigo-800 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "agent" && (
                <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0 mt-0.5">
                  {msg.type === "error" ? (
                    <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                  ) : (
                    <Bot className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  )}
                </div>
              )}
              <div
                className={`max-w-[75%] px-3.5 py-2.5 rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white rounded-br-sm"
                    : msg.type === "error"
                      ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-bl-sm"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-bl-sm"
                }`}
              >
                {msg.role === "agent" ? formatAgentText(msg.text) : msg.text}
              </div>
              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-2.5 justify-start">
              <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
                <Bot className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="bg-slate-100 dark:bg-slate-800 px-4 py-3 rounded-xl rounded-bl-sm">
                <div className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                  <span className="text-xs text-slate-400 transition-all duration-300">{loadingStatus}</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-slate-100 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={loading ? "Stop current query to send a new one..." : "Ask the DevRev agent..."}
              disabled={false}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-[13px] text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-shadow"
              style={{ maxHeight: "120px" }}
              onInput={(e) => {
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
            />
            {loading ? (
              <button
                onClick={handleStop}
                className="shrink-0 w-9 h-9 rounded-xl bg-slate-600 hover:bg-slate-700 text-white flex items-center justify-center transition-colors"
                title="Stop generating"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="shrink-0 w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

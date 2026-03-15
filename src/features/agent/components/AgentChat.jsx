import React, { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { sendAgentQuery, pollAgentResponse } from "../../../api/agentApi";

const POLL_INTERVAL = 2000; // 2 seconds
const MAX_POLLS = 60;       // 2 min max wait

export default function AgentChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const pollTimerRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const handleSend = async () => {
    const query = input.trim();
    if (!query || loading) return;

    // Add user message
    setMessages((prev) => [...prev, { role: "user", text: query }]);
    setInput("");
    setLoading(true);

    try {
      const { sessionId } = await sendAgentQuery(query);

      // Start polling
      let pollCount = 0;
      pollTimerRef.current = setInterval(async () => {
        pollCount++;
        try {
          const result = await pollAgentResponse(sessionId);

          if (result.status === "done") {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
            setMessages((prev) => [
              ...prev,
              {
                role: "agent",
                text: result.text,
                type: result.type, // "message" or "error"
              },
            ]);
            setLoading(false);
            inputRef.current?.focus();
          } else if (pollCount >= MAX_POLLS) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
            setMessages((prev) => [
              ...prev,
              { role: "agent", text: "Request timed out. Please try again.", type: "error" },
            ]);
            setLoading(false);
          }
        } catch {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setMessages((prev) => [
            ...prev,
            { role: "agent", text: "Failed to fetch response.", type: "error" },
          ]);
          setLoading(false);
        }
      }, POLL_INTERVAL);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "agent", text: err.message || "Failed to send query.", type: "error" },
      ]);
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    if (loading) return;
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden"
         style={{ boxShadow: "var(--shadow-card)" }}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
            <Bot className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h3 className="font-semibold text-[13px] text-slate-700 dark:text-slate-200">DevRev AI Agent</h3>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">Ask anything about your tickets & data</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            disabled={loading}
            className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-40"
            title="Clear chat"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
              <Bot className="w-7 h-7 text-indigo-400" />
            </div>
            <h4 className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">DevRev AI Agent</h4>
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
              {msg.text}
            </div>
            {msg.role === "user" && (
              <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex gap-2.5 justify-start">
            <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="bg-slate-100 dark:bg-slate-800 px-4 py-3 rounded-xl rounded-bl-sm">
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />
                <span className="text-xs text-slate-400">Thinking...</span>
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
            placeholder="Ask the DevRev agent..."
            disabled={loading}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-[13px] text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 disabled:opacity-50 transition-shadow"
            style={{ maxHeight: "120px" }}
            onInput={(e) => {
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="shrink-0 w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Clock,
  CheckCircle,
  AlertTriangle,
  AlertOctagon,
  Building2,
  User,
  Ticket,
  TrendingUp,
} from "lucide-react";
import { FLAT_TEAM_MAP, STAGE_MAP } from "../utils";

const GroupedTicketList = ({ tickets, onProfileClick }) => {
  const [expandedOwners, setExpandedOwners] = useState(new Set());
  const [sortBy, setSortBy] = useState("count"); // "count" | "name" | "health"

  // Group tickets by owner
  const groupedData = useMemo(() => {
    const groups = {};

    tickets.forEach((t) => {
      const ownerName =
        FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
        t.owned_by?.[0]?.display_name ||
        "Unassigned";

      if (!groups[ownerName]) {
        groups[ownerName] = {
          name: ownerName,
          tickets: [],
          healthy: 0,
          attention: 0,
          critical: 0,
        };
      }

      groups[ownerName].tickets.push(t);

      // Count by priority
      if (t.priority === 1) groups[ownerName].critical++;
      else if (t.priority === 2) groups[ownerName].attention++;
      else groups[ownerName].healthy++;
    });

    // Convert to array and sort
    let sorted = Object.values(groups);

    if (sortBy === "count") {
      sorted.sort((a, b) => b.tickets.length - a.tickets.length);
    } else if (sortBy === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "health") {
      sorted.sort((a, b) => b.critical - a.critical || b.attention - a.attention);
    }

    return sorted;
  }, [tickets, sortBy]);

  // Get initials for avatar
  const getInitials = (name) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  // Get avatar color based on name
  const getAvatarColor = (name) => {
    const colors = [
      "bg-indigo-500",
      "bg-emerald-500",
      "bg-amber-500",
      "bg-rose-500",
      "bg-cyan-500",
      "bg-violet-500",
      "bg-pink-500",
      "bg-teal-500",
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const toggleOwner = (ownerName) => {
    setExpandedOwners((prev) => {
      const next = new Set(prev);
      if (next.has(ownerName)) {
        next.delete(ownerName);
      } else {
        next.add(ownerName);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedOwners(new Set(groupedData.map((g) => g.name)));
  };

  const collapseAll = () => {
    setExpandedOwners(new Set());
  };

  // Stats
  const totalOwners = groupedData.length;
  const totalTickets = tickets.length;

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <User className="w-4 h-4" />
            <span className="font-semibold">{totalOwners}</span> owners
            <span className="text-slate-300 dark:text-slate-600">•</span>
            <Ticket className="w-4 h-4" />
            <span className="font-semibold">{totalTickets}</span> tickets
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Sort Dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="text-xs px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 font-medium"
          >
            <option value="count">Sort by Count</option>
            <option value="name">Sort by Name</option>
            <option value="health">Sort by Health</option>
          </select>

          {/* Expand/Collapse */}
          <button
            onClick={expandAll}
            className="text-xs px-3 py-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-medium"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="text-xs px-3 py-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-medium"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Grouped List */}
      <div className="space-y-2">
        {groupedData.map((group) => {
          const isExpanded = expandedOwners.has(group.name);

          return (
            <div
              key={group.name}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden transition-all duration-200"
            >
              {/* Owner Header */}
              <button
                onClick={() => toggleOwner(group.name)}
                className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {/* Expand Icon */}
                  <div className="w-5 h-5 flex items-center justify-center text-slate-400">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </div>

                  {/* Avatar */}
                  <div
                    className={`w-10 h-10 rounded-full ${getAvatarColor(
                      group.name
                    )} flex items-center justify-center text-white text-sm font-bold shadow-sm`}
                  >
                    {getInitials(group.name)}
                  </div>

                  {/* Name & Count */}
                  <div className="text-left">
                    <div className="font-semibold text-slate-800 dark:text-white">
                      {group.name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {group.tickets.length} ticket
                      {group.tickets.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>

                {/* Health Badges */}
                <div className="flex items-center gap-2">
                  {group.healthy > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                      <CheckCircle className="w-3 h-3" />
                      {group.healthy}
                    </span>
                  )}
                  {group.attention > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      <AlertTriangle className="w-3 h-3" />
                      {group.attention}
                    </span>
                  )}
                  {group.critical > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                      <AlertOctagon className="w-3 h-3" />
                      {group.critical}
                    </span>
                  )}
                </div>
              </button>

              {/* Tickets List (Expandable) */}
              {isExpanded && (
                <div className="border-t border-slate-100 dark:border-slate-800">
                  {group.tickets.map((t, idx) => (
                    <div
                      key={t.id || idx}
                      className={`flex items-center gap-4 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${
                        idx !== group.tickets.length - 1
                          ? "border-b border-slate-50 dark:border-slate-800/50"
                          : ""
                      }`}
                    >
                      {/* Priority Indicator */}
                      <div
                        className={`w-1.5 h-10 rounded-full ${
                          t.priority === 1
                            ? "bg-rose-500"
                            : t.priority === 2
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                        }`}
                      />

                      {/* Ticket Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <a
                            href={`https://app.devrev.ai/clevertapsupport/works/${t.display_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            {t.display_id}
                          </a>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                          {t.accountName && t.accountName !== "Unknown" && (
                            <span className="flex items-center gap-1 text-[10px] text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                              <Building2 className="w-2.5 h-2.5" />
                              {t.accountName}
                            </span>
                          )}
                        </div>
                        <div
                          className="text-sm text-slate-700 dark:text-slate-300 truncate"
                          title={t.title}
                        >
                          {t.title}
                        </div>
                      </div>

                      {/* Region */}
                      <div className="hidden md:block w-24">
                        <span className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                          {t.region || "—"}
                        </span>
                      </div>

                      {/* Age */}
                      <div className="w-20 text-right">
                        <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                          {t.days} days
                        </span>
                      </div>

                      {/* Status Badge */}
                      <div className="w-28">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold ${t.uiColor}`}
                        >
                          <t.uiIcon className="w-3 h-3" />
                          {t.uiStatus}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {groupedData.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <Ticket className="w-12 h-12 mb-3 opacity-40" />
          <p className="text-sm font-medium">No tickets found</p>
          <p className="text-xs mt-1">Try adjusting your filters</p>
        </div>
      )}
    </div>
  );
};

export default GroupedTicketList;
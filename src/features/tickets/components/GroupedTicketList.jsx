import React, { useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Building2,
  User,
  Ticket,
} from "lucide-react";
import { FLAT_TEAM_MAP, TEAM_GROUPS, STAGE_MAP } from "../../../utils";

const GroupedTicketList = ({ tickets, onProfileClick, dependencies = {} }) => {
  const [expandedOwners, setExpandedOwners] = useState(new Set());
  const [sortBy, setSortBy] = useState("count"); // "count" | "name" | "urgent"

  // Get team name for an owner
  const getTeamForOwner = (ownerName) => {
    for (const [teamName, members] of Object.entries(TEAM_GROUPS)) {
      if (Object.values(members).includes(ownerName)) {
        return teamName;
      }
    }
    return null;
  };

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
          team: getTeamForOwner(ownerName),
          tickets: [],
          urgent: 0,
        };
      }

      groups[ownerName].tickets.push(t);
      if (t.priority === 1) groups[ownerName].urgent++;
    });

    // Convert to array and sort
    let sorted = Object.values(groups);

    if (sortBy === "count") {
      sorted.sort((a, b) => b.tickets.length - a.tickets.length);
    } else if (sortBy === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "urgent") {
      sorted.sort((a, b) => b.urgent - a.urgent);
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
      "bg-gradient-to-br from-indigo-500 to-purple-600",
      "bg-gradient-to-br from-emerald-500 to-teal-600",
      "bg-gradient-to-br from-amber-500 to-orange-600",
      "bg-gradient-to-br from-rose-500 to-pink-600",
      "bg-gradient-to-br from-cyan-500 to-blue-600",
      "bg-gradient-to-br from-violet-500 to-purple-600",
      "bg-gradient-to-br from-fuchsia-500 to-pink-600",
      "bg-gradient-to-br from-teal-500 to-emerald-600",
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
    <div className="space-y-3">
      {/* Header Controls */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {totalOwners}
            </span>{" "}
            owners
          </span>
          <span className="text-slate-300 dark:text-slate-600">•</span>
          <span className="flex items-center gap-1.5">
            <Ticket className="w-3.5 h-3.5" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {totalTickets}
            </span>{" "}
            tickets
          </span>
        </div>

        <div className="flex items-center gap-1">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="text-xs px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="count">Sort by Count</option>
            <option value="name">Sort by Name</option>
            <option value="urgent">Sort by Urgent</option>
          </select>

          <button
            onClick={expandAll}
            className="text-xs px-2.5 py-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400 font-medium rounded-lg transition-colors"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="text-xs px-2.5 py-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400 font-medium rounded-lg transition-colors"
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
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm"
            >
              {/* Owner Header */}
              <button
                onClick={() => toggleOwner(group.name)}
                className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                {/* Expand Icon */}
                <div className="text-slate-400">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </div>

                {/* Avatar */}
                <div
                  className={`w-9 h-9 rounded-full ${getAvatarColor(group.name)} flex items-center justify-center text-white text-xs font-bold shadow-sm`}
                >
                  {getInitials(group.name)}
                </div>

                {/* Name & Team */}
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800 dark:text-white text-sm">
                      {group.name}
                    </span>
                    {group.team && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded font-medium">
                        {group.team}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {group.tickets.length} ticket
                    {group.tickets.length !== 1 ? "s" : ""}
                    {group.urgent > 0 && (
                      <span className="text-rose-500 ml-2">
                        • {group.urgent} urgent
                      </span>
                    )}
                  </div>
                </div>

                {/* Ticket Count Badge */}
                <div className="flex items-center gap-1.5 pr-1">
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {group.tickets.length}
                  </span>
                </div>
              </button>

              {/* Tickets Table (Expandable) */}
              {isExpanded && group.tickets.length > 0 && (
                <div className="border-t border-slate-100 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50/80 dark:bg-slate-800/50 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        <th className="py-2 px-4 text-left font-semibold">
                          Ticket
                        </th>
                        <th className="py-2 px-3 text-left font-semibold">
                          Dep Team
                        </th>
                        <th className="py-2 px-3 text-left font-semibold">
                          Dep Assignee
                        </th>
                        <th className="py-2 px-3 text-left font-semibold">
                          Stage
                        </th>
                        <th className="py-2 px-3 text-right font-semibold">
                          Age
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                      {group.tickets.map((t, idx) => {
                        const ticketId = t.display_id?.replace("TKT-", "");
                        const dep = dependencies[ticketId];
                        const primary = dep?.primary;

                        return (
                          <tr
                            key={t.id || idx}
                            className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                          >
                            {/* Ticket Info */}
                            <td className="py-2.5 px-4">
                              <div className="flex items-start gap-2">
                                {/* Priority Bar */}
                                <div
                                  className={`w-1 h-10 rounded-full flex-shrink-0 ${
                                    t.priority === 1
                                      ? "bg-rose-500"
                                      : t.priority === 2
                                        ? "bg-amber-500"
                                        : "bg-emerald-500"
                                  }`}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <a
                                      href={`https://app.devrev.ai/clevertapsupport/works/${t.display_id}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                                    >
                                      {t.display_id}
                                    </a>
                                    <ExternalLink className="w-3 h-3 text-slate-400" />
                                    {t.accountName &&
                                      t.accountName !== "Unknown" && (
                                        <span className="flex items-center gap-0.5 text-[10px] text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded ml-1">
                                          <Building2 className="w-2.5 h-2.5" />
                                          <span className="max-w-[100px] truncate">
                                            {t.accountName}
                                          </span>
                                        </span>
                                      )}
                                    {t.priority === 1 && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 ml-1">
                                        Urgent
                                      </span>
                                    )}
                                  </div>
                                  <div
                                    className="text-sm text-slate-700 dark:text-slate-300 truncate max-w-[400px]"
                                    title={t.title}
                                  >
                                    {t.title}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Dep Team */}
                            <td className="py-2.5 px-3">
                              {dep?.hasDependency ? (
                                <span
                                  className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${
                                    primary?.team === "NOC"
                                      ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                                      : primary?.team === "Whatsapp"
                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                        : primary?.team === "Billing"
                                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                          : primary?.team === "Email"
                                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                  }`}
                                >
                                  {primary?.team || "Other"}
                                </span>
                              ) : (
                                <span className="text-slate-300 dark:text-slate-600">
                                  —
                                </span>
                              )}
                            </td>

                            {/* Dep Assignee */}
                            <td className="py-2.5 px-3">
                              {dep?.hasDependency && primary ? (
                                <div className="flex flex-col">
                                  <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                                    {primary.owner || "—"}
                                  </span>
                                  {primary.issueId && (
                                    <a
                                      href={`https://app.devrev.ai/clevertapsupport/works/${primary.issueId}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[10px] text-indigo-500 hover:underline font-mono"
                                    >
                                      {primary.issueId}
                                    </a>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-300 dark:text-slate-600">
                                  —
                                </span>
                              )}
                            </td>

                            {/* Stage */}
                            <td className="py-2.5 px-3">
                              <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                {STAGE_MAP[t.stage?.name]?.label ||
                                  t.stage?.name ||
                                  "—"}
                              </span>
                            </td>

                            {/* Age */}
                            <td className="py-2.5 px-3 text-right">
                              <span
                                className={`text-sm font-medium ${
                                  t.days > 15
                                    ? "text-rose-600 dark:text-rose-400"
                                    : t.days > 10
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-slate-600 dark:text-slate-400"
                                }`}
                              >
                                {t.days}d
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {groupedData.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <Ticket className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm font-medium">No tickets found</p>
          <p className="text-xs mt-1">Try adjusting your filters</p>
        </div>
      )}
    </div>
  );
};

export default GroupedTicketList;

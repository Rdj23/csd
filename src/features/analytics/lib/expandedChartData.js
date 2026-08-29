/**
 * The series behind the expanded (full-screen) metric chart.
 *
 * Extracted verbatim from a 209-line useMemo inside AnalyticsDashboard.jsx,
 * which was a single 3580-line component. Pure: same arguments in, same
 * value out. The call site keeps its original dependency array, so nothing
 * about when this recomputes has changed.
 */

import { format, eachDayOfInterval, parseISO, differenceInDays, getHours } from "date-fns";
import { FLAT_TEAM_MAP, TEAM_GROUPS } from "../../../lib/teams";
import { aggregateData } from "./aggregate";

export const buildExpandedData = ({
  expandedMetric,
  analyticsData,
  effectiveDateRange,
  expandedEffectiveDateRange,
  expandedGroupBy,
  selectedUsers,
  selectedUserTeamName,
  showTeam,
  showGST,
  HOUR_LABELS,
  tickets,
}) => {
  if (!expandedMetric) return [];

  const individualTrends = analyticsData?.individualTrends || {};
  const rangeToUse = expandedEffectiveDateRange || effectiveDateRange;
  let dailyData = [];

  // For VOLUME - use real-time tickets with created_date
  if (expandedMetric === "volume") {
    // HOURLY VIEW for multi-user comparison (raw counts)
    if (expandedGroupBy === "hourly") {
      const totalDays = Math.max(1, differenceInDays(rangeToUse.end, rangeToUse.start) + 1);

      // Filter all tickets in range
      const rangeTickets = tickets.filter((t) => {
        if (!t.created_date) return false;
        const created = parseISO(t.created_date);
        return created >= rangeToUse.start && created <= rangeToUse.end;
      });

      dailyData = HOUR_LABELS.map((label, hour) => {
        const hourTickets = rangeTickets.filter((t) => getHours(parseISO(t.created_date)) === hour);
        const dataPoint = { name: label, hour, totalDays };

        // "All" - total tickets at this hour (regardless of assignee)
        dataPoint["All Tickets"] = hourTickets.length;

        // Per-user hourly raw counts
        selectedUsers.forEach((user) => {
          const count = hourTickets.filter((t) => {
            const owner = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || t.owned_by?.[0]?.display_name || "";
            return owner === user;
          }).length;
          dataPoint[user] = count;
        });

        // Team & GST hourly raw counts
        if (showTeam || showGST) {
          if (showTeam) {
            const teamMembers = TEAM_GROUPS[selectedUserTeamName?.replace("Team ", "")]
              ? Object.values(TEAM_GROUPS[selectedUserTeamName.replace("Team ", "")])
              : [];
            dataPoint.compare_team = hourTickets.filter((t) => {
              const owner = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || "";
              return teamMembers.includes(owner);
            }).length;
          }

          if (showGST) {
            const gstMembers = Object.values(FLAT_TEAM_MAP);
            dataPoint.compare_gst = hourTickets.filter((t) => {
              const owner = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || "";
              return gstMembers.includes(owner);
            }).length;
          }
        }

        return dataPoint;
      });

      return dailyData;
    }

    const daysInterval = eachDayOfInterval({
      start: rangeToUse.start,
      end: rangeToUse.end,
    });

    dailyData = daysInterval.map((day) => {
      const dateKey = format(day, "yyyy-MM-dd");
      const dataPoint = { name: format(day, "MMM dd"), date: dateKey };

      selectedUsers.forEach((user) => {
        const userTickets = tickets.filter((t) => {
          if (!t.created_date) return false;
          const ticketDate = format(parseISO(t.created_date), "yyyy-MM-dd");
          const owner =
            FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] ||
            t.owned_by?.[0]?.display_name ||
            "";
          return ticketDate === dateKey && owner === user;
        });
        dataPoint[user] = userTickets.length;
      });

      // Team & GST totals for volume
      if (showTeam || showGST) {
        const dayTickets = tickets.filter((t) => {
          if (!t.created_date) return false;
          return format(parseISO(t.created_date), "yyyy-MM-dd") === dateKey;
        });

        if (showTeam) {
          const teamMembers = TEAM_GROUPS[
            selectedUserTeamName?.replace("Team ", "")
          ]
            ? Object.values(
                TEAM_GROUPS[selectedUserTeamName.replace("Team ", "")],
              )
            : [];
          dataPoint.compare_team = dayTickets.filter((t) => {
            const owner = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || "";
            return teamMembers.includes(owner);
          }).length;
        }

        if (showGST) {
          const gstMembers = Object.values(FLAT_TEAM_MAP);
          dataPoint.compare_gst = dayTickets.filter((t) => {
            const owner = FLAT_TEAM_MAP[t.owned_by?.[0]?.display_id] || "";
            return gstMembers.includes(owner);
          }).length;
        }
      }

      return dataPoint;
    });
  } else {
    // For SOLVED, RWT, BACKLOG, etc. - use server individualTrends
    const allDates = new Set();
    selectedUsers.forEach((user) => {
      (individualTrends[user] || []).forEach((d) => allDates.add(d.date));
    });

    // Filter dates to be within effectiveDateRange
    const sortedDates = Array.from(allDates)
      .sort()
      .filter((date) => {
        const d = parseISO(date);
        return d >= rangeToUse.start && d <= rangeToUse.end;
      });

    dailyData = sortedDates.map((date) => {
      const dataPoint = { name: format(parseISO(date), "MMM dd"), date };

      selectedUsers.forEach((user) => {
        const userDay = (individualTrends[user] || []).find(
          (d) => d.date === date,
        );
        if (expandedMetric === "solved") {
          dataPoint[user] = userDay?.solved || 0;
        } else if (expandedMetric === "rwt" || expandedMetric === "avgRWT") {
          dataPoint[user] = userDay?.avgRWT
            ? Number(userDay.avgRWT.toFixed(2))
            : 0;
        } else if (expandedMetric === "backlog") {
          dataPoint[user] = userDay?.backlogCleared || 0;
        } else if (expandedMetric === "frrPercent") {
          dataPoint[user] = userDay?.frrPercent || 0;
        } else if (expandedMetric === "csat") {
          dataPoint[user] = userDay?.positiveCSAT || 0;
        } else if (expandedMetric === "avgFRT") {
          dataPoint[user] = userDay?.avgFRT
            ? Number(userDay.avgFRT.toFixed(2))
            : 0;
        } else if (expandedMetric === "avgIterations") {
          dataPoint[user] = userDay?.avgIterations
            ? Number(userDay.avgIterations.toFixed(1))
            : 0;
        }
      });

      // Team & GST totals
      if (showTeam || showGST) {
        let teamTotal = 0,
          gstTotal = 0;
        const teamMembers = TEAM_GROUPS[
          selectedUserTeamName?.replace("Team ", "")
        ]
          ? Object.values(
              TEAM_GROUPS[selectedUserTeamName.replace("Team ", "")],
            )
          : [];

        Object.entries(individualTrends).forEach(([user, days]) => {
          const dayData = days.find((d) => d.date === date);
          if (dayData) {
            const val =
              expandedMetric === "solved"
                ? dayData.solved
                : expandedMetric === "rwt" || expandedMetric === "avgRWT"
                  ? dayData.avgRWT
                  : expandedMetric === "backlog"
                    ? dayData.backlogCleared
                    : expandedMetric === "frrPercent"
                      ? dayData.frrPercent
                      : expandedMetric === "csat"
                        ? dayData.positiveCSAT
                        : expandedMetric === "avgFRT"
                          ? dayData.avgFRT
                          : expandedMetric === "avgIterations"
                            ? dayData.avgIterations
                            : 0;
            gstTotal += val || 0;
            if (teamMembers.includes(user)) {
              teamTotal += val || 0;
            }
          }
        });

        if (showTeam) dataPoint.compare_team = teamTotal;
        if (showGST) dataPoint.compare_gst = gstTotal;
      }

      return dataPoint;
    });
  }

  // Apply weekly/monthly grouping
  return aggregateData(dailyData, expandedGroupBy, expandedMetric, selectedUsers);
};

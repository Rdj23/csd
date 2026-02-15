import { useState, useEffect } from "react";
import { fetchBackupInfo, fetchProfileStatus } from "../api/rosterApi";

/**
 * Custom hook for profile stats and backup info fetching.
 * Extracted from ProfileStatsModal.jsx — preserves identical logic.
 */
export const useProfileStats = (user, solvedTickets = []) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [backup, setBackup] = useState(null);
  const [backupData, setBackupData] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // 1. Fetch backup from improved endpoint
        const backupRes = await fetchBackupInfo(user.name, true);
        setBackup(backupRes.backup);
        setBackupData(backupRes);

        const { needsBackup, userStatus, backup: backupInfo } = backupRes;

        let aiSummary = "";
        let isActive = false;
        let status = "Away";
        let timings = "";

        if (needsBackup === false && userStatus?.isAvailable) {
          isActive = true;
          status = "On Shift";
          timings = userStatus.shift || "";
          const urgentCount = userStatus.urgentTickets || 0;
          aiSummary = urgentCount > 0
            ? `${user.name} is working. ${urgentCount} urgent ticket${urgentCount !== 1 ? "s" : ""}.`
            : `${user.name} is working.`;
        } else if (needsBackup === true) {
          isActive = false;
          status = userStatus?.reason || "Away";
          timings = userStatus?.shift || "";

          const formatStatus = (s) => {
            if (!s) return "away";
            const lower = s.toLowerCase();
            if (lower.includes("week off") || lower.includes("leave") || lower.includes("holiday") || lower.includes("comp off")) {
              return `on ${s}`;
            }
            return lower;
          };

          if (backupInfo) {
            aiSummary = `${user.name} is ${formatStatus(status)}. Best backup: ${backupInfo.name} (${backupInfo.role}).`;
          } else {
            aiSummary = `${user.name} is ${formatStatus(status)}. No backup available.`;
          }
        } else {
          // Fallback for old API response or errors
          const statusRes = await fetchProfileStatus(user.name);
          isActive = statusRes.isActive;
          status = statusRes.status;
          timings = statusRes.shift;
          aiSummary = isActive
            ? `${user.name} is on shift.`
            : `${user.name} is off duty today.`;
        }

        setData({ isActive, status, timings, aiSummary });
      } catch (err) {
        console.error("Failed to load profile info", err);
        setData({ isActive: false, status: "Unknown" });
      } finally {
        setLoading(false);
      }
    };

    if (user) fetchData();
  }, [user, solvedTickets]);

  return { data, loading, backup, backupData };
};

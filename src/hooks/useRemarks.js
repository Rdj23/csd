import { useState, useEffect } from "react";
import { fetchUsers as apiFetchUsers, fetchRemarkHistory } from "../api/remarkApi";

/**
 * Custom hook for remark/comment data fetching.
 * Extracted from RemarkPopover.jsx — preserves identical logic.
 */
export const useRemarks = (ticketDisplayId) => {
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [users, setUsers] = useState([]);

  // Fetch users for mentions
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const rawUsersRes = await apiFetchUsers();
        // getUsers returns raw array; guard against unexpected wrapper objects
        const rawUsers = Array.isArray(rawUsersRes) ? rawUsersRes : rawUsersRes?.data || [];
        const formattedUsers = rawUsers.map((u) => ({
          name: u.full_name || u.display_name || "Unknown User",
          id: u.id,
          email: u.email,
        }));
        setUsers(formattedUsers);
      } catch (err) {
        // silently ignore
      }
    };
    fetchUsers();
  }, []);

  // Fetch remark history
  useEffect(() => {
    const fetchHistory = async () => {
      if (!ticketDisplayId) return;
      setLoadingHistory(true);
      try {
        const rawHistoryRes = await fetchRemarkHistory(ticketDisplayId);
        // ok() wraps arrays as { success: true, data: [...] }
        const rawHistory = Array.isArray(rawHistoryRes) ? rawHistoryRes : rawHistoryRes?.data || [];
        const adaptedHistory = rawHistory.map((item) => ({
          id: item.id,
          body: item.text,
          created_date: item.timestamp,
          created_by: {
            display_name: item.user,
            id: "local",
          },
        }));
        setHistory(adaptedHistory);
      } catch (err) {
        // silently ignore
      } finally {
        setLoadingHistory(false);
      }
    };
    fetchHistory();
  }, [ticketDisplayId]);

  return { history, setHistory, loadingHistory, users };
};

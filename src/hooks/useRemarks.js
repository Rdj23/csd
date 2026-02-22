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
        const rawUsers = await apiFetchUsers();
        const formattedUsers = rawUsers.map((u) => ({
          name: u.full_name || u.display_name || "Unknown User",
          id: u.id,
          email: u.email,
        }));
        setUsers(formattedUsers);
      } catch (err) {
        console.error("Failed to load users for tagging:", err);
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
        const rawHistory = await fetchRemarkHistory(ticketDisplayId);
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
        console.error("Failed to load local remarks:", err);
      } finally {
        setLoadingHistory(false);
      }
    };
    fetchHistory();
  }, [ticketDisplayId]);

  return { history, setHistory, loadingHistory, users };
};

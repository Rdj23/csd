import { useState, useEffect, useMemo } from "react";
import { fetchLeaderboard, fetchMyStats } from "../api/gamificationApi";
import { EMAIL_TO_NAME_MAP } from "../lib/teams";

/**
 * Custom hook for gamification data fetching.
 * Extracted from GamificationView.jsx — preserves identical logic.
 */
export const useGamification = ({ quarter, currentUser, isAdmin }) => {
  const [data, setData] = useState(null);
  const [myStatsData, setMyStatsData] = useState(null);
  // Weights the backend scored this window with — versioned by quarter, so
  // the UI labels must come from the response, not hardcoded percentages.
  const [weights, setWeights] = useState(null);
  const [loading, setLoading] = useState(true);

  const currentUserName = useMemo(() => {
    if (!currentUser?.email) return null;
    return EMAIL_TO_NAME_MAP[currentUser.email.toLowerCase()] || null;
  }, [currentUser]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (isAdmin) {
        const res = await fetchLeaderboard(quarter);
        setData(res);
        setWeights(res?.weights || null);
      } else {
        const res = await fetchMyStats(quarter, currentUser?.email || "");
        setMyStatsData(res.userData);
        setWeights(res?.weights || null);
      }
    } catch (e) {
      // silently ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [quarter, isAdmin, currentUser?.email]);

  const currentUserData = useMemo(() => {
    if (!isAdmin && myStatsData) {
      return myStatsData;
    }
    if (!currentUserName || !data) return null;
    return [...(data?.data?.L1 || []), ...(data?.data?.L2 || [])].find(
      (eng) => eng.name === currentUserName
    );
  }, [currentUserName, data, isAdmin, myStatsData]);

  return { data, myStatsData, weights, loading, currentUserName, currentUserData, fetchData };
};

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { io } from "socket.io-client";
import { trackEvent } from "./utils/clevertap";

const getApiUrl = () => import.meta.env.VITE_API_URL;

export const useTicketStore = create(
  persist(
    (set, get) => ({
      // Active tickets (open/pending)
      tickets: [],
      isLoading: false,
      
      // ✅ NEW: Pre-aggregated analytics data from server
      analyticsData: null, // { stats, trends, leaderboard, badTickets, individualTrends }
      analyticsLoading: false,
      
      socket: null,
      lastSyncTime: null,
      myViews: [],
      currentUser: null,
      isAuthenticated: false,
      token: null,
      theme: "dark",

      // Socket connection
      connectSocket: () => {
        const { socket } = get();
        if (socket) return;

        const API_URL = getApiUrl();
        const newSocket = io(API_URL);

        newSocket.on("connect", () => console.log("🟢 Connected to Real-Time Server"));
        newSocket.on("REFRESH_TICKETS", (updatedTickets) => {
          console.log("📥 Live Update Received!");
          set({ tickets: updatedTickets, lastSync: new Date() });
        });

        set({ socket: newSocket });
      },

      // Auth
      loginUser: (user) => set({ currentUser: user, isAuthenticated: true }),
      logout: () => {
        set({ currentUser: null, isAuthenticated: false, tickets: [], myViews: [], analyticsData: null });
        localStorage.removeItem("ticket-store");
      },

      toggleTheme: () => set((state) => ({ theme: state.theme === "light" ? "dark" : "light" })),
      setCurrentUser: (user) => set({ currentUser: user }),

      loginWithGoogle: async (credentialResponse) => {
        try {
          const API_URL = getApiUrl();
          const res = await fetch(`${API_URL}/api/auth/google`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ credential: credentialResponse.credential }),
          });

          const data = await res.json();

          if (res.ok && data.user) {
            set({ currentUser: data.user, isAuthenticated: true, token: data.token || null });
            return true;
          } else {
            alert(data.error || "Login failed");
            return false;
          }
        } catch (e) {
          console.error("Login error", e);
          return false;
        }
      },

      // ============================================================================
      // VIEWS
      // ============================================================================
      fetchViews: async () => {
        const { currentUser } = get();
        if (!currentUser?.email) return;
        try {
          const API_URL = getApiUrl();
          const res = await fetch(`${API_URL}/api/views/${encodeURIComponent(currentUser.email)}`);
          set({ myViews: await res.json() });
        } catch (e) {
          console.error("Failed to fetch views", e);
        }
      },

      saveView: async (name, currentFilters) => {
        const { currentUser, myViews } = get();
        if (!currentUser?.email) return false;
        try {
          const API_URL = getApiUrl();
          const res = await fetch(`${API_URL}/api/views`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: currentUser.email, name, filters: currentFilters })
          });
          const data = await res.json();
          if (data.success) {
            set({ myViews: [data.view, ...myViews] });
            return true;
          }
        } catch (e) {
          console.error("Failed to save view", e);
        }
        return false;
      },

      deleteView: async (viewId) => {
        const { currentUser, myViews } = get();
        if (!currentUser?.email) return;
        try {
          const API_URL = getApiUrl();
          await fetch(`${API_URL}/api/views/${encodeURIComponent(currentUser.email)}/${viewId}`, { method: "DELETE" });
          set({ myViews: myViews.filter(v => v._id !== viewId) });
        } catch (e) {
          console.error("Failed to delete view", e);
        }
      },

      // ============================================================================
      // ACTIVE TICKETS (Open/Pending/On-Hold for Dashboard)
      // ============================================================================
      fetchTickets: async () => {
        set({ isLoading: true });
        try {
          const API_URL = getApiUrl();
          const response = await fetch(`${API_URL}/api/tickets`);
          const data = await response.json();
          set({ tickets: data.tickets || [], lastSync: new Date(), isLoading: false });
        } catch (error) {
          console.error("Sync failed:", error);
          set({ isLoading: false });
        }
      },

      // ============================================================================
      // ✅ ANALYTICS (Pre-aggregated from server - NO memory issues!)
      // ============================================================================
      fetchAnalyticsData: async (filters = {}) => {
        set({ analyticsLoading: true });
        try {
          const API_URL = getApiUrl();
          const params = new URLSearchParams();
          
          if (filters.quarter) params.append('quarter', filters.quarter);
          if (filters.excludeZendesk) params.append('excludeZendesk', 'true');
          if (filters.owner) params.append('owner', filters.owner);
          if (filters.forceRefresh) params.append('forceRefresh', 'true');

          const url = `${API_URL}/api/tickets/analytics?${params.toString()}`;
          console.log("📊 [Store] Fetching analytics:", url);

          const res = await fetch(url);
          const data = await res.json();

          console.log("📊 [Store] Analytics received:", {
            tickets: data.stats?.totalTickets,
            trends: data.trends?.length,
            leaderboard: data.leaderboard?.length
          });

          set({ analyticsData: data, analyticsLoading: false });
          return data;
        } catch (error) {
          console.error("Analytics fetch failed:", error);
          set({ analyticsLoading: false });
          return null;
        }
      },

      // Clear analytics cache (force refresh)
      refreshAnalytics: async (filters = {}) => {
        return get().fetchAnalyticsData({ ...filters, forceRefresh: true });
      },

      // ============================================================================
      // TICKET TIMELINE & COMMENTS
      // ============================================================================
      fetchTicketTimeline: async (ticketId) => {
        try {
          const API_URL = getApiUrl();
          const response = await fetch(`${API_URL}/timeline?ticket_id=${encodeURIComponent(ticketId)}`);
          if (!response.ok) return [];
          return await response.json() || [];
        } catch (error) {
          console.error("Failed to fetch timeline:", error);
          return [];
        }
      },

      postTicketComment: async (internalId, displayId, text) => {
        const { currentUser } = get();
        const API_URL = getApiUrl();

        try {
          // Local sync
          await fetch(`${API_URL}/api/remarks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticketId: displayId,
              user: currentUser?.name || "Support Engineer",
              text,
            }),
          });

          // DevRev sync
          const response = await fetch(`${API_URL}/api/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticketId: internalId, body: text }),
          });

          if (!response.ok) throw new Error("DevRev Sync Failed");

          trackEvent("Comment Added", { "Ticket ID": displayId, "Comment Length": text.length });
        } catch (err) {
          console.error("❌ Post failed:", err);
          throw err;
        }
      },
    }),
    {
      name: "support-dashboard-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        currentUser: s.currentUser,
        theme: s.theme,
        isAuthenticated: s.isAuthenticated,
        token: s.token,
      }),
    }
  )
);
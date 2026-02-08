import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { io } from "socket.io-client";
import { trackEvent } from "./utils/clevertap";

const getApiUrl = () => import.meta.env.VITE_API_URL;

// Authenticated fetch — injects Bearer token, auto-logout on 401
// Defined as a lazy ref so it can access the store after creation
let _storeRef = null;
const _authFetch = async (url, options = {}) => {
  const state = _storeRef?.getState?.();
  const headers = { ...options.headers };
  if (state?.token) {
    headers["Authorization"] = `Bearer ${state.token}`;
  }
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    console.warn("[Auth] 401 received — session expired, logging out");
    state?.logout?.();
  }
  return response;
};

export const useTicketStore = create(
  persist(
    (set, get) => ({
      // Active tickets (open/pending)
      tickets: [],
      isLoading: false,
      isPartialData: false, // ✅ NEW: Track if we're showing partial data
      syncProgress: 0, // ✅ NEW: Track sync progress (0-100)

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
      dependencies: {},
      dependenciesLoading: false,

      // ✅ OPTIMIZED: Socket connection with lightweight updates
      connectSocket: () => {
        const { socket } = get();
        if (socket) return;

        const API_URL = getApiUrl();
        const newSocket = io(API_URL);

        newSocket.on("connect", () => console.log("🟢 Connected to Real-Time Server"));

        // ✅ PROGRESSIVE LOADING: Listen for sync progress updates
        newSocket.on("SYNC_PROGRESS", (progressData) => {
          console.log("📊 Sync Progress:", progressData);
          set({
            syncProgress: progressData.progress,
            isPartialData: progressData.status === 'loading'
          });

          // When sync is complete, re-fetch to get all data
          if (progressData.status === 'complete') {
            get().fetchTickets();
          }
        });

        // ✅ NEW: Lightweight signal-based updates (no data transfer)
        newSocket.on("DATA_UPDATED", (signal) => {
          console.log("📥 Live Update Signal Received:", signal);
          // Re-fetch tickets when data changes (much smaller payload)
          get().fetchTickets();
        });

        // ✅ DEPRECATED: Old REFRESH_TICKETS event (kept for backward compatibility)
        newSocket.on("REFRESH_TICKETS", (updatedTickets) => {
          console.log("📥 Legacy Update Received (deprecated)");
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
          const res = await _authFetch(`${API_URL}/api/views/${encodeURIComponent(currentUser.email)}`);
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
          const res = await _authFetch(`${API_URL}/api/views`, {
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
          await _authFetch(`${API_URL}/api/views/${encodeURIComponent(currentUser.email)}/${viewId}`, { method: "DELETE" });
          set({ myViews: myViews.filter(v => v._id !== viewId) });
        } catch (e) {
          console.error("Failed to delete view", e);
        }
      },

      // ============================================================================
      // ✅ PROGRESSIVE LOADING: Fetch tickets with partial data support
      // ============================================================================
      _retryCount: 0, // Track retry attempts to prevent infinite loops
      _maxRetries: 3, // Maximum retry attempts

      fetchTickets: async () => {
        const state = get();

        // Prevent multiple concurrent fetches
        if (state.isLoading) {
          console.log("⏭️ Fetch already in progress, skipping");
          return;
        }

        set({ isLoading: true });
        try {
          const API_URL = getApiUrl();
          const response = await _authFetch(`${API_URL}/api/tickets`);
          const data = await response.json();

          const hasTickets = data.tickets && data.tickets.length > 0;

          set({
            tickets: data.tickets || [],
            lastSync: new Date(),
            isLoading: false,
            isPartialData: data.isPartial || false,
            syncProgress: data.isPartial ? 30 : 100,
            _retryCount: hasTickets && !data.isPartial ? 0 : state._retryCount, // Reset on success
          });

          console.log(`📦 Loaded ${data.tickets?.length || 0} tickets (${data.isPartial ? 'partial' : 'complete'})`);

          // Only retry if partial and under max retries
          if ((!hasTickets || data.isPartial) && state._retryCount < state._maxRetries) {
            const nextRetryCount = state._retryCount + 1;
            const retryDelay = 3000 * nextRetryCount; // Exponential backoff
            console.log(`⏳ Data loading... retry ${nextRetryCount}/${state._maxRetries} in ${retryDelay/1000}s`);

            set({ _retryCount: nextRetryCount });
            setTimeout(() => {
              const currentState = get();
              if ((currentState.tickets.length === 0 || currentState.isPartialData)
                  && currentState._retryCount < currentState._maxRetries) {
                get().fetchTickets();
              }
            }, retryDelay);
          }
        } catch (error) {
          console.error("Sync failed:", error);
          const currentRetryCount = get()._retryCount;
          set({ isLoading: false, isPartialData: false });

          // Retry on error with exponential backoff, but respect max retries
          if (currentRetryCount < get()._maxRetries) {
            const retryDelay = 5000 * (currentRetryCount + 1);
            console.log(`⏳ Retrying after error... attempt ${currentRetryCount + 1}/${get()._maxRetries}`);
            set({ _retryCount: currentRetryCount + 1 });
            setTimeout(() => {
              if (get().tickets.length === 0 && get()._retryCount < get()._maxRetries) {
                get().fetchTickets();
              }
            }, retryDelay);
          }
        }
      },

      // ============================================================================
      // ✅ ANALYTICS (Pre-aggregated from server - NO memory issues!)
 // ============================================================================
// STORE.JS CHANGES
// ============================================================================

// In fetchAnalyticsData function (around line 130-150), update to include groupBy:

// Add this function to store.js:
fetchDependencies: async (ticketIds) => {
  if (!ticketIds.length) return;
  
  set({ dependenciesLoading: true });
  try {
    const API_URL = getApiUrl();
    const res = await _authFetch(`${API_URL}/api/tickets/dependencies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketIds }),
    });
    const data = await res.json();
    
    set((state) => ({
      dependencies: { ...state.dependencies, ...data },
      dependenciesLoading: false,
    }));
    
    return data;
  } catch (e) {
    console.error("Dependencies fetch failed:", e);
    set({ dependenciesLoading: false });
    return {};
  }
},

fetchAnalyticsData: async (filters = {}) => {
  set({ analyticsLoading: true });
  try {
    const API_URL = getApiUrl();
    const params = new URLSearchParams();
    
    if (filters.quarter) params.append('quarter', filters.quarter);
    if (filters.excludeZendesk) params.append('excludeZendesk', 'true');
    if (filters.excludeNOC) params.set("excludeNOC", "true");
    if (filters.owner) params.append('owner', filters.owner);
    if (filters.forceRefresh) params.append('forceRefresh', 'true');
    if (filters.groupBy) params.append('groupBy', filters.groupBy); // ADD THIS LINE

    const url = `${API_URL}/api/tickets/analytics?${params.toString()}`;
    console.log("📊 [Store] Fetching analytics:", url);

    const res = await _authFetch(url);
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
          const response = await _authFetch(`${API_URL}/timeline?ticket_id=${encodeURIComponent(ticketId)}`);
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
          await _authFetch(`${API_URL}/api/remarks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticketId: displayId,
              user: currentUser?.name || "Support Engineer",
              text,
            }),
          });

          // DevRev sync
          const response = await _authFetch(`${API_URL}/api/comments`, {
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
        dependencies: s.dependencies, 
      }),
    }
  )
);

// Wire up the lazy store ref for _authFetch
_storeRef = useTicketStore;
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { io } from "socket.io-client";
import { trackEvent } from "./utils/clevertap";

const getApiUrl = () => import.meta.env.VITE_API_URL;

// Authenticated fetch — injects Bearer token, auto-logout on 401
// Defined as a lazy ref so it can access the store after creation
let _storeRef = null;
const _authFetch = async (url, options = {}, _retries = 0) => {
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
  // Auto-retry on 429 with exponential backoff (max 2 retries)
  if (response.status === 429 && _retries < 2) {
    const retryAfter = response.headers.get("Retry-After");
    const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.min(2000 * 2 ** _retries, 10000);
    console.warn(`[Auth] 429 rate-limited — retrying in ${delay}ms (attempt ${_retries + 1})`);
    await new Promise((r) => setTimeout(r, delay));
    return _authFetch(url, options, _retries + 1);
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

      // ✅ Socket connection — drives all real-time updates
      connectSocket: () => {
        const { socket } = get();
        if (socket) return;

        const API_URL = getApiUrl();
        const newSocket = io(API_URL);

        newSocket.on("connect", () => console.log("[Socket] Connected"));

        // Progress updates during background sync
        // Only updates the progress indicator — does NOT trigger a fetch on every tick.
        // Fetches only when new chunks land (count increased) so tickets accumulate.
        newSocket.on("SYNC_PROGRESS", (progressData) => {
          const prev = get();
          set({ syncProgress: progressData.progress });

          if (progressData.status === "complete") {
            // Sync finished — authoritative fetch for the promoted stable data
            set({ isPartialData: false, syncProgress: 100 });
            get().fetchTickets();
          } else if (progressData.count > (prev.tickets?.length || 0)) {
            // New chunk saved — fetch to merge the larger dataset
            set({ isPartialData: true });
            get().fetchTickets();
          }
        });

        // Final signal after sync completion (webhook / manual / cron)
        newSocket.on("DATA_UPDATED", () => {
          get().fetchTickets();
        });

        // Legacy compat
        newSocket.on("REFRESH_TICKETS", (updatedTickets) => {
          if (Array.isArray(updatedTickets) && updatedTickets.length > 0) {
            set({ tickets: updatedTickets, lastSync: new Date() });
          }
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
          const viewsData = await res.json();
          set({ myViews: viewsData.data || viewsData || [] });
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
          if (!res.ok) {
            try {
              const errData = await res.json();
              console.error("Failed to save view:", errData.error?.message || res.status);
            } catch {
              console.error("Failed to save view: HTTP", res.status);
            }
            return false;
          }
          const data = await res.json();
          if (data.success) {
            set({ myViews: [data.view, ...myViews] });
            return true;
          }
          // If API responded but without success flag, still try to add the view
          if (data.view || data._id) {
            set({ myViews: [data.view || data, ...myViews] });
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
      // TICKET FETCH — merge-based, socket-driven, never wipes data
      // ============================================================================

      _lastFetchTime: 0,
      _coldStartTimer: null,

      fetchTickets: async () => {
        const now = Date.now();
        const prev = get();

        // Debounce: 2 s between fetches, but allow override if stuck > 15 s
        if (prev.isLoading) {
          if (now - prev._lastFetchTime < 15000) return;
          console.warn("[Fetch] Previous fetch stuck >15 s — forcing new fetch");
        }

        set({ isLoading: true, _lastFetchTime: now });

        try {
          const API_URL = getApiUrl();
          const response = await _authFetch(`${API_URL}/api/tickets`);
          const data = await response.json();

          const incoming = data.tickets || [];
          const isPartial = data.isPartial || false;
          const isSyncing = data.isSyncing || isPartial;
          const existing = get().tickets;

          // ── Merge logic ──
          // 1. Complete (stable) data  → authoritative replace
          // 2. Partial with more data  → take the larger set (accumulate)
          // 3. Partial but empty/fewer → keep what we already have
          let merged;
          if (!isPartial) {
            // Stable snapshot from tickets:active — trust it fully
            merged = incoming;
          } else if (incoming.length === 0 && existing.length > 0) {
            // Cache gap — keep existing in-memory tickets
            merged = existing;
          } else if (incoming.length > 0) {
            // Merge by ID: add new, update existing, never remove during sync
            const map = new Map(existing.map((t) => [t.id, t]));
            for (const t of incoming) map.set(t.id, t);
            merged = Array.from(map.values());
          } else {
            merged = existing;
          }

          const currentProgress = get().syncProgress;

          set({
            tickets: merged,
            lastSync: new Date(),
            isLoading: false,
            isPartialData: isPartial,
            syncProgress: isPartial ? Math.max(currentProgress, 20) : 100,
          });

          console.log(
            `[Fetch] ${merged.length} tickets (${isPartial ? "partial" : "complete"})` +
            `${isSyncing ? " — bg sync running" : ""}`
          );

          // Cold-start fallback: if we still have zero tickets and data is
          // partial, poll once after 3 s in case socket events are delayed.
          const prevTimer = get()._coldStartTimer;
          if (prevTimer) clearTimeout(prevTimer);

          if (isPartial && merged.length === 0) {
            const timer = setTimeout(() => {
              if (get().isPartialData && get().tickets.length === 0) {
                console.log("[Fetch] Cold-start retry…");
                get().fetchTickets();
              }
            }, 3000);
            set({ _coldStartTimer: timer });
          } else {
            set({ _coldStartTimer: null });
          }
        } catch (error) {
          console.error("[Fetch] Failed:", error);
          set({ isLoading: false });

          // Retry once after 5 s if we have nothing
          setTimeout(() => {
            if (get().tickets.length === 0) get().fetchTickets();
          }, 5000);
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
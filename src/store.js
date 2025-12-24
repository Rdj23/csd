import { create } from "zustand";
import { persist } from "zustand/middleware";

// --- CONFIG: Universal API URL ---
const getApiUrl = () => import.meta.env.VITE_API_URL 



export const useTicketStore = create(
  persist(
    (set, get) => ({
      tickets: [],
      isLoading: false,
      lastSync: null,

      // --- AUTH STATE ---
      currentUser: null,
      isAuthenticated: false,
      token: null,
      theme: "light",

      

      toggleTheme: () =>
        set((state) => ({ theme: state.theme === "light" ? "dark" : "light" })),

      setCurrentUser: (user) => set({ currentUser: user }),

      // --- LOGIN ACTIONS ---
      loginWithGoogle: async (credentialResponse) => {
        try {
          const API_URL = getApiUrl();
          const res = await fetch(`${API_URL}/api/auth/google`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: credentialResponse.credential }),
          });

          const data = await res.json();

          if (res.ok && data.success) {
            set({
              currentUser: data.user,
              isAuthenticated: true,
              token: data.token || null,
            });
            return true;
          } else {
            alert(data.error || "Login failed");
            return false;
          }
        } catch (e) {
          console.error("Login error", e);
          alert("Server error during login");
          return false;
        }
      },

      logout: () =>
        set({ currentUser: null, isAuthenticated: false, token: null }),

  // --- DATA ACTIONS ---
      fetchTickets: async () => {
        set({ isLoading: true });
        try {
          const API_URL = getApiUrl();
          const response = await fetch(`${API_URL}/api/tickets`);
          const data = await response.json();
          set({
            tickets: data.tickets || [],
            lastSync: new Date(),
            isLoading: false,
          });
        } catch (error) {
          console.error("Sync failed:", error);
          set({ isLoading: false });
        }
      },

            fetchTicketTimeline: async (ticketId) => {
        try {
          const API_URL = getApiUrl();
          const response = await fetch(
            `${API_URL}/timeline?ticket_id=${encodeURIComponent(ticketId)}`
          );
          if (!response.ok) return [];
          const data = await response.json();
          return data || [];
        } catch (error) {
          console.error("Failed to fetch timeline:", error);
          return [];
        }
      },

      postTicketComment: async (ticketId, text) => {
        const { currentUser, token } = get();
        const API_URL = getApiUrl();

        try {
          const response = await fetch(`${API_URL}/api/comments`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              ticketId,
              body: text,
              authorId: currentUser?.id,
            }),
          });

          if (!response.ok) {
            const errorData = await response.text();
            throw new Error(errorData || "Server Error");
          }

          console.log("✅ Comment posted successfully");
        } catch (err) {
          console.error("❌ Failed to post comment:", err);
          alert(`Failed to post: ${err.message}`);
        }
      },
    }),
    {
      name: "support-dashboard-storage",
      partialize: (s) => ({
        currentUser: s.currentUser,
        theme: s.theme,
        isAuthenticated: s.isAuthenticated,
        token: s.token,
      }),
    }
  )
);
import { create } from "zustand";
import { persist } from "zustand/middleware";

// --- CONFIG: Universal API URL ---
// 1. In PROD: Set VITE_API_URL in your hosting dashboard (Vercel/Netlify)
// 2. In LOCAL: It defaults to "http://localhost:5000" automatically
const getApiUrl = () => import.meta.env.VITE_API_URL || "http://localhost:5000";

const extractTag = (ticket, tagName) => {
  const tag = ticket.tags?.find((t) => t.tag.name === tagName);
  return tag ? tag.value : null;
};

// --- USER MAPPING ---
const USER_MAP = {
  Rohan: "DEVU-1111",
  Archie: "DEVU-1114",
  Neha: "DEVU-1072",
  Shreya: "DEVU-1115",
  Vaibhav: "DEVU-1122",
  Adarsh: "DEVU-1076",
  Abhishek: "DEVU-1108",
  Debashish: "DEVU-1102",
  Tuaha: "DEVU-1123",
  Anmol: "DEVU-1",
  Ruben: "DEVU-1085",
};

const findUserIdByName = (name) => USER_MAP[name];

export const useTicketStore = create(
  persist(
    (set, get) => ({
      tickets: [],
      isLoading: false,
      lastSync: null,

      // --- AUTH STATE ---
      currentUser: null,
      isAuthenticated: false,
      // If you store the token separately, add it here. 
      // If it's inside currentUser, we'll access it there.
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
            // Save user AND token if your backend sends one
            set({ 
                currentUser: data.user, 
                isAuthenticated: true, 
                token: data.token || null 
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

      logout: () => set({ currentUser: null, isAuthenticated: false, token: null }),

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

        // 1. Tagging Logic
        const parsedBody = text.replace(/@(\w+)/g, (match, name) => {
          const userId = findUserIdByName(name);
          if (userId) {
            const systemId = userId.toLowerCase().replace("-", "/");
            return `[@${name}](don:identity:dvrv-us-1:devo/1iVu4ClfVV:${systemId})`;
          }
          return match;
        });

        try {
          // 2. Updated Fetch with Fallback URL
          const response = await fetch(`${API_URL}/api/comments`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // 🟢 SAFE AUTH: Only add the header if 'token' actually exists
              ...(token ? { 'Authorization': `Bearer ${token}` } : {}) 
            },
            body: JSON.stringify({
              ticketId: ticketId,
              body: parsedBody,
              authorId: currentUser?.id,
            }),
          });

          if (!response.ok) {
            const errorData = await response.text();
            throw new Error(errorData || "Server Error");
          }

          console.log("Comment posted successfully");
          // Optional: You might want to call get().fetchTickets() here to refresh data
          
        } catch (err) {
          console.error("Failed to post comment:", err);
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
        token: s.token, // Persist token so refresh doesn't log you out
      }),
    }
  )
);
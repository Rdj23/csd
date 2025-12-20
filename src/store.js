import { create } from "zustand";
import { persist } from "zustand/middleware";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const extractTag = (ticket, tagName) => {
  const tag = ticket.tags?.find((t) => t.tag.name === tagName);
  return tag ? tag.value : null;
};

// --- USER MAPPING ---
// Map Display Name to User ID for mentioning and signature
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
  Ruben: "DEVU-1085", // Added Ruben
};

const findUserIdByName = (name) => USER_MAP[name];

export const useTicketStore = create(
  persist(
    (set, get) => ({
      tickets: [],
      isLoading: false,
      lastSync: null,

      // --- AUTH STATE ---
      currentUser: null, // Start as null to trigger Login Screen
      isAuthenticated: false,
      theme: "light",

      toggleTheme: () =>
        set((state) => ({ theme: state.theme === "light" ? "dark" : "light" })),

      setCurrentUser: (user) => set({ currentUser: user }),

      // --- LOGIN ACTIONS ---
      loginWithGoogle: async (credentialResponse) => {
        try {
          const res = await fetch(`${API_URL}api/auth/google`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: credentialResponse.credential }),
          });

          const data = await res.json();

          if (res.ok && data.success) {
            set({ currentUser: data.user, isAuthenticated: true });
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

      logout: () => set({ currentUser: null, isAuthenticated: false }),

      // --- DATA ACTIONS ---
      fetchTickets: async () => {
        set({ isLoading: true });
        try {
          const API_BASE = import.meta.env.VITE_API_URL || "";
          const response = await fetch(`${API_BASE}/api/tickets`);
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
        const { currentUser } = get();

        // 1. Tagging Logic
        const parsedBody = text.replace(/@(\w+)/g, (match, name) => {
          const userId = findUserIdByName(name);
          if (userId) {
            const systemId = userId.toLowerCase().replace("-", "/");
            return `[@${name}](don:identity:dvrv-us-1:devo/1iVu4ClfVV:${systemId})`;
          }
          return match;
        });

        // 2. Author Signature Logic
        // We assume currentUser is populated from the Google Login
        const authorName = currentUser?.name || "Support User";
        const authorId = findUserIdByName(authorName);
        let signature = "";

        if (authorId) {
          const systemId = authorId.toLowerCase().replace("-", "/");
          signature = `\n\n— By [@${authorName}](don:identity:dvrv-us-1:devo/1iVu4ClfVV:${systemId})`;
        } else {
          signature = `\n\n— By ${authorName}`;
        }

        const finalBody = parsedBody + signature;

        try {
          const response = await fetch(`${API_URL}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticketId: ticketId,
              body: finalBody,
              user: authorName,
            }),
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server responded: ${response.status} ${errText}`);
          }
        } catch (e) {
          console.error("Failed to post comment", e);
          throw e;
        }
      },
    }),
    {
      name: "support-dashboard-storage",
      partialize: (s) => ({
        currentUser: s.currentUser,
        theme: s.theme,
        isAuthenticated: s.isAuthenticated,
      }),
    }
  )
);

import { create } from "zustand";
import { persist,createJSONStorage } from "zustand/middleware";
import { io } from "socket.io-client";
import { trackEvent } from "./utils/clevertap";

// --- CONFIG: Universal API URL ---
const getApiUrl = () => import.meta.env.VITE_API_URL;

export const useTicketStore = create(
  persist(
    (set, get) => ({
      tickets: [],
      isLoading: false,
      socket: null,
      lastSyncTime: null,
      myViews: [],

      loginUser: (user) => set({ currentUser: user, isAuthenticated: true }),
      logout: () => {
        set({ currentUser: null, isAuthenticated: false, tickets: [], myViews: [] });
        localStorage.removeItem("ticket-store"); // Optional: Clear data on logout
      },

      // ✅ ACTION: Connect to Real-Time Stream
      connectSocket: () => {
        const { socket } = get();
        if (socket) return;

        const API_URL = getApiUrl();
        const newSocket = io(API_URL);

        newSocket.on("connect", () => {
          console.log("🟢 Connected to Real-Time Server");
        });

        // ⚡ LISTEN: When server says "Here is new data", update instantly
        newSocket.on("REFRESH_TICKETS", (updatedTickets) => {
          console.log("🔥 Live Update Received!");
          set({ tickets: updatedTickets, lastSync: new Date() });
        });

        set({ socket: newSocket });
      },

      myViews: [],

      // --- VISTAS ACTIONS ---
    fetchViews: async () => {
        const { currentUser } = get();
        if (!currentUser?.email) return;

        try {
            const API_URL = getApiUrl();
            // Encode email to handle special characters in URL
            const res = await fetch(`${API_URL}/api/views/${encodeURIComponent(currentUser.email)}`);
            const data = await res.json();
            set({ myViews: data });
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
                 body: JSON.stringify({
                     userId: currentUser.email,
                     name,
                     filters: currentFilters
                 })
             });
             const data = await res.json();
             
             if (data.success) {
                 set({ myViews: [data.view, ...myViews] }); // Add new view to top of list
                 
                 // Optional: Track in CleverTap
                 import("./utils/clevertap").then(({ default: ct }) => {
                    ct.event.push("View Saved", { "View Name": name, "Date": new Date() });
                 });

                 return true;
             }
         } catch (e) {
             console.error("Failed to save view", e);
             return false;
         }
      },

      deleteView: async (viewId) => {
          const { currentUser, myViews } = get();
          if (!currentUser?.email) return;

          try {
              const API_URL = getApiUrl();
              await fetch(`${API_URL}/api/views/${encodeURIComponent(currentUser.email)}/${viewId}`, {
                  method: "DELETE"
              });
              set({ myViews: myViews.filter(v => v.id !== viewId) });
              
              // Optional: Track in CleverTap
              import("./utils/clevertap").then(({ default: ct }) => {
                  ct.event.push("View Deleted", { "View ID": viewId, "Date": new Date() });
               });

          } catch (e) {
              console.error("Failed to delete view", e);
          }
      },

      // lastSync: null,

      // --- AUTH STATE ---
      currentUser: null,
      isAuthenticated: false,
      token: null,
      theme: "dark",

      toggleTheme: () =>
        set((state) => ({ theme: state.theme === "light" ? "dark" : "light" })),

      setCurrentUser: (user) => set({ currentUser: user }),

      loginWithGoogle: async (credentialResponse) => {
        try {
          const API_URL = getApiUrl();
          const res = await fetch(`${API_URL}/api/auth/google`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // ✅ FIX: Change 'token' to 'credential' to match server.js
            body: JSON.stringify({ credential: credentialResponse.credential }),
          });

          const data = await res.json();

          // ✅ FIX: Remove 'data.success' check since server doesn't send it
          if (res.ok && data.user) {
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
          return false;
        }
      },

      logout: () =>
        set({ currentUser: null, isAuthenticated: false, token: null }),

      // --- DATA ACTIONS ---
      fetchTickets: async () => {
        const { lastSyncTime } = get();
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

      // Accepts internalId (UUID) and displayId (TKT-xxx)
      postTicketComment: async (internalId, displayId, text) => {
        const { currentUser } = get();
        const API_URL = getApiUrl();

        try {
          // 1. Local Sync (Uses readable ID for dashboard history)
          await fetch(`${API_URL}/api/remarks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticketId: displayId,
              user: currentUser?.display_name || "Support Engineer",
              text: text,
            }),
          });

          // 2. DevRev Sync (Uses internal UUID for platform reflection)
          const response = await fetch(`${API_URL}/api/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticketId: internalId,
              body: text,
            }),
          });

          if (!response.ok) throw new Error("DevRev Sync Failed");
        } catch (err) {
          console.error("❌ Post failed:", err);
          throw err;
        }
        // ✅ On Success:
        trackEvent("Comment Added", {
          "Ticket ID": displayId,
          "Comment Length": text.length,
        });
      },
    }),
    {
      name: "support-dashboard-storage",
      storage: createJSONStorage(() => localStorage), // Persist to local storage
      partialize: (s) => ({
        currentUser: s.currentUser,
        theme: s.theme,
        isAuthenticated: s.isAuthenticated,
        token: s.token,
      }),
    }
  )
);

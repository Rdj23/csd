import authRoutes from "./auth.js";
import ticketRoutes from "./tickets.js";
import analyticsRoutes from "./analytics.js";
import nocRoutes from "./noc.js";
import adminRoutes from "./admin.js";
import gamificationRoutes from "./gamification.js";
import rosterRoutes from "./roster.js";
import remarkRoutes from "./remarks.js";
import viewRoutes from "./views.js";
import webhookRoutes from "./webhooks.js";
import healthRoutes from "./health.js";
import cacheRoutes from "./cache.js";

export const mountRoutes = (app) => {
  app.use("/api", authRoutes);
  app.use("/api", ticketRoutes);
  app.use("/api", analyticsRoutes);
  app.use("/api", nocRoutes);
  app.use("/api", adminRoutes);
  app.use("/api", gamificationRoutes);
  app.use("/api", rosterRoutes);
  app.use("/api", remarkRoutes);
  app.use("/api", viewRoutes);
  app.use("/api", webhookRoutes);
  app.use("/api", healthRoutes);
  app.use("/api", cacheRoutes);
};

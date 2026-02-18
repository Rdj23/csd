import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { getAllQueues } from "./queues.js";

export const setupBullBoard = (app, requireAdmin) => {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/api/admin/queues");

  createBullBoard({
    queues: Object.values(getAllQueues()).map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });

  app.use("/api/admin/queues", requireAdmin, serverAdapter.getRouter());
  console.log("📊 Bull Board mounted at /api/admin/queues");
};

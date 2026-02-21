import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp } from "./helpers.js";

const app = createTestApp();

describe("Health Endpoint", () => {
  it("GET /api/health should return 200 with status", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status");
  });

  it("GET /api/auth/config should return Google client ID", async () => {
    const res = await request(app).get("/api/auth/config");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("clientId");
  });
});

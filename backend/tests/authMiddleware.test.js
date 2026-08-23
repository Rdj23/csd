import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp, getAuthToken, getNonCTToken } from "./helpers.js";

const app = createTestApp();

describe("Auth Middleware", () => {
  it("should return 401 when no token is provided", async () => {
    const res = await request(app).get("/api/gamification");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it("should return 401 when an invalid token is provided", async () => {
    const res = await request(app)
      .get("/api/gamification")
      .set("Authorization", "Bearer invalid-token-xyz");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it("should return 403 for non-@clevertap.com email", async () => {
    const token = getNonCTToken();
    const res = await request(app)
      .get("/api/gamification")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
  });

  it("should allow health endpoint without auth", async () => {
    const res = await request(app).get("/api/health");
    // Health may return 200 or error depending on DB state, but NOT 401
    expect(res.status).not.toBe(401);
  });

  it("should allow auth config endpoint without auth", async () => {
    const res = await request(app).get("/api/auth/config");
    expect(res.status).toBe(200);
  });

  it("should accept valid @clevertap.com token", async () => {
    const token = getAuthToken("rohan.jadhav@clevertap.com");
    const res = await request(app)
      .get("/api/cache/status")
      .set("Authorization", `Bearer ${token}`);
    // Should not be 401/403 — may be 500 if Redis is not available, that's fine
    expect([401, 403]).not.toContain(res.status);
  });
});

describe("Admin Middleware", () => {
  it("should return 403 for non-admin user on admin routes", async () => {
    const token = getAuthToken("normaluser@clevertap.com");
    const res = await request(app)
      .get("/api/admin/sync-status")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin/);
  });

  it("should allow admin user on admin routes", async () => {
    const token = getAuthToken("rohan.jadhav@clevertap.com");
    const res = await request(app)
      .get("/api/admin/sync-status")
      .set("Authorization", `Bearer ${token}`);
    // Should not be 403 — may be 500 if services are not available
    expect(res.status).not.toBe(403);
  });
});

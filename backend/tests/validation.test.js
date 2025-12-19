import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp, getAuthToken } from "./helpers.js";

const app = createTestApp();
const token = getAuthToken();

describe("Zod Validation — Remarks", () => {
  it("should return 400 when creating remark with empty body", async () => {
    const res = await request(app)
      .post("/api/remarks")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details).toBeDefined();
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("should return 400 when creating remark with missing text", async () => {
    const res = await request(app)
      .post("/api/remarks")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: "TKT-1234", user: "Rohan" });
    expect(res.status).toBe(400);
    expect(res.body.details.some((d) => d.path.includes("text"))).toBe(true);
  });

  it("should return 400 when creating comment with missing body", async () => {
    const res = await request(app)
      .post("/api/comments")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketId: "TKT-1234" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });
});

describe("Zod Validation — Tickets", () => {
  it("should return 400 for live-stats without required dates", async () => {
    const res = await request(app)
      .get("/api/tickets/live-stats")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should return 400 for drilldown without required date", async () => {
    const res = await request(app)
      .get("/api/tickets/drilldown")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should return 400 for by-range without required dates", async () => {
    const res = await request(app)
      .get("/api/tickets/by-range")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("should return 400 for by-date without required date", async () => {
    const res = await request(app)
      .get("/api/tickets/by-date")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("should return 400 for dependencies with non-array ticketIds", async () => {
    const res = await request(app)
      .post("/api/tickets/dependencies")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticketIds: "not-an-array" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should return 400 for ticket links without ticketId", async () => {
    const res = await request(app)
      .post("/api/tickets/links")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("Zod Validation — Views", () => {
  it("should return 400 when creating view without required fields", async () => {
    const res = await request(app)
      .post("/api/views")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should return 400 when creating view without filters object", async () => {
    const res = await request(app)
      .post("/api/views")
      .set("Authorization", `Bearer ${token}`)
      .send({ userId: "test@clevertap.com", name: "Test View" });
    expect(res.status).toBe(400);
  });
});

describe("Zod Validation — Gamification", () => {
  it("should return 400 for my-stats without email", async () => {
    const res = await request(app)
      .get("/api/gamification/my-stats")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should return 400 for my-stats with invalid email", async () => {
    const res = await request(app)
      .get("/api/gamification/my-stats?email=not-an-email")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe("Zod Validation — Roster", () => {
  it("should return 400 for profile status without userName", async () => {
    const res = await request(app)
      .post("/api/profile/status")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should return 400 for backup without userName query", async () => {
    const res = await request(app)
      .get("/api/roster/backup")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe("Zod Validation — Admin", () => {
  it("should return 400 for sync-ticket without ticketId", async () => {
    const adminToken = getAuthToken("rohan.jadhav@clevertap.com");
    const res = await request(app)
      .post("/api/admin/sync-ticket")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });
});

describe("Zod Validation — Webhook", () => {
  it("should return 400 for webhook without type", async () => {
    const res = await request(app)
      .post("/api/webhooks/devrev")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });
});

describe("Zod Validation — Auth", () => {
  it("should return 400 for google auth without credential", async () => {
    const res = await request(app)
      .post("/api/auth/google")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });
});

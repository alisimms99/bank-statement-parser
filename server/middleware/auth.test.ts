import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { requireAuth } from "./auth";
import type { AuthenticatedRequest } from "./auth";
import * as db from "../db";

// Mock the database module
vi.mock("../db", () => ({
  getUserByOpenId: vi.fn(),
  upsertUser: vi.fn(),
}));

// Mock ENV with test-only secret - DO NOT use in production
vi.mock("../_core/env", () => ({
  ENV: {
    cookieSecret: "test-secret-key-at-least-32-characters-long",
  },
}));

// Test-only secret key - must match the mocked ENV value
const TEST_SECRET = "test-secret-key-at-least-32-characters-long";

function makeApp() {
  const app = express();
  app.use(requireAuth);
  app.get("/api/test", (req: AuthenticatedRequest, res) => {
    res.status(200).json({ user: req.user });
  });
  return app;
}

async function generateToken(payload: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode(TEST_SECRET);
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

describe("requireAuth - Bearer token authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock database to return null (user not found)
    vi.mocked(db.getUserByOpenId).mockResolvedValue(null);
    vi.mocked(db.upsertUser).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts Bearer token with standard capitalization", async () => {
    const token = await generateToken({
      email: "test@example.com",
      openId: "test-user-id",
      name: "Test User",
    });

    const app = makeApp();
    const res = await request(app).get("/api/test").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe("test@example.com");
  });

  it("accepts Bearer token with lowercase 'bearer'", async () => {
    const token = await generateToken({
      email: "test@example.com",
      openId: "test-user-id",
      name: "Test User",
    });

    const app = makeApp();
    const res = await request(app).get("/api/test").set("Authorization", `bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe("test@example.com");
  });

  it("accepts Bearer token with uppercase 'BEARER'", async () => {
    const token = await generateToken({
      email: "test@example.com",
      openId: "test-user-id",
      name: "Test User",
    });

    const app = makeApp();
    const res = await request(app).get("/api/test").set("Authorization", `BEARER ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe("test@example.com");
  });

  it("accepts Bearer token with mixed case 'BeArEr'", async () => {
    const token = await generateToken({
      email: "test@example.com",
      openId: "test-user-id",
      name: "Test User",
    });

    const app = makeApp();
    const res = await request(app).get("/api/test").set("Authorization", `BeArEr ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe("test@example.com");
  });

  it("rejects missing Authorization header", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/test");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Authentication required");
  });

  it("rejects invalid token", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/test").set("Authorization", "Bearer invalid-token");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Authentication required");
  });

  it("rejects malformed Authorization header without Bearer scheme", async () => {
    const token = await generateToken({
      email: "test@example.com",
      openId: "test-user-id",
    });

    const app = makeApp();
    const res = await request(app).get("/api/test").set("Authorization", token);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Authentication required");
  });
});

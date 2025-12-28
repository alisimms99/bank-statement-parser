import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { registerOAuthRoutes } from "./oauth";
import { ENV } from "./env";

// Mock the OAuth client and dependencies
vi.mock("google-auth-library", () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    generateAuthUrl: vi.fn().mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?mock=true"),
    getToken: vi.fn().mockResolvedValue({
      tokens: {
        id_token: "mock_id_token",
        access_token: "mock_access_token",
      },
    }),
    setCredentials: vi.fn(),
    verifyIdToken: vi.fn().mockResolvedValue({
      getPayload: () => ({
        email: "test@example.com",
        email_verified: true,
        name: "Test User",
        picture: "https://example.com/picture.jpg",
        hd: "oddjobspropertymaintenance.com",
      }),
    }),
  })),
}));

vi.mock("../middleware/auth", () => ({
  createSessionToken: vi.fn().mockResolvedValue("mock_session_token"),
  verifySessionToken: vi.fn(),
}));

vi.mock("../db", () => ({
  upsertUser: vi.fn().mockResolvedValue({}),
}));

describe("OAuth Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    registerOAuthRoutes(app);
    
    // Mock ENV values
    vi.spyOn(ENV, "googleClientId", "get").mockReturnValue("mock_client_id");
    vi.spyOn(ENV, "googleClientSecret", "get").mockReturnValue("mock_client_secret");
    vi.spyOn(ENV, "oauthCallbackUrl", "get").mockReturnValue("http://localhost:3000/api/auth/google/callback");
    vi.spyOn(ENV, "isProduction", "get").mockReturnValue(false);
  });

  describe("GET /api/auth/google/callback - Redirect Validation", () => {
    it("allows relative path redirects", async () => {
      const redirectPath = "/dashboard";
      const state = Buffer.from(JSON.stringify({ redirect: redirectPath })).toString("base64");

      const res = await request(app)
        .get("/api/auth/google/callback")
        .query({ code: "mock_auth_code", state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(redirectPath);
    });

    it("allows same-origin absolute URL redirects", async () => {
      const redirectUrl = "http://localhost:3000/dashboard";
      const state = Buffer.from(JSON.stringify({ redirect: redirectUrl })).toString("base64");

      const res = await request(app)
        .get("/api/auth/google/callback")
        .query({ code: "mock_auth_code", state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(redirectUrl);
    });

    it("rejects external URL redirects to prevent open redirect attacks", async () => {
      const maliciousRedirect = "https://evil.example.com/phishing";
      const state = Buffer.from(JSON.stringify({ redirect: maliciousRedirect })).toString("base64");

      const res = await request(app)
        .get("/api/auth/google/callback")
        .query({ code: "mock_auth_code", state });

      expect(res.status).toBe(302);
      // Should redirect to default "/" instead of malicious URL
      expect(res.headers.location).toBe("/");
      expect(res.headers.location).not.toBe(maliciousRedirect);
    });

    it("rejects javascript: protocol URLs", async () => {
      const maliciousRedirect = "javascript:alert('XSS')";
      const state = Buffer.from(JSON.stringify({ redirect: maliciousRedirect })).toString("base64");

      const res = await request(app)
        .get("/api/auth/google/callback")
        .query({ code: "mock_auth_code", state });

      expect(res.status).toBe(302);
      // Should redirect to default "/" instead of malicious URL
      expect(res.headers.location).toBe("/");
      expect(res.headers.location).not.toContain("javascript:");
    });

    it("rejects data: protocol URLs", async () => {
      const maliciousRedirect = "data:text/html,<script>alert('XSS')</script>";
      const state = Buffer.from(JSON.stringify({ redirect: maliciousRedirect })).toString("base64");

      const res = await request(app)
        .get("/api/auth/google/callback")
        .query({ code: "mock_auth_code", state });

      expect(res.status).toBe(302);
      // Should redirect to default "/" instead of malicious URL
      expect(res.headers.location).toBe("/");
      expect(res.headers.location).not.toContain("data:");
    });

    it("uses default redirect when state is missing", async () => {
      const res = await request(app)
        .get("/api/auth/google/callback")
        .query({ code: "mock_auth_code" });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/");
    });

    it("uses default redirect when state is invalid", async () => {
      const invalidState = "not-valid-base64!@#$";

      const res = await request(app)
        .get("/api/auth/google/callback")
        .query({ code: "mock_auth_code", state: invalidState });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/");
    });

    it("uses default redirect when redirect is not a string", async () => {
      const state = Buffer.from(JSON.stringify({ redirect: 123 })).toString("base64");

      const res = await request(app)
        .get("/api/auth/google/callback")
        .query({ code: "mock_auth_code", state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/");
    });

    it("allows deep path redirects", async () => {
      const redirectPath = "/dashboard/transactions/import?filter=pending";
      const state = Buffer.from(JSON.stringify({ redirect: redirectPath })).toString("base64");

      const res = await request(app)
        .get("/api/auth/google/callback")
        .query({ code: "mock_auth_code", state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(redirectPath);
    });
  });
});

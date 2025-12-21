import express from "express";
import request from "supertest";
import http from "http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

import { decideCloudRunAccess, requireCloudRunApiAccess } from "./cloudRunAccessControl";

function makeApp() {
  const app = express();
  app.use(requireCloudRunApiAccess);
  app.get("/api/health", (_req, res) => res.status(200).json({ ok: true }));
  app.get("/api/test", (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("decideCloudRunAccess", () => {
  it("accepts allowed workspace domain", () => {
    const decision = decideCloudRunAccess({
      workspaceDomain: "example.com",
      allowedServiceAccounts: [],
      tokenPayload: { iss: "https://accounts.google.com", email: "alice@example.com" },
    });
    expect(decision).toEqual({ ok: true });
  });

  it("rejects disallowed email domain", () => {
    const decision = decideCloudRunAccess({
      workspaceDomain: "example.com",
      allowedServiceAccounts: [],
      tokenPayload: { iss: "https://accounts.google.com", email: "alice@other.com" },
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe(403);
      expect(decision.code).toBe("forbidden");
    }
  });
});

describe("requireCloudRunApiAccess", () => {
  const prevEnv: Record<string, string | undefined> = {};
  let jwksServer: http.Server | null = null;
  let jwksUrl = "";
  let kid = "";
  let privateKey: CryptoKey | null = null;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    const publicJwk = await exportJWK(pair.publicKey);
    kid = "test-kid";
    publicJwk.kid = kid;
    publicJwk.use = "sig";
    publicJwk.alg = "RS256";

    jwksServer = http.createServer((req, res) => {
      if (req.url === "/jwks") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });

    await new Promise<void>(resolve => {
      jwksServer!.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = jwksServer.address();
    if (!addr || typeof addr === "string") throw new Error("Failed to bind JWKS server");
    jwksUrl = `http://127.0.0.1:${addr.port}/jwks`;
  });

  afterAll(async () => {
    if (jwksServer) {
      await new Promise<void>(resolve => jwksServer!.close(() => resolve()));
    }
  });

  beforeEach(() => {
    for (const k of [
      "NODE_ENV",
      "WORKSPACE_DOMAIN",
      "INTERNAL_SERVICE_ACCOUNT_EMAILS",
      "GOOGLE_OIDC_JWKS_URL",
      "ENABLE_CLOUD_RUN_AUTH",
    ]) {
      prevEnv[k] = process.env[k];
    }

    process.env.NODE_ENV = "production";
    process.env.WORKSPACE_DOMAIN = "example.com";
    process.env.INTERNAL_SERVICE_ACCOUNT_EMAILS = "";
    process.env.GOOGLE_OIDC_JWKS_URL = jwksUrl;
    delete process.env.ENABLE_CLOUD_RUN_AUTH;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function signToken(email: string) {
    if (!privateKey) throw new Error("Missing private key");
    return await new SignJWT({ email })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer("https://accounts.google.com")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(privateKey);
  }

  it("accepts a valid Google-issued OIDC token (signature + issuer)", async () => {
    const token = await signToken("alice@example.com");
    const app = makeApp();
    const res = await request(app).get("/api/test").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("rejects missing token", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/test");
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe("missing_token");
  });

  it("rejects invalid token", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/test").set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe("invalid_token");
  });

  it("does not require auth for /api/health", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});


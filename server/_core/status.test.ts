import express from "express";
import request from "supertest";
import { describe, expect, it, vi, afterEach } from "vitest";
import { getDocumentAiConfig } from "./env";

vi.mock("./env", async () => {
  const actual = await vi.importActual("./env");
  return {
    ...actual,
    getDocumentAiConfig: vi.fn(() => ({
      enabled: false,
      ready: false,
      reason: "Document AI disabled",
      projectId: "",
      location: "",
      processors: {},
      missing: [],
    })),
  };
});

describe("GET /api/status", () => {
  afterEach(() => {
    delete process.env.K_REVISION;
    delete process.env.BUILD_ID;
    delete process.env.CLOUD_RUN_REVISION;
    delete process.env.CLOUD_BUILD_ID;
    vi.restoreAllMocks();
  });

  it("returns deployment status information", async () => {
    const testApp = express();
    testApp.get("/api/status", (_req, res) => {
      const docAiConfig = getDocumentAiConfig();
      res.json({
        deployedRevision: process.env.K_REVISION || process.env.CLOUD_RUN_REVISION || "1.0.0",
        buildId: process.env.BUILD_ID || process.env.CLOUD_BUILD_ID || "local",
        timestamp: new Date().toISOString(),
        documentAi: {
          enabled: docAiConfig.enabled,
          ready: docAiConfig.ready,
          reason: docAiConfig.reason,
        },
        version: "1.0.0",
        environment: process.env.NODE_ENV || "unknown",
      });
    });

    const res = await request(testApp).get("/api/status");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("deployedRevision");
    expect(res.body).toHaveProperty("buildId");
    expect(res.body).toHaveProperty("timestamp");
    expect(res.body).toHaveProperty("documentAi");
    expect(res.body.documentAi).toHaveProperty("enabled");
    expect(res.body.documentAi).toHaveProperty("ready");
    expect(res.body).toHaveProperty("version");
    expect(res.body).toHaveProperty("environment");
  });

  it("includes Cloud Run revision when K_REVISION is set", async () => {
    process.env.K_REVISION = "my-service-revision-001";
    
    const testApp = express();
    testApp.get("/api/status", (_req, res) => {
      const docAiConfig = getDocumentAiConfig();
      res.json({
        deployedRevision: process.env.K_REVISION || process.env.CLOUD_RUN_REVISION || "1.0.0",
        buildId: process.env.BUILD_ID || process.env.CLOUD_BUILD_ID || "local",
        timestamp: new Date().toISOString(),
        documentAi: {
          enabled: docAiConfig.enabled,
          ready: docAiConfig.ready,
          reason: docAiConfig.reason,
        },
        version: "1.0.0",
        environment: process.env.NODE_ENV || "unknown",
      });
    });

    const res = await request(testApp).get("/api/status");

    expect(res.status).toBe(200);
    expect(res.body.deployedRevision).toBe("my-service-revision-001");
  });

  it("includes build ID when BUILD_ID is set", async () => {
    process.env.BUILD_ID = "abc123-build-id";
    
    const testApp = express();
    testApp.get("/api/status", (_req, res) => {
      const docAiConfig = getDocumentAiConfig();
      res.json({
        deployedRevision: process.env.K_REVISION || process.env.CLOUD_RUN_REVISION || "1.0.0",
        buildId: process.env.BUILD_ID || process.env.CLOUD_BUILD_ID || "local",
        timestamp: new Date().toISOString(),
        documentAi: {
          enabled: docAiConfig.enabled,
          ready: docAiConfig.ready,
          reason: docAiConfig.reason,
        },
        version: "1.0.0",
        environment: process.env.NODE_ENV || "unknown",
      });
    });

    const res = await request(testApp).get("/api/status");

    expect(res.status).toBe(200);
    expect(res.body.buildId).toBe("abc123-build-id");
  });

  it("returns timestamp in ISO format", async () => {
    const testApp = express();
    testApp.get("/api/status", (_req, res) => {
      const docAiConfig = getDocumentAiConfig();
      res.json({
        deployedRevision: process.env.K_REVISION || process.env.CLOUD_RUN_REVISION || "1.0.0",
        buildId: process.env.BUILD_ID || process.env.CLOUD_BUILD_ID || "local",
        timestamp: new Date().toISOString(),
        documentAi: {
          enabled: docAiConfig.enabled,
          ready: docAiConfig.ready,
          reason: docAiConfig.reason,
        },
        version: "1.0.0",
        environment: process.env.NODE_ENV || "unknown",
      });
    });

    const res = await request(testApp).get("/api/status");

    expect(res.status).toBe(200);
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });
});

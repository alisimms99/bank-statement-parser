import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

async function importFreshEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  const prev = { ...process.env };

  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  const mod = await import("./env");

  // Restore env for isolation (module keeps its own snapshot).
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, prev);

  return mod;
}

describe("getDocumentAiConfig", () => {
  it("disables Document AI when not configured", async () => {
    const { ENV, getDocumentAiConfig } = await importFreshEnv({});
    const config = getDocumentAiConfig();
    expect(config.enabled).toBe(ENV.enableDocAi);
    expect(config.ready).toBe(false);
    expect(config.missing.length).toBeGreaterThan(0);
  });
});

describe("DATABASE_URL resolution", () => {
  it("prefers DATABASE_URL when set", async () => {
    const { ENV } = await importFreshEnv({
      DATABASE_URL: "mysql://user:pass@host:3306/db",
      DATABASE_URL_FILE: "/should/not/be/read",
    });
    expect(ENV.databaseUrl).toBe("mysql://user:pass@host:3306/db");
  });

  it("falls back to DATABASE_URL_FILE when DATABASE_URL is unset", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dburl-"));
    const filePath = path.join(dir, "DATABASE_URL");
    fs.writeFileSync(filePath, "mysql://user:pass@host:3306/db\n", "utf8");

    const { ENV } = await importFreshEnv({
      DATABASE_URL: undefined,
      DATABASE_URL_FILE: filePath,
    });

    expect(ENV.databaseUrl).toBe("mysql://user:pass@host:3306/db");
  });
});

describe("Production secrets support Secret Manager", () => {
  it("loads GOOGLE_PROJECT_ID from file when GOOGLE_PROJECT_ID_FILE is set", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcp-project-"));
    const filePath = path.join(dir, "GOOGLE_PROJECT_ID");
    fs.writeFileSync(filePath, "my-project-123\n", "utf8");

    const { ENV } = await importFreshEnv({
      GOOGLE_PROJECT_ID: undefined,
      GOOGLE_PROJECT_ID_FILE: filePath,
    });

    expect(ENV.gcpProjectId).toBe("my-project-123");
  });

  it("loads DOCAI_PROCESSOR_ID from file when DOCAI_PROCESSOR_ID_FILE is set", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "processor-"));
    const filePath = path.join(dir, "DOCAI_PROCESSOR_ID");
    fs.writeFileSync(filePath, "abc123processor\n", "utf8");

    const { ENV } = await importFreshEnv({
      DOCAI_PROCESSOR_ID: undefined,
      DOCAI_PROCESSOR_ID_FILE: filePath,
    });

    expect(ENV.docAiProcessorId).toBe("abc123processor");
  });

  it("loads DOCAI_LOCATION from file when DOCAI_LOCATION_FILE is set", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "location-"));
    const filePath = path.join(dir, "DOCAI_LOCATION");
    fs.writeFileSync(filePath, "us-west1\n", "utf8");

    const { ENV } = await importFreshEnv({
      DOCAI_LOCATION: undefined,
      DOCAI_LOCATION_FILE: filePath,
      GCP_LOCATION: undefined,
    });

    expect(ENV.gcpLocation).toBe("us-west1");
  });

  it("loads CORS_ALLOW_ORIGIN from file when CORS_ALLOW_ORIGIN_FILE is set", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cors-"));
    const filePath = path.join(dir, "CORS_ALLOW_ORIGIN");
    fs.writeFileSync(filePath, "https://example.com\n", "utf8");

    const { ENV } = await importFreshEnv({
      CORS_ALLOW_ORIGIN: undefined,
      CORS_ALLOW_ORIGIN_FILE: filePath,
    });

    expect(ENV.corsAllowOrigin).toBe("https://example.com");
  });

  it("loads GCP_SERVICE_ACCOUNT_JSON from file when GCP_SERVICE_ACCOUNT_JSON_FILE is set", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-json-"));
    const filePath = path.join(dir, "GCP_SERVICE_ACCOUNT_JSON");
    const serviceAccount = JSON.stringify({ type: "service_account", project_id: "test" });
    fs.writeFileSync(filePath, serviceAccount + "\n", "utf8");

    const { ENV } = await importFreshEnv({
      GCP_SERVICE_ACCOUNT_JSON: undefined,
      GCP_SERVICE_ACCOUNT_JSON_FILE: filePath,
    });

    expect(ENV.gcpServiceAccountJson).toBe(serviceAccount);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("env", () => {
  it("disables Document AI when not configured", async () => {
    vi.resetModules();
    const { ENV, getDocumentAiConfig } = await import("./env");
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

  it("reads *_FILE env vars even with surrounding whitespace", async () => {
    const prevJwtSecret = process.env.JWT_SECRET;
    const prevJwtSecretFile = process.env.JWT_SECRET_FILE;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "env-test-"));
    const secretFile = path.join(dir, "jwt_secret");

    try {
      fs.writeFileSync(secretFile, "supersecret\n", "utf8");
      delete process.env.JWT_SECRET;
      process.env.JWT_SECRET_FILE = `  ${secretFile}  `;

      vi.resetModules();
      const { ENV } = await import("./env");
      expect(ENV.cookieSecret).toBe("supersecret");
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; not fatal for the test.
      }
      if (typeof prevJwtSecret === "string") process.env.JWT_SECRET = prevJwtSecret;
      else delete process.env.JWT_SECRET;
      if (typeof prevJwtSecretFile === "string") process.env.JWT_SECRET_FILE = prevJwtSecretFile;
      else delete process.env.JWT_SECRET_FILE;
    }
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

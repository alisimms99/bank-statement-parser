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

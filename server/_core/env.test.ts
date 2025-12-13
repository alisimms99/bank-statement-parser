import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("env", () => {
  it("disables Document AI when not configured", async () => {
    vi.resetModules();
    const { ENV, getDocumentAiConfig } = await import("./env");
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

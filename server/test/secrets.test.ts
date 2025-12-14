import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the optional dependency as a *virtual* module (package is not installed).
const accessSecretVersionMock = vi.fn();
const getProjectIdMock = vi.fn(async () => "test-project");

vi.mock(
  "@google-cloud/secret-manager",
  () => ({
    SecretManagerServiceClient: class {
      accessSecretVersion = accessSecretVersionMock;
      getProjectId = getProjectIdMock;
    },
  }),
  { virtual: true }
);

describe("resolveSecret", () => {
  const prevEnv = { ...process.env };

  beforeEach(async () => {
    accessSecretVersionMock.mockReset();
    getProjectIdMock.mockReset();
    getProjectIdMock.mockResolvedValue("test-project");

    // isolate module cache between tests (important for in-memory secret cache)
    vi.resetModules();

    // reset env
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, prevEnv);

    const mod = await import("../_core/secrets");
    mod.__clearSecretCacheForTests();
  });

  afterEach(() => {
    // restore env
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, prevEnv);
  });

  it("prefers explicit env var over *_FILE and Secret Manager", async () => {
    process.env.K_SERVICE = "svc";
    process.env.JWT_SECRET = "from-env";
    process.env.SECRET_JWT_SECRET = "jwt-secret";

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jwt-"));
    const filePath = path.join(dir, "JWT_SECRET");
    fs.writeFileSync(filePath, "from-file\n", "utf8");
    process.env.JWT_SECRET_FILE = filePath;

    const { resolveSecret } = await import("../_core/secrets");
    const v = await resolveSecret("JWT_SECRET");

    expect(v).toBe("from-env");
  });

  it("prefers *_FILE over Secret Manager", async () => {
    process.env.K_SERVICE = "svc";
    process.env.JWT_SECRET = "";
    delete process.env.JWT_SECRET;
    process.env.SECRET_JWT_SECRET = "jwt-secret";

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jwtfile-"));
    const filePath = path.join(dir, "JWT_SECRET");
    fs.writeFileSync(filePath, "from-file\n", "utf8");
    process.env.JWT_SECRET_FILE = filePath;

    const { resolveSecret } = await import("../_core/secrets");
    const v = await resolveSecret("JWT_SECRET");

    expect(v).toBe("from-file");
  });

  it("uses Secret Manager on Cloud Run when env and *_FILE are missing", async () => {
    process.env.K_SERVICE = "svc";
    process.env.GOOGLE_CLOUD_PROJECT = "p";
    process.env.SECRET_JWT_SECRET = "jwt-secret";

    accessSecretVersionMock.mockResolvedValue([
      {
        payload: {
          data: Buffer.from("from-sm"),
        },
      },
    ]);

    const { resolveSecret } = await import("../_core/secrets");
    const v = await resolveSecret("JWT_SECRET");

    expect(v).toBe("from-sm");
    expect(accessSecretVersionMock).toHaveBeenCalledTimes(1);
    expect(accessSecretVersionMock).toHaveBeenCalledWith({
      name: "projects/p/secrets/jwt-secret/versions/latest",
    });
  });

  it("caches Secret Manager values (no repeated fetches)", async () => {
    process.env.K_SERVICE = "svc";
    process.env.GOOGLE_CLOUD_PROJECT = "p";
    process.env.SECRET_JWT_SECRET = "jwt-secret";

    accessSecretVersionMock.mockResolvedValue([
      {
        payload: {
          data: Buffer.from("from-sm"),
        },
      },
    ]);

    const { resolveSecret } = await import("../_core/secrets");
    const a = await resolveSecret("JWT_SECRET");
    const b = await resolveSecret("JWT_SECRET");

    expect(a).toBe("from-sm");
    expect(b).toBe("from-sm");
    expect(accessSecretVersionMock).toHaveBeenCalledTimes(1);
  });

  it("does not consult Secret Manager when not on Cloud Run", async () => {
    delete process.env.K_SERVICE;
    process.env.GOOGLE_CLOUD_PROJECT = "p";
    process.env.SECRET_JWT_SECRET = "jwt-secret";

    accessSecretVersionMock.mockResolvedValue([
      {
        payload: {
          data: Buffer.from("from-sm"),
        },
      },
    ]);

    const { resolveSecret } = await import("../_core/secrets");
    const v = await resolveSecret("JWT_SECRET");

    expect(v).toBe("");
    expect(accessSecretVersionMock).toHaveBeenCalledTimes(0);
  });
});

import fs from "fs";

/**
 * Detect Cloud Run runtime.
 *
 * Cloud Run sets K_SERVICE / K_REVISION / K_CONFIGURATION.
 */
export function isCloudRun(): boolean {
  return Boolean(process.env.K_SERVICE || process.env.K_REVISION || process.env.K_CONFIGURATION);
}

/**
 * Read a direct env var or empty string when unset.
 */
export function readEnv(name: string): string {
  const v = process.env[name];
  return v && v.trim() ? v : "";
}

/**
 * Read a *_FILE mounted secret (Cloud Run secret volume convention).
 */
export function readEnvFile(name: string): string {
  const fileKey = `${name}_FILE`;
  const filePath = process.env[fileKey];
  if (!filePath || !filePath.trim()) return "";

  try {
    if (!fs.existsSync(filePath)) return "";
    // Secret files often contain trailing newline; trim for safety.
    return fs.readFileSync(filePath, "utf8").trim();
  } catch (error) {
    console.warn(`Failed to read ${name}_FILE`, error);
    return "";
  }
}

type SecretCacheValue = {
  value: string;
};

const secretCache = new Map<string, SecretCacheValue>();
const inFlight = new Map<string, Promise<string>>();

let cachedClient: unknown | null | undefined;
let cachedProjectIdPromise: Promise<string> | null = null;

function getSecretNameEnvVar(key: string): string {
  return `SECRET_${key}`;
}

function normalizeAccessName(input: string, projectId: string): string {
  const raw = input.trim();
  if (!raw) return "";

  // Accept either:
  // - projects/<p>/secrets/<s>/versions/<v>
  // - projects/<p>/secrets/<s>
  // - <s>
  // - <s>/versions/<v>
  // - <s>:access (not recommended, but strip it)
  const noAccessSuffix = raw.endsWith(":access") ? raw.slice(0, -":access".length) : raw;

  if (noAccessSuffix.startsWith("projects/")) {
    if (noAccessSuffix.includes("/versions/")) return noAccessSuffix;
    return `${noAccessSuffix}/versions/latest`;
  }

  // Short name.
  if (noAccessSuffix.includes("/versions/")) {
    return `projects/${projectId}/secrets/${noAccessSuffix}`;
  }

  return `projects/${projectId}/secrets/${noAccessSuffix}/versions/latest`;
}

async function getSecretManagerClient(): Promise<any> {
  if (cachedClient !== undefined) return cachedClient;

  try {
    // Optional dependency: if present, use the official client.
    const mod: any = await import("@google-cloud/secret-manager");
    cachedClient = new mod.SecretManagerServiceClient();
    return cachedClient;
  } catch {
    cachedClient = null;
    return null;
  }
}

async function resolveProjectId(): Promise<string> {
  const fromEnv =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GOOGLE_PROJECT_ID;

  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const client = await getSecretManagerClient();
  if (client && typeof client.getProjectId === "function") {
    if (!cachedProjectIdPromise) cachedProjectIdPromise = Promise.resolve(client.getProjectId());
    return cachedProjectIdPromise;
  }

  // Best-effort fallback; if the project id is unavailable, Secret Manager lookup cannot proceed.
  throw new Error("Missing GCP project id for Secret Manager lookup");
}

async function fetchSecretViaRest(accessName: string): Promise<string> {
  // Cloud Run / GCE metadata server token.
  const tokenRes = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } }
  );
  if (!tokenRes.ok) {
    throw new Error(`Failed to fetch metadata token: ${tokenRes.status} ${tokenRes.statusText}`);
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  const token = tokenJson.access_token;
  if (!token) throw new Error("Metadata token response missing access_token");

  const url = `https://secretmanager.googleapis.com/v1/${accessName}:access`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Secret Manager access failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { payload?: { data?: string } };
  const b64 = json.payload?.data;
  if (!b64) return "";

  return Buffer.from(b64, "base64").toString("utf8").trim();
}

async function fetchSecretValue(accessName: string): Promise<string> {
  const client = await getSecretManagerClient();
  if (client && typeof client.accessSecretVersion === "function") {
    const [resp] = await client.accessSecretVersion({ name: accessName });
    const data: unknown = resp?.payload?.data;
    if (typeof data === "string") return data.trim();
    if (Buffer.isBuffer(data)) return data.toString("utf8").trim();
    // Some mocks may return Uint8Array.
    if (data instanceof Uint8Array) return Buffer.from(data).toString("utf8").trim();
    return "";
  }

  return fetchSecretViaRest(accessName);
}

/**
 * Resolve an app secret with precedence:
 *  1) explicit env var (KEY)
 *  2) *_FILE mount (KEY_FILE)
 *  3) Secret Manager lookup when running on Cloud Run and SECRET_<KEY> is set
 *
 * Secret Manager is only consulted if the first two are missing.
 */
export async function resolveSecret(key: string): Promise<string> {
  const direct = readEnv(key);
  if (direct) return direct;

  const fromFile = readEnvFile(key);
  if (fromFile) return fromFile;

  if (!isCloudRun()) return "";

  const secretName = readEnv(getSecretNameEnvVar(key));
  if (!secretName) return "";

  // Determine the cache key by the fully qualified version name.
  let accessName: string;
  try {
    const projectId = await resolveProjectId();
    accessName = normalizeAccessName(secretName, projectId);
  } catch (error) {
    console.warn(`Secret Manager lookup skipped for ${key}:`, error);
    return "";
  }

  if (!accessName) return "";

  const cached = secretCache.get(accessName);
  if (cached) return cached.value;

  const existing = inFlight.get(accessName);
  if (existing) return existing;

  const p = (async () => {
    try {
      const value = await fetchSecretValue(accessName);
      secretCache.set(accessName, { value });
      return value;
    } finally {
      inFlight.delete(accessName);
    }
  })();

  inFlight.set(accessName, p);
  return p;
}

/**
 * Test-only helper for isolation.
 */
export function __clearSecretCacheForTests(): void {
  secretCache.clear();
  inFlight.clear();
  cachedClient = undefined;
  cachedProjectIdPromise = null;
}

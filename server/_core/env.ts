import fs from "fs";
import { z } from "zod";
import { readEnv, readEnvFile, resolveSecret } from "./secrets";

/**
 * Reads an env var directly, or falls back to <NAME>_FILE which should contain
 * a filesystem path to a secret (Cloud Run Secret Manager convention).
 */
export function readEnvOrFile(name: string): string {
  // Kept for backwards compatibility with existing tests/code.
  const direct = readEnv(name);
  if (direct) return direct;
  return readEnvFile(name);
}

function warmupSecret(envKey: string, getCurrent: () => string, setValue: (v: string) => void) {
  // Only attempt Secret Manager if not already set via env or *_FILE.
  if (getCurrent()) return;

  void resolveSecret(envKey)
    .then(v => {
      if (!v) return;
      if (getCurrent()) return;
      setValue(v);
    })
    .catch(error => {
      console.warn(`Failed to load secret for ${envKey}`, error);
    });
}

export const ENV = {
  // App + Auth
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: readEnvOrFile("JWT_SECRET"),

  // DB
  databaseUrl: readEnvOrFile("DATABASE_URL"),

  // OAuth / Identity
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  
  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: readEnvOrFile("GOOGLE_CLIENT_SECRET"),
  oauthCallbackUrl: process.env.OAUTH_CALLBACK_URL ?? "",

  // Runtime mode
  isProduction: process.env.NODE_ENV === "production",

  // Forge
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: readEnvOrFile("BUILT_IN_FORGE_API_KEY") || readEnvOrFile("OPENAI_API_KEY"),

  // OpenAI
  openaiApiKey: readEnvOrFile("OPENAI_API_KEY"),

  // Server
  port: process.env.PORT ?? "",
  corsAllowOrigin: readEnvOrFile("CORS_ALLOW_ORIGIN"),

  // Project / Location
  gcpProjectId: readEnvOrFile("GOOGLE_PROJECT_ID") || readEnvOrFile("GCP_PROJECT_ID"),
  gcpLocation: readEnvOrFile("DOCAI_LOCATION") || process.env.GCP_LOCATION || "us",

  // Processors
  docAiProcessorId: readEnvOrFile("DOCAI_PROCESSOR_ID"),

  gcpBankProcessorId:
    process.env.DOC_AI_BANK_PROCESSOR_ID ??
    process.env.GCP_BANK_PROCESSOR_ID ??
    readEnvOrFile("DOCAI_PROCESSOR_ID"),

  gcpInvoiceProcessorId:
    process.env.DOC_AI_INVOICE_PROCESSOR_ID ??
    process.env.GCP_INVOICE_PROCESSOR_ID ??
    readEnvOrFile("DOCAI_PROCESSOR_ID"),

  gcpOcrProcessorId:
    process.env.DOC_AI_OCR_PROCESSOR_ID ??
    process.env.GCP_OCR_PROCESSOR_ID ??
    readEnvOrFile("DOCAI_PROCESSOR_ID"),

  gcpFormProcessorId:
    process.env.DOC_AI_FORM_PROCESSOR_ID ??
    process.env.GCP_FORM_PROCESSOR_ID ??
    readEnvOrFile("DOCAI_PROCESSOR_ID"),

  // Credentials / Secrets
  gcpCredentialsJson: readEnvOrFile("GCP_DOCUMENTAI_CREDENTIALS"),
  gcpServiceAccountJson: readEnvOrFile("GCP_SERVICE_ACCOUNT_JSON"),
  gcpServiceAccountPath: process.env.GCP_SERVICE_ACCOUNT_PATH ?? "",

  // Flags
  enableDocAi: process.env.ENABLE_DOC_AI === "true",

  // Google Sheets
  googleSheetsMasterId: readEnvOrFile("GOOGLE_SHEETS_MASTER_ID"),
};

// Debug logging for Document AI configuration (remove after debugging)
if (process.env.NODE_ENV !== "production") {
  console.log("[DEBUG] Document AI Configuration:");
  console.log("  ENABLE_DOC_AI:", process.env.ENABLE_DOC_AI, "(type:", typeof process.env.ENABLE_DOC_AI, ")");
  console.log("  ENV.enableDocAi:", ENV.enableDocAi);
  console.log("  GOOGLE_PROJECT_ID:", process.env.GOOGLE_PROJECT_ID);
  console.log("  ENV.gcpProjectId:", ENV.gcpProjectId);
  console.log("  DOCAI_LOCATION:", process.env.DOCAI_LOCATION);
  console.log("  ENV.gcpLocation:", ENV.gcpLocation);
  console.log("  DOC_AI_BANK_PROCESSOR_ID:", process.env.DOC_AI_BANK_PROCESSOR_ID);
  console.log("  ENV.gcpBankProcessorId:", ENV.gcpBankProcessorId);
  console.log("  GCP_SERVICE_ACCOUNT_PATH:", process.env.GCP_SERVICE_ACCOUNT_PATH);
  console.log("  ENV.gcpServiceAccountPath:", ENV.gcpServiceAccountPath);
  const docAiConfig = getDocumentAiConfig();
  console.log("  getDocumentAiConfig():", {
    enabled: docAiConfig.enabled,
    ready: docAiConfig.ready,
    missing: docAiConfig.missing,
    reason: docAiConfig.reason,
  });
}

// Best-effort Secret Manager warmup (Cloud Run only, SECRET_<KEY> must be set).
warmupSecret("JWT_SECRET", () => ENV.cookieSecret, v => (ENV.cookieSecret = v));
warmupSecret("DATABASE_URL", () => ENV.databaseUrl, v => (ENV.databaseUrl = v));
warmupSecret("CORS_ALLOW_ORIGIN", () => ENV.corsAllowOrigin, v => (ENV.corsAllowOrigin = v));
warmupSecret("GOOGLE_PROJECT_ID", () => ENV.gcpProjectId, v => (ENV.gcpProjectId = v));
warmupSecret("GCP_PROJECT_ID", () => ENV.gcpProjectId, v => (ENV.gcpProjectId = v));
warmupSecret("DOCAI_LOCATION", () => (ENV.gcpLocation === "us" ? "" : ENV.gcpLocation), v => (ENV.gcpLocation = v));
warmupSecret("DOCAI_PROCESSOR_ID", () => ENV.docAiProcessorId, v => (ENV.docAiProcessorId = v));
warmupSecret(
  "GCP_DOCUMENTAI_CREDENTIALS",
  () => ENV.gcpCredentialsJson,
  v => (ENV.gcpCredentialsJson = v)
);
warmupSecret(
  "GCP_SERVICE_ACCOUNT_JSON",
  () => ENV.gcpServiceAccountJson,
  v => (ENV.gcpServiceAccountJson = v)
);
warmupSecret("BUILT_IN_FORGE_API_KEY", () => ENV.forgeApiKey, v => (ENV.forgeApiKey = v));
warmupSecret("OPENAI_API_KEY", () => ENV.openaiApiKey, v => (ENV.openaiApiKey = v));
warmupSecret("GOOGLE_SHEETS_MASTER_ID", () => ENV.googleSheetsMasterId, v => (ENV.googleSheetsMasterId = v));

export type DocumentAiProcessorType = "bank" | "invoice" | "ocr" | "form";

export interface DocumentAiConfig {
  enabled: boolean;
  ready: boolean;
  projectId: string;
  location: string;
  processors: Partial<Record<DocumentAiProcessorType, string>>;
  credentials?: Record<string, unknown>;
  missing: string[];
  reason?: string;
}

export function getDocumentAiConfig(): DocumentAiConfig {
  const processors: Partial<Record<DocumentAiProcessorType, string>> = {
    bank: ENV.gcpBankProcessorId || undefined,
    invoice: ENV.gcpInvoiceProcessorId || undefined,
    ocr: ENV.gcpOcrProcessorId || undefined,
    form: ENV.gcpFormProcessorId || undefined,
  };

  const credentials = loadServiceAccount();
  const missing: string[] = [];

  if (!ENV.gcpProjectId) missing.push("GOOGLE_PROJECT_ID (or GCP_PROJECT_ID)");
  if (!ENV.gcpLocation) missing.push("DOCAI_LOCATION (or GCP_LOCATION)");
  if (!credentials) missing.push("GCP_SERVICE_ACCOUNT_JSON or GCP_SERVICE_ACCOUNT_PATH");
  if (!processors.bank && !processors.invoice && !processors.ocr && !processors.form) {
    missing.push("DOCAI_PROCESSOR_ID (or one of DOC_AI_*_PROCESSOR_ID / GCP_*_PROCESSOR_ID)");
  }

  const ready = missing.length === 0;

  return {
    enabled: ENV.enableDocAi,
    ready: ENV.enableDocAi && ready,
    projectId: ENV.gcpProjectId,
    location: ENV.gcpLocation,
    processors,
    credentials: credentials ?? undefined,
    missing,
    reason: !ENV.enableDocAi
      ? "Document AI disabled"
      : ready
        ? undefined
        : "Document AI enabled but not fully configured",
  } satisfies DocumentAiConfig;
}

function loadServiceAccount(): Record<string, unknown> | null {
  // Try GCP_SERVICE_ACCOUNT_JSON first (base64 or plain JSON)
  if (ENV.gcpServiceAccountJson) {
    const parsed = tryParseJson(ENV.gcpServiceAccountJson);
    if (parsed) return parsed;
  }

  // Try GCP_DOCUMENTAI_CREDENTIALS (legacy/env var name)
  if (ENV.gcpCredentialsJson) {
    const parsed = tryParseJson(ENV.gcpCredentialsJson);
    if (parsed) return parsed;
  }

  // Try GCP_SERVICE_ACCOUNT_PATH (file path)
  if (ENV.gcpServiceAccountPath) {
    try {
      if (fs.existsSync(ENV.gcpServiceAccountPath)) {
        const content = fs.readFileSync(ENV.gcpServiceAccountPath, "utf8");
        const parsed = tryParseJson(content);
        if (parsed) return parsed;
      }
    } catch (error) {
      console.warn("Failed to read GCP service account file", error);
    }
  }

  return null;
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

const portSchema = z
  .preprocess(val => (typeof val === "string" ? val.trim() : val), z.string().optional())
  .transform(v => {
    const fallback = process.env.NODE_ENV === "production" ? "8080" : "3000";
    const raw = v && v.length > 0 ? v : fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : Number.parseInt(fallback, 10);
  })
  .refine(p => Number.isInteger(p) && p > 0 && p <= 65535, "PORT must be a valid TCP port");

export interface ServerEnv {
  port: number;
  corsAllowOrigin: string | null;
}

/**
 * Server runtime env for deployment.
 *
 * - In production, defaults PORT to 8080 (Cloud Run convention) if unset.
 * - CORS_ALLOW_ORIGIN is optional; when unset, same-origin requests work.
 */
export function getServerEnv(): ServerEnv {
  return {
    port: portSchema.parse(ENV.port),
    corsAllowOrigin: ENV.corsAllowOrigin?.trim() ? ENV.corsAllowOrigin.trim() : null,
  };
}

/**
 * Fail-fast validation for deployment misconfigurations.
 *
 * We validate Document AI *only when enabled* so production can still boot with
 * ENABLE_DOC_AI=false.
 */
export function assertEnvOnStartup(): void {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;

  // Always validate PORT shape in production.
  getServerEnv();

  const workspaceDomain = process.env.WORKSPACE_DOMAIN?.trim() ?? "";
  const internalServiceAccountsRaw = process.env.INTERNAL_SERVICE_ACCOUNT_EMAILS?.trim() ?? "";
  const hasInternalServiceAccounts = internalServiceAccountsRaw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean).length > 0;

  if (!workspaceDomain && !hasInternalServiceAccounts) {
    throw new Error(
      "Access control misconfigured: WORKSPACE_DOMAIN or INTERNAL_SERVICE_ACCOUNT_EMAILS must be set in production"
    );
  }

  const docAiConfig = getDocumentAiConfig();
  if (docAiConfig.enabled && !docAiConfig.ready) {
    throw new Error(
      `Document AI misconfigured. Missing: ${docAiConfig.missing.join(", ")}`
    );
  }
}

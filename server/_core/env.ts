import fs from "fs";
import { z } from "zod";

/**
 * Reads an env var directly, or falls back to <NAME>_FILE which should contain
 * a filesystem path to a secret (Cloud Run Secret Manager convention).
 */
export function readEnvOrFile(name: string): string {
  const direct = process.env[name];
  if (direct && direct.trim()) return direct;

  const filePath = process.env[`${name}_FILE`];
  if (!filePath || !filePath.trim()) return "";

  try {
    if (!fs.existsSync(filePath)) return "";
    // Trim to remove common trailing newline from secret files.
    return fs.readFileSync(filePath, "utf8").trim();
  } catch (error) {
    console.warn(`Failed to read ${name}_FILE`, error);
    return "";
  }
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

  // Runtime mode
  isProduction: process.env.NODE_ENV === "production",

  // Forge
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",

  // Server
  port: process.env.PORT ?? "",
  corsAllowOrigin: process.env.CORS_ALLOW_ORIGIN ?? "",

  // Project / Location
  gcpProjectId: process.env.GOOGLE_PROJECT_ID ?? process.env.GCP_PROJECT_ID ?? "",

  gcpLocation: process.env.DOCAI_LOCATION ?? process.env.GCP_LOCATION ?? "us",

  // Processors
  docAiProcessorId: process.env.DOCAI_PROCESSOR_ID ?? "",

  gcpBankProcessorId:
    process.env.DOC_AI_BANK_PROCESSOR_ID ??
    process.env.GCP_BANK_PROCESSOR_ID ??
    process.env.DOCAI_PROCESSOR_ID ??
    "",

  gcpInvoiceProcessorId:
    process.env.DOC_AI_INVOICE_PROCESSOR_ID ??
    process.env.GCP_INVOICE_PROCESSOR_ID ??
    process.env.DOCAI_PROCESSOR_ID ??
    "",

  gcpOcrProcessorId:
    process.env.DOC_AI_OCR_PROCESSOR_ID ??
    process.env.GCP_OCR_PROCESSOR_ID ??
    process.env.DOCAI_PROCESSOR_ID ??
    "",

  gcpFormProcessorId:
    process.env.DOC_AI_FORM_PROCESSOR_ID ??
    process.env.GCP_FORM_PROCESSOR_ID ??
    process.env.DOCAI_PROCESSOR_ID ??
    "",

  // Credentials / Secrets
  gcpCredentialsJson: process.env.GCP_DOCUMENTAI_CREDENTIALS ?? "",
  gcpServiceAccountJson: process.env.GCP_SERVICE_ACCOUNT_JSON ?? "",
  gcpServiceAccountPath: process.env.GCP_SERVICE_ACCOUNT_PATH ?? "",

  // Flags
  enableDocAi: process.env.ENABLE_DOC_AI === "true",
};

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

  const docAiConfig = getDocumentAiConfig();
  if (docAiConfig.enabled && !docAiConfig.ready) {
    throw new Error(
      `Document AI misconfigured. Missing: ${docAiConfig.missing.join(", ")}`
    );
  }
}

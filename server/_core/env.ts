import fs from "fs";

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  enableDocAi: (process.env.ENABLE_DOC_AI ?? "false").toLowerCase() === "true",
  gcpProjectId: process.env.GCP_PROJECT_ID ?? "",
  gcpLocation: process.env.GCP_LOCATION ?? "us", // Document AI default location
  docAiBankProcessorId: process.env.DOC_AI_BANK_PROCESSOR_ID ?? "",
  docAiInvoiceProcessorId: process.env.DOC_AI_INVOICE_PROCESSOR_ID ?? "",
  docAiOcrProcessorId: process.env.DOC_AI_OCR_PROCESSOR_ID ?? "",
  docAiFormProcessorId: process.env.DOC_AI_FORM_PROCESSOR_ID ?? "",
  gcpServiceAccountJson: process.env.GCP_SERVICE_ACCOUNT_JSON ?? "",
  gcpServiceAccountPath: process.env.GCP_SERVICE_ACCOUNT_PATH ?? "",
};

export type DocumentAiProcessorType = "bank" | "invoice" | "ocr" | "form";

export interface DocumentAiConfig {
  enabled: boolean;
  ready: boolean;
  projectId: string;
  location: string;
  processors: Partial<Record<DocumentAiProcessorType, string>>;
  credentials?: Record<string, unknown>;
  keyFilePath?: string;
  missing: string[];
  reason?: string;
}

export function getDocumentAiConfig(): DocumentAiConfig {
  const processors: Partial<Record<DocumentAiProcessorType, string>> = {
    bank: ENV.docAiBankProcessorId || undefined,
    invoice: ENV.docAiInvoiceProcessorId || undefined,
    ocr: ENV.docAiOcrProcessorId || undefined,
    form: ENV.docAiFormProcessorId || undefined,
  };

  const { credentials, keyFilePath } = loadServiceAccount();
  const missing: string[] = [];

  if (!ENV.gcpProjectId) missing.push("GCP_PROJECT_ID");
  if (!ENV.gcpLocation) missing.push("GCP_LOCATION");
  if (!credentials) missing.push("GCP_SERVICE_ACCOUNT_JSON or GCP_SERVICE_ACCOUNT_PATH");
  if (!processors.bank && !processors.invoice && !processors.ocr && !processors.form) {
    missing.push("At least one DOC_AI_*_PROCESSOR_ID");
  }

  const ready = missing.length === 0;

  return {
    enabled: ENV.enableDocAi,
    ready: ENV.enableDocAi && ready,
    projectId: ENV.gcpProjectId,
    location: ENV.gcpLocation,
    processors,
    credentials: credentials ?? undefined,
    keyFilePath,
    missing,
    reason: !ENV.enableDocAi
      ? "Document AI disabled"
      : ready
        ? undefined
        : "Document AI enabled but not fully configured",
  } satisfies DocumentAiConfig;
}

function loadServiceAccount(): { credentials: Record<string, unknown> | null; keyFilePath?: string } {
  if (ENV.gcpServiceAccountJson) {
    const parsed = tryParseJson(ENV.gcpServiceAccountJson);
    if (parsed) return { credentials: parsed };
  }

  if (ENV.gcpServiceAccountPath) {
    try {
      if (fs.existsSync(ENV.gcpServiceAccountPath)) {
        const content = fs.readFileSync(ENV.gcpServiceAccountPath, "utf8");
        const parsed = tryParseJson(content);
        if (parsed) return { credentials: parsed, keyFilePath: ENV.gcpServiceAccountPath };
      }
    } catch (error) {
      console.warn("Failed to read GCP service account file", error);
    }
  }

  return { credentials: null };
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

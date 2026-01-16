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
  gcpProjectId: process.env.GCP_PROJECT_ID ?? process.env.GOOGLE_PROJECT_ID ?? "",
  gcpLocation: process.env.GCP_LOCATION ?? process.env.DOCAI_LOCATION ?? "us",
  gcpBankProcessorId: process.env.GCP_BANK_PROCESSOR_ID ?? process.env.DOC_AI_BANK_PROCESSOR_ID ?? "",
  gcpInvoiceProcessorId: process.env.GCP_INVOICE_PROCESSOR_ID ?? process.env.DOC_AI_INVOICE_PROCESSOR_ID ?? "",
  gcpOcrProcessorId: process.env.GCP_OCR_PROCESSOR_ID ?? process.env.DOC_AI_OCR_PROCESSOR_ID ?? "",
  gcpCredentialsJson: process.env.GCP_DOCUMENTAI_CREDENTIALS ?? process.env.GCP_SERVICE_ACCOUNT_JSON ?? "",
  gcpServiceAccountJson: process.env.GCP_SERVICE_ACCOUNT_JSON ?? "",
  gcpServiceAccountPath: process.env.GCP_SERVICE_ACCOUNT_PATH ?? "",
  enableDocAi: process.env.ENABLE_DOC_AI === "true",
  // Aliases for getDocumentAiConfig compatibility
  docAiBankProcessorId: process.env.GCP_BANK_PROCESSOR_ID ?? process.env.DOC_AI_BANK_PROCESSOR_ID ?? "",
  docAiInvoiceProcessorId: process.env.GCP_INVOICE_PROCESSOR_ID ?? process.env.DOC_AI_INVOICE_PROCESSOR_ID ?? "",
  docAiOcrProcessorId: process.env.GCP_OCR_PROCESSOR_ID ?? process.env.DOC_AI_OCR_PROCESSOR_ID ?? "",
  docAiFormProcessorId: process.env.GCP_FORM_PROCESSOR_ID ?? process.env.DOC_AI_FORM_PROCESSOR_ID ?? "",
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
    bank: ENV.docAiBankProcessorId || undefined,
    invoice: ENV.docAiInvoiceProcessorId || undefined,
    ocr: ENV.docAiOcrProcessorId || undefined,
    form: ENV.docAiFormProcessorId || undefined,
  };

  const credentials = loadServiceAccount();
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
    missing,
    reason: !ENV.enableDocAi
      ? "Document AI disabled"
      : ready
        ? undefined
        : "Document AI enabled but not fully configured",
  } satisfies DocumentAiConfig;
}

function loadServiceAccount(): Record<string, unknown> | null {
  if (ENV.gcpServiceAccountJson) {
    const parsed = tryParseJson(ENV.gcpServiceAccountJson);
    if (parsed) return parsed;
  }

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

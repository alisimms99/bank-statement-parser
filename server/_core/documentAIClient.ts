import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { DocumentAiNormalizedDocument, normalizeDocumentAITransactions } from "@shared/normalization";
import type { CanonicalDocument } from "@shared/transactions";
import { DocumentAiProcessorType, getDocumentAiConfig } from "./env";
import { recordIngestMetric } from "./metrics";

type DocumentAiMode = "online" | "batched";

export interface DocumentAiMeta {
  processorType: DocumentAiProcessorType | null;
  mode: DocumentAiMode;
  elapsedMs?: number;
  pageCount?: number;
  transactionCount?: number;
  errorType?: "disabled" | "credentials" | "api" | "parse";
  errorMessage?: string;
  fallbackReason?: string | null;
}

export interface DocumentAiProcessingResult {
  document: CanonicalDocument | null;
  meta: DocumentAiMeta;
  errors?: string[];
}

let cachedClient: DocumentProcessorServiceClient | null = null;

export function getDocumentAiClient(): DocumentProcessorServiceClient | null {
  const config = getDocumentAiConfig();
  if (!config.enabled || !config.ready) return null;

  if (cachedClient) return cachedClient;

  const apiEndpoint = `${config.location}-documentai.googleapis.com`;

  cachedClient = new DocumentProcessorServiceClient({
    apiEndpoint,
    credentials: config.credentials,
    keyFilename: config.keyFilePath,
  });
  return cachedClient;
}

export async function processWithDocumentAI(
  fileBuffer: Buffer,
  documentType: CanonicalDocument["documentType"]
): Promise<DocumentAiProcessingResult> {
  const config = getDocumentAiConfig();
  const processorType = mapDocTypeToProcessor(documentType);
  const baseMeta: DocumentAiMeta = {
    processorType,
    mode: fileBuffer.byteLength > 10 * 1024 * 1024 ? "batched" : "online",
  };

  if (!config.enabled) {
    return {
      document: null,
      meta: { ...baseMeta, errorType: "disabled", fallbackReason: "disabled", errorMessage: config.reason },
      errors: ["Document AI disabled"],
    };
  }

  if (!config.ready) {
    console.warn("Document AI enabled but missing configuration", { missing: config.missing });
    return {
      document: null,
      meta: {
        ...baseMeta,
        errorType: "credentials",
        fallbackReason: "missing_credentials",
        errorMessage: config.missing.join(", "),
      },
      errors: ["Document AI configuration incomplete"],
    };
  }

  const client = getDocumentAiClient();
  const processorId = resolveProcessorId(config, processorType);
  if (!client || !processorId) {
    return {
      document: null,
      meta: { ...baseMeta, errorType: "credentials", fallbackReason: "missing_processor" },
      errors: ["Missing processor configuration"],
    };
  }

  const name = buildProcessorName(config.projectId, config.location, processorId);

  const requestContent = buildRawDocument(fileBuffer);
  const mode = requestContent.mode;

  console.info("[docai] processing started", {
    processorType,
    mode,
    location: config.location,
    projectId: config.projectId,
    sizeKb: Math.round(fileBuffer.byteLength / 1024),
  });

  const started = Date.now();

  try {
    const [result] = await client.processDocument({
      name,
      rawDocument: requestContent.rawDocument,
      skipHumanReview: true,
    });

    const normalizedDoc: DocumentAiNormalizedDocument = {
      entities: result.document?.entities?.map(entity => ({
        type: entity.type,
        mentionText: entity.mentionText,
        confidence: entity.confidence,
        normalizedValue: entity.normalizedValue
          ? {
              text: entity.normalizedValue.text,
              dateValue: (entity.normalizedValue as any).dateValue,
              moneyValue: (entity.normalizedValue as any).moneyValue,
            }
          : undefined,
        properties: entity.properties?.map(prop => ({
          type: prop.type,
          mentionText: prop.mentionText,
          confidence: prop.confidence,
          normalizedValue: prop.normalizedValue
            ? {
                text: prop.normalizedValue.text,
                dateValue: (prop.normalizedValue as any).dateValue,
                moneyValue: (prop.normalizedValue as any).moneyValue,
              }
            : undefined,
        })),
      })),
      text: result.document?.text,
    };

    const transactions = normalizeDocumentAITransactions(normalizedDoc, documentType);
    const elapsedMs = Date.now() - started;
    const pageCount = result.document?.pages?.length ?? result.document?.pageCount ?? undefined;

    console.info("[docai] processing finished", {
      processorType,
      mode,
      elapsedMs,
      pageCount,
      transactionCount: transactions.length,
    });

    recordIngestMetric({
      source: "documentai",
      durationMs: elapsedMs,
      documentType,
      timestamp: Date.now(),
      fallbackReason: null,
    });

    return {
      document: {
        documentType,
        transactions,
        rawText: normalizedDoc.text,
        warnings: transactions.length === 0 ? ["No transactions returned from Document AI"] : undefined,
      } satisfies CanonicalDocument,
      meta: {
        ...baseMeta,
        mode,
        elapsedMs,
        pageCount,
        transactionCount: transactions.length,
      },
    };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const classified = classifyDocumentAiError(error);
    console.warn("[docai] processing failed", { mode, processorType, elapsedMs, error: maskError(error) });

    recordIngestMetric({
      source: "error",
      durationMs: elapsedMs,
      documentType,
      timestamp: Date.now(),
      fallbackReason: classified.fallbackReason ?? "docai_error",
    });

    return {
      document: null,
      meta: {
        ...baseMeta,
        mode,
        elapsedMs,
        errorType: classified.type,
        errorMessage: classified.message,
        fallbackReason: classified.fallbackReason,
      },
      errors: [classified.message],
    };
  }
}

function buildRawDocument(fileBuffer: Buffer) {
  const TEN_MB = 10 * 1024 * 1024;
  const base64Content = fileBuffer.toString("base64");

  return {
    mode: fileBuffer.byteLength > TEN_MB ? "batched" : "online",
    rawDocument: {
      content: base64Content,
      mimeType: "application/pdf",
    },
  } as const;
}

function resolveProcessorId(config: ReturnType<typeof getDocumentAiConfig>, preferred: DocumentAiProcessorType): string | null {
  const { processors } = config;
  return (
    processors[preferred] || processors.ocr || processors.bank || processors.invoice || processors.form || null
  );
}

function buildProcessorName(projectId: string, location: string, processorId: string): string {
  return `projects/${projectId}/locations/${location}/processors/${processorId}`;
}

function mapDocTypeToProcessor(documentType: CanonicalDocument["documentType"]): DocumentAiProcessorType {
  if (documentType === "invoice") return "invoice";
  if (documentType === "receipt") return "ocr";
  return "bank";
}

function maskError(error: unknown) {
  if (!error) return error;
  if (typeof error === "string") return error;
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return error;
}

function classifyDocumentAiError(error: unknown): {
  type: DocumentAiMeta["errorType"];
  message: string;
  fallbackReason?: string;
} {
  const fallbackReason = "docai_error";
  if (!error) return { type: "api", message: "Unknown Document AI error", fallbackReason };

  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "Unknown error";
  const lower = message.toLowerCase();

  if (lower.includes("permission") || lower.includes("unauthorized") || lower.includes("credential")) {
    return { type: "credentials", message, fallbackReason: "auth" };
  }

  if (lower.includes("parse") || lower.includes("invalid argument")) {
    return { type: "parse", message, fallbackReason };
  }

  return { type: "api", message, fallbackReason };
}

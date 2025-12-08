import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { DocumentAiNormalizedDocument, normalizeDocumentAITransactions } from "@shared/normalization";
import type { CanonicalDocument } from "@shared/transactions";
import type { DocumentAiTelemetry } from "@shared/types";
import { DocumentAiProcessorType, getDocumentAiConfig } from "./env";

let cachedClient: DocumentProcessorServiceClient | null = null;

export function getDocumentAiClient(): DocumentProcessorServiceClient | null {
  const config = getDocumentAiConfig();
  if (!config.enabled || !config.ready || !config.credentials) return null;

  if (cachedClient) return cachedClient;
  cachedClient = new DocumentProcessorServiceClient({ credentials: config.credentials });
  return cachedClient;
}

export interface DocumentAiProcessResult {
  document: CanonicalDocument | null;
  telemetry: DocumentAiTelemetry;
}

export async function processWithDocumentAI(
  fileBuffer: Buffer,
  documentType: CanonicalDocument["documentType"]
): Promise<DocumentAiProcessResult> {
  const config = getDocumentAiConfig();
  if (!config.enabled || !config.ready || !config.credentials) {
    if (config.enabled && !config.ready) {
      console.warn("Document AI enabled but missing configuration", { missing: config.missing });
    }
    return {
      document: null,
      telemetry: {
        enabled: config.enabled,
        processor: null,
        latencyMs: null,
        entityCount: 0,
      },
    } satisfies DocumentAiProcessResult;
  }

  const client = getDocumentAiClient();
  const processorId = resolveProcessorId(config, mapDocTypeToProcessor(documentType));
  if (!client || !processorId) {
    return {
      document: null,
      telemetry: {
        enabled: config.enabled,
        processor: processorId ?? null,
        latencyMs: null,
        entityCount: 0,
      },
    } satisfies DocumentAiProcessResult;
export interface DocumentAIError {
  code: "disabled" | "not_configured" | "no_processor" | "api_error" | "processing_error";
  message: string;
  details?: unknown;
  processorId?: string;
}

export interface DocumentAIResult {
  success: true;
  document: CanonicalDocument;
  processorId: string;
  processorType: DocumentAiProcessorType;
}

export type DocumentAIResponse = DocumentAIResult | { success: false; error: DocumentAIError };

export async function processWithDocumentAI(
  fileBuffer: Buffer,
  documentType: CanonicalDocument["documentType"]
): Promise<CanonicalDocument | null> {
  const result = await processWithDocumentAIStructured(fileBuffer, documentType);
  
  if (result.success) {
    return result.document;
  }
  
  // Log error for debugging
  console.error("Document AI processing failed", {
    code: result.error.code,
    message: result.error.message,
    processorId: result.error.processorId,
    details: result.error.details,
  });
  
  return null;
}

export async function processWithDocumentAIStructured(
  fileBuffer: Buffer,
  documentType: CanonicalDocument["documentType"]
): Promise<DocumentAIResponse> {
  const config = getDocumentAiConfig();
  
  // Check feature toggle
  if (!config.enabled) {
    return {
      success: false,
      error: {
        code: "disabled",
        message: "Document AI is disabled via ENABLE_DOC_AI=false",
      },
    };
  }

  // Check configuration completeness
  if (!config.ready || !config.credentials) {
    return {
      success: false,
      error: {
        code: "not_configured",
        message: "Document AI enabled but missing configuration",
        details: { missing: config.missing },
      },
    };
  }

  const client = getDocumentAiClient();
  if (!client) {
    return {
      success: false,
      error: {
        code: "not_configured",
        message: "Failed to create Document AI client",
        details: { missing: config.missing },
      },
    };
  }

  const processorType = mapDocTypeToProcessor(documentType);
  const processorId = resolveProcessorId(config, processorType);
  
  if (!processorId) {
    return {
      success: false,
      error: {
        code: "no_processor",
        message: `No processor available for document type: ${documentType}`,
        details: { 
          documentType,
          availableProcessors: Object.keys(config.processors),
        },
      },
    };
  }

  const name = buildProcessorName(config.projectId, config.location, processorId);
  const start = Date.now();

  // Log processor selection for debug panel
  console.log(`[Document AI] Processing ${documentType} with processor: ${processorId} (type: ${processorType})`);

  try {
    const [result] = await client.processDocument({
      name,
      rawDocument: {
        content: fileBuffer.toString("base64"),
        mimeType: "application/pdf",
      },
    });

    const normalizedDoc: DocumentAiNormalizedDocument = {
      entities: result.document?.entities?.map(entity => ({
        type: entity.type ?? undefined,
        mentionText: entity.mentionText ?? undefined,
        confidence: entity.confidence ?? undefined,
        normalizedValue: entity.normalizedValue
          ? {
              text: entity.normalizedValue.text ?? undefined,
              dateValue: (entity.normalizedValue as any).dateValue,
              moneyValue: (entity.normalizedValue as any).moneyValue,
            }
          : undefined,
        properties: entity.properties?.map(prop => ({
          type: prop.type ?? undefined,
          mentionText: prop.mentionText ?? undefined,
          confidence: prop.confidence ?? undefined,
          normalizedValue: prop.normalizedValue
            ? {
                text: prop.normalizedValue.text ?? undefined,
                dateValue: (prop.normalizedValue as any).dateValue,
                moneyValue: (prop.normalizedValue as any).moneyValue,
              }
            : undefined,
        })),
      })),
      text: result.document?.text ?? undefined,
    };

    const transactions = normalizeDocumentAITransactions(normalizedDoc, documentType);

    const latencyMs = Date.now() - start;
    const entityCount = result.document?.entities?.length ?? 0;

    return {
      document: {
        documentType,
        transactions,
        rawText: normalizedDoc.text,
        warnings: transactions.length === 0 ? ["No transactions returned from Document AI"] : undefined,
      } satisfies CanonicalDocument,
      telemetry: {
        enabled: config.enabled,
        processor: processorId,
        latencyMs,
        entityCount,
      },
    } satisfies DocumentAiProcessResult;
  } catch (error) {
    console.error("Document AI processing failed", error);
    return {
      document: null,
      telemetry: {
        enabled: config.enabled,
        processor: processorId,
        latencyMs: Date.now() - start,
        entityCount: 0,
      },
    } satisfies DocumentAiProcessResult;
    const document: CanonicalDocument = {
      documentType,
      transactions,
      rawText: normalizedDoc.text,
      warnings: transactions.length === 0 ? ["No transactions returned from Document AI"] : undefined,
    };

    return {
      success: true,
      document,
      processorId,
      processorType,
    };
  } catch (error) {
    // Handle API errors
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const isApiError = error instanceof Error && (
      errorMessage.includes("permission") ||
      errorMessage.includes("authentication") ||
      errorMessage.includes("quota") ||
      errorMessage.includes("not found")
    );

    return {
      success: false,
      error: {
        code: isApiError ? "api_error" : "processing_error",
        message: `Document AI processing failed: ${errorMessage}`,
        details: error,
        processorId,
      },
    };
  }
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

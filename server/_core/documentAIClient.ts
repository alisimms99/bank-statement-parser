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
  documentType: CanonicalDocument["documentType"],
  fileName?: string
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

  // Log processor selection and config for debug panel
  console.log(`[Document AI] Processing ${documentType} with processor: ${processorId} (type: ${processorType})`);
  console.log(`[Document AI] Config:`, {
    enabled: config.enabled,
    ready: config.ready,
    projectId: config.projectId,
    location: config.location,
    processorName: name,
    hasCredentials: !!config.credentials,
    availableProcessors: Object.keys(config.processors),
  });

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

    // Extract year from filename if provided (e.g., "STATEMENTS,September2024-8704.pdf" -> "2024")
    let defaultYear: number | undefined;
    if (fileName) {
      const yearMatch = fileName.match(/(20\d{2})/);
      if (yearMatch) {
        defaultYear = parseInt(yearMatch[1], 10);
      }
    }
    
    const transactions = normalizeDocumentAITransactions(normalizedDoc, documentType, defaultYear, fileName);
    const processingTime = Date.now() - start;

    // Log processing results
    console.log(`[Document AI] Processing completed:`, {
      processorId,
      processorType,
      documentType,
      entityCount: normalizedDoc.entities?.length ?? 0,
      transactionCount: transactions.length,
      processingTimeMs: processingTime,
      hasText: !!normalizedDoc.text,
      textLength: normalizedDoc.text?.length ?? 0,
    });

    if (transactions.length === 0) {
      // Log detailed entity information to help debug why transactions weren't extracted
      const entityTypes = normalizedDoc.entities?.map(e => e.type).filter((t): t is string => Boolean(t)) ?? [];
      const entityTypeCounts = entityTypes.reduce((acc, type) => {
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      // Sample a few entities to see their structure
      const sampleEntities = normalizedDoc.entities?.slice(0, 3).map(e => ({
        type: e.type,
        mentionText: e.mentionText?.substring(0, 100), // Truncate for logging
        hasProperties: !!e.properties,
        propertyTypes: e.properties?.map(p => p.type).filter(Boolean),
        normalizedValue: e.normalizedValue ? {
          text: e.normalizedValue.text,
          hasMoneyValue: !!e.normalizedValue.moneyValue,
          hasDateValue: !!e.normalizedValue.dateValue,
        } : null,
      })) ?? [];

      console.warn(`[Document AI] No transactions extracted from document:`, {
        processorId,
        documentType,
        entityCount: normalizedDoc.entities?.length ?? 0,
        entityTypes: entityTypes.slice(0, 20), // Show first 20 types
        entityTypeCounts,
        tableItemCount: entityTypes.filter(t => t?.toLowerCase().includes("table_item")).length,
        sampleEntities,
        hasText: !!normalizedDoc.text,
      });
    }

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
    // Handle API errors with detailed logging
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;
    const isApiError = error instanceof Error && (
      errorMessage.includes("permission") ||
      errorMessage.includes("authentication") ||
      errorMessage.includes("quota") ||
      errorMessage.includes("not found")
    );

    // Log detailed error information
    console.error("[Document AI] Processing failed:", {
      processorId,
      processorType,
      processorName: name,
      documentType,
      errorMessage,
      errorName: error instanceof Error ? error.name : "Unknown",
      errorStack,
      errorDetails: error instanceof Error ? {
        code: (error as any).code,
        status: (error as any).status,
        statusCode: (error as any).statusCode,
        response: (error as any).response,
      } : error,
      isApiError,
    });

    return {
      success: false,
      error: {
        code: isApiError ? "api_error" : "processing_error",
        message: `Document AI processing failed: ${errorMessage}`,
        details: {
          errorMessage,
          errorName: error instanceof Error ? error.name : "Unknown",
          errorStack,
          ...(error instanceof Error && (error as any).code ? { code: (error as any).code } : {}),
          ...(error instanceof Error && (error as any).status ? { status: (error as any).status } : {}),
          ...(error instanceof Error && (error as any).statusCode ? { statusCode: (error as any).statusCode } : {}),
        },
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

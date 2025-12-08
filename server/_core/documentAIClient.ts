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
  }

  const name = buildProcessorName(config.projectId, config.location, processorId);
  const start = Date.now();

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

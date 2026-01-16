import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { DocumentAiNormalizedDocument, normalizeDocumentAITransactions } from "@shared/normalization";
import type { CanonicalDocument } from "@shared/transactions";
import { DocumentAiProcessorType, getDocumentAiConfig } from "./env";

let cachedClient: DocumentProcessorServiceClient | null = null;

export function getDocumentAiClient(): DocumentProcessorServiceClient | null {
  const config = getDocumentAiConfig();
  if (!config.enabled || !config.ready || !config.credentials) return null;

  if (cachedClient) return cachedClient;
  cachedClient = new DocumentProcessorServiceClient({ credentials: config.credentials });
  return cachedClient;
}

export async function processWithDocumentAI(
  fileBuffer: Buffer,
  documentType: CanonicalDocument["documentType"]
): Promise<CanonicalDocument | null> {
  const config = getDocumentAiConfig();
  if (!config.enabled || !config.ready || !config.credentials) {
    if (config.enabled && !config.ready) {
      console.warn("Document AI enabled but missing configuration", { missing: config.missing });
    }
    return null;
  }

  const client = getDocumentAiClient();
  const processorId = resolveProcessorId(config, mapDocTypeToProcessor(documentType));
  if (!client || !processorId) return null;

  const name = buildProcessorName(config.projectId, config.location, processorId);

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

    return {
      documentType,
      transactions,
      rawText: normalizedDoc.text,
      warnings: transactions.length === 0 ? ["No transactions returned from Document AI"] : undefined,
    } satisfies CanonicalDocument;
  } catch (error) {
    console.error("Document AI processing failed", error);
    return null;
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

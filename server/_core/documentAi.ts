import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { ENV } from "./env";
import { CanonicalDocument } from "@shared/transactions";
import { DocumentAiNormalizedDocument, normalizeDocumentAITransactions } from "@shared/normalization";

function createClient(): DocumentProcessorServiceClient | null {
  if (!ENV.gcpProjectId || !ENV.gcpLocation) {
    return null;
  }

  const credentials = parseCredentials();
  return new DocumentProcessorServiceClient({ credentials });
}

function parseCredentials(): Record<string, unknown> | undefined {
  if (!ENV.gcpCredentialsJson) return undefined;
  try {
    const decoded = Buffer.from(ENV.gcpCredentialsJson, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    try {
      return JSON.parse(ENV.gcpCredentialsJson);
    } catch {
      return undefined;
    }
  }
}

function buildProcessorName(processorId: string): string {
  return `projects/${ENV.gcpProjectId}/locations/${ENV.gcpLocation}/processors/${processorId}`;
}

export async function processWithDocumentAI(
  fileBuffer: Buffer,
  documentType: CanonicalDocument["documentType"]
): Promise<CanonicalDocument | null> {
  const processorId = pickProcessorId(documentType);
  const client = createClient();

  if (!processorId || !client) return null;

  const name = buildProcessorName(processorId);

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
      confidence: entity.confidence,
      normalizedValue: entity.normalizedValue
        ? {
            text: entity.normalizedValue.text,
            dateValue: (entity.normalizedValue as any).dateValue,
            moneyValue: (entity.normalizedValue as any).moneyValue,
          }
        : undefined,
      properties: entity.properties?.map(prop => ({
        type: prop.type ?? undefined,
        mentionText: prop.mentionText ?? undefined,
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

  return {
    documentType,
    transactions,
    rawText: normalizedDoc.text,
    warnings: transactions.length === 0 ? ["No transactions returned from Document AI"] : undefined,
  } satisfies CanonicalDocument;
}

function pickProcessorId(documentType: CanonicalDocument["documentType"]): string | null {
  if (documentType === "bank_statement" && ENV.gcpBankProcessorId) return ENV.gcpBankProcessorId;
  if (documentType === "invoice" && ENV.gcpInvoiceProcessorId) return ENV.gcpInvoiceProcessorId;
  if (ENV.gcpOcrProcessorId) return ENV.gcpOcrProcessorId;
  return null;
}

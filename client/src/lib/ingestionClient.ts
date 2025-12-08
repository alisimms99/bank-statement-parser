import type { CanonicalDocument } from "@shared/transactions";
import type { DocumentAiTelemetry, IngestionSource } from "@shared/types";

export interface IngestionResult {
  document: CanonicalDocument | null;
  source: IngestionSource;
  error?: string;
  fallback?: string;
  docAiTelemetry?: DocumentAiTelemetry;
  exportId?: string;
}

export async function ingestWithDocumentAI(
  file: File,
  documentType: CanonicalDocument["documentType"] = "bank_statement"
): Promise<IngestionResult> {
  const contentBase64 = await fileToBase64(file);

  try {
    const response = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        contentBase64,
        documentType,
      }),
    });

    const payload = await response.json();

    if (response.ok && payload.document) {
      return {
        document: payload.document as CanonicalDocument,
        source: (payload.source ?? "documentai") as IngestionSource,
        error: payload.error,
        fallback: payload.fallback,
        docAiTelemetry: payload.docAiTelemetry as DocumentAiTelemetry | undefined,
        exportId: payload.exportId,
      };
    }

    const normalizedError =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message ?? "Unknown error";

    return {
      document: null,
      source: (payload.source ?? "legacy") as IngestionSource,
      error: normalizedError,
      fallback: payload.fallback,
      docAiTelemetry: payload.docAiTelemetry as DocumentAiTelemetry | undefined,
      exportId: payload.exportId,
    };
  } catch (error: any) {
    return {
      document: null,
      source: "error" as IngestionSource,
      error: error?.message ?? "Unknown error",
      fallback: undefined,
      docAiTelemetry: undefined,
      exportId: undefined,
    };
  }
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach(b => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

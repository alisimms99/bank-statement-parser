import type { CanonicalDocument } from "@shared/transactions";
import type { DocumentAITelemetry } from "@shared/types";

export type IngestionSource = "documentai" | "legacy" | "error";

export interface IngestionResult {
  document: CanonicalDocument | null;
  source: IngestionSource;
  error?: string;
  fallback?: string;
  docAiTelemetry?: DocumentAITelemetry;
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

    const source = (payload.source as IngestionSource | undefined) ?? "documentai";
    const docAiTelemetry = payload.docAiTelemetry as DocumentAITelemetry | undefined;
    const fallback = payload.fallback as string | undefined;
    const exportId = payload.exportId as string | undefined;

    if (response.ok && payload.document) {
      return {
        document: payload.document as CanonicalDocument,
        source,
        fallback,
        docAiTelemetry,
        exportId,
      };
    }

    const normalizedError =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message ?? "Unknown error";

    return {
      document: (payload.document as CanonicalDocument | null | undefined) ?? null,
      source: (payload.source as IngestionSource | undefined) ?? "legacy",
      error: normalizedError,
      fallback,
      docAiTelemetry,
      exportId,
    };
  } catch (error: any) {
    return { document: null, source: "error", error: error?.message ?? "Unknown error" };
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

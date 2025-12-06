import type { CanonicalDocument } from "@shared/transactions";

export interface IngestionResult {
  document: CanonicalDocument | null;
  source: "documentai" | "legacy" | "unavailable" | "error";
  fallback?: string | null;
  errors?: string[];
  error?: string;
}

export async function ingestWithDocumentAI(
  file: File,
  documentType: CanonicalDocument["documentType"] = "bank_statement"
): Promise<IngestionResult> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("fileName", file.name);
    formData.append("documentType", documentType);

    const response = await fetch("/api/ingest", { method: "POST", body: formData });

    const payload = await response.json();

    if (response.ok && payload.document) {
      return {
        document: payload.document as CanonicalDocument,
        source: payload.source ?? "documentai",
        fallback: payload.fallback,
        errors: payload.errors,
      };
    }

    return {
      document: payload.document ?? null,
      source: payload.source ?? "unavailable",
      fallback: payload.fallback,
      errors: payload.errors,
      error: payload.error,
    };
  } catch (error: any) {
    return { document: null, source: "error", error: error?.message ?? "Unknown error" };
  }
}

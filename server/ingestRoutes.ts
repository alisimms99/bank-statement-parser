import type { Express } from "express";
import { z } from "zod";
import { processWithDocumentAI } from "./_core/documentAi";
import { normalizeLegacyTransactions } from "@shared/normalization";
import type { CanonicalDocument } from "@shared/transactions";

const ingestSchema = z.object({
  fileName: z.string(),
  contentBase64: z.string(),
  documentType: z.enum(["bank_statement", "invoice", "receipt"]).default("bank_statement"),
});

export function registerIngestionRoutes(app: Express) {
  app.post("/api/ingest", async (req, res) => {
    const parsed = ingestSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { fileName, contentBase64, documentType } = parsed.data;

    try {
      const buffer = Buffer.from(contentBase64, "base64");
      const document = await processWithDocumentAI(buffer, documentType);

      if (document) {
        return res.json({ source: "documentai", document });
      }

      // No Document AI available; echo back for client-side fallback normalization
      const legacyDoc: CanonicalDocument = {
        documentType,
        transactions: normalizeLegacyTransactions([]),
        warnings: ["Document AI unavailable; client fallback required"],
        rawText: undefined,
      };

      return res.status(503).json({ source: "unavailable", document: legacyDoc });
    } catch (error) {
      console.error("Error processing ingestion", { fileName, documentType, error });
      return res.status(500).json({ error: "Failed to ingest document", fallback: "legacy" });
    }
  });
}

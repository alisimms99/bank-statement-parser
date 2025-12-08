import type { Express } from "express";
import { z } from "zod";
import { tryDocumentAI } from "./core/documentAIClient";
import { normalizeLegacyTransactions } from "@shared/normalization";
import type { CanonicalDocument } from "@shared/transactions";
import { toCanonical } from "@shared/transactions";

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
      
      // Try Document AI stub first
      const docAIResult = await tryDocumentAI(buffer);

      if (docAIResult.source === "docai" && docAIResult.transactions.length > 0) {
        // Document AI succeeded - return normalized transactions
        // Convert NormalizedTransaction to CanonicalTransaction
        const canonicalTransactions = docAIResult.transactions.map(toCanonical);
        
        const document: CanonicalDocument = {
          documentType,
          transactions: canonicalTransactions,
          warnings: [],
          rawText: undefined,
        };

        console.log(`[Ingestion] Document AI succeeded for ${fileName}: ${docAIResult.transactions.length} transactions`);
        return res.json({ source: "documentai", document });
      }

      // Document AI failed or returned no transactions - signal fallback needed
      console.log(`[Ingestion] Document AI fallback triggered for ${fileName}`);
      
      const legacyDoc: CanonicalDocument = {
        documentType,
        transactions: normalizeLegacyTransactions([]),
        warnings: ["Document AI unavailable; client fallback required"],
        rawText: undefined,
      };

      return res.status(503).json({ source: "fallback", document: legacyDoc });
    } catch (error) {
      console.error("Error processing ingestion", { fileName, documentType, error });
      return res.status(500).json({ error: "Failed to ingest document", fallback: "legacy" });
    }
  });
}

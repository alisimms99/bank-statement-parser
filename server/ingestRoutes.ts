import type { Express } from "express";
import { z } from "zod";
import { processWithDocumentAI } from "./_core/documentAIClient";
import { getDocumentAiConfig, ENV } from "./_core/env";
import { cleanTransactionsWithLLM } from "./_core/transactionCleanup";
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

      // Check Document AI configuration status
      const docAiConfig = getDocumentAiConfig();
      console.log(`[DocAI] Configuration status: enabled=${docAiConfig.enabled}, ready=${docAiConfig.ready}`);
      if (!docAiConfig.ready && docAiConfig.missing.length > 0) {
        console.log(`[DocAI] Missing configuration: ${docAiConfig.missing.join(", ")}`);
      }

      // Try real Document AI processor
      console.log(`[DocAI] Calling real Document AI processor for ${fileName}...`);
      const docAIResult = await processWithDocumentAI(buffer, documentType);

      if (docAIResult && docAIResult.transactions.length > 0) {
        // Document AI succeeded - apply LLM cleanup
        console.log(`[DocAI] Document AI succeeded for ${fileName}: ${docAIResult.transactions.length} transactions`);

        // Apply LLM cleanup if configured
        console.log(`[LLM] OpenAI key configured: ${!!ENV.forgeApiKey}`);
        let finalTransactions = docAIResult.transactions;
        try {
          if (ENV.forgeApiKey) {
            finalTransactions = await cleanTransactionsWithLLM(docAIResult.transactions);
          }
        } catch (llmError) {
          console.error("[LLM] OpenAI cleanup failed, using unfiltered transactions:", llmError);
        }

        const cleanedDocument: CanonicalDocument = {
          ...docAIResult,
          transactions: finalTransactions,
        };

        return res.json({ source: "documentai", document: cleanedDocument });
      }

      // Document AI failed or returned no transactions - signal fallback needed
      console.log(`[DocAI] Document AI returned no transactions for ${fileName}, triggering fallback`);

      const legacyDoc: CanonicalDocument = {
        documentType,
        transactions: normalizeLegacyTransactions([]),
        warnings: docAIResult?.warnings || ["Document AI unavailable; client fallback required"],
        rawText: docAIResult?.rawText,
      };

      return res.status(503).json({ source: "fallback", document: legacyDoc });
    } catch (error) {
      console.error("[DocAI] Error processing ingestion", { fileName, documentType, error });
      return res.status(500).json({ error: "Failed to ingest document", fallback: "legacy" });
    }
  });
}

import type { Express, Request } from "express";
import multer from "multer";
import { z } from "zod";

import { processWithDocumentAI } from "./_core/documentAIClient";
import { getDocumentAiConfig } from "./_core/env";
import { legacyTransactionsToCanonical, parseStatementText } from "../client/src/lib/pdfParser";
import type { CanonicalDocument } from "@shared/transactions";

const upload = multer({ storage: multer.memoryStorage() });

const documentTypeSchema = z.enum(["bank_statement", "invoice", "receipt"]);

function extractUpload(req: Request): { buffer: Buffer; fileName: string } | null {
  if (req.file?.buffer) {
    return { buffer: req.file.buffer, fileName: req.file.originalname ?? "upload.pdf" };
  }

  const { contentBase64, fileName } = req.body ?? {};
  if (typeof contentBase64 === "string" && contentBase64.trim().length > 0) {
    try {
      return { buffer: Buffer.from(contentBase64, "base64"), fileName: fileName ?? "upload.pdf" };
    } catch (error) {
      return null;
    }
  }

  return null;
}

export function registerIngestionRoutes(app: Express) {
  app.post("/api/ingest", upload.single("file"), async (req, res) => {
    const upload = extractUpload(req);
    if (!upload) {
      return res.status(400).json({ error: "Invalid request", details: "Missing upload payload" });
    }

    const parseResult = documentTypeSchema.safeParse(req.body?.documentType ?? "bank_statement");
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid request", details: parseResult.error.flatten() });
    }

    const documentType = parseResult.data;
    const { buffer, fileName } = upload;

    try {
      const docAiConfig = getDocumentAiConfig();

      if (docAiConfig.enabled) {
        const docAIResult = await processWithDocumentAI(buffer, documentType);
        if (docAIResult) {
          console.log(
            `[Ingestion] Document AI succeeded for ${fileName}: ${docAIResult.transactions.length} transactions`
          );
          return res.status(200).json({ source: "documentai", document: docAIResult });
        }
      }

      const fallbackReason = docAiConfig.enabled ? "failed" : "disabled";
      const rawText = buffer.toString("utf8");
      const legacyTransactions = parseStatementText(rawText);
      const canonicalTransactions = legacyTransactionsToCanonical(legacyTransactions);

      const legacyDoc: CanonicalDocument = {
        documentType,
        transactions: canonicalTransactions,
        warnings:
          fallbackReason === "failed"
            ? ["Document AI unavailable; legacy parser used"]
            : ["Document AI disabled; legacy parser used"],
        rawText,
      };

      console.log(`[Ingestion] Document AI fallback triggered for ${fileName} (${fallbackReason})`);

      return res.status(200).json({ source: "legacy", fallback: fallbackReason, document: legacyDoc });
    } catch (error) {
      console.error("Error processing ingestion", { fileName, documentType, error });
      return res.status(500).json({ error: "Failed to ingest document", fallback: "legacy" });
    }
  });
}

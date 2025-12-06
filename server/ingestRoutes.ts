import type { Express } from "express";
import multer from "multer";
import * as pdfjsLib from "pdfjs-dist";
import { z } from "zod";
import { processWithDocumentAI } from "./_core/documentAIClient";
import { normalizeLegacyTransactions } from "@shared/normalization";
import type { CanonicalDocument } from "@shared/transactions";
import { getDocumentAiConfig } from "./_core/env";
import { legacyTransactionsToCanonical, parseStatementText } from "../client/src/lib/pdfParser";
import { recordIngestMetric } from "./_core/metrics";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const ingestSchema = z.object({
  fileName: z.string().optional(),
  contentBase64: z.string().optional(),
  documentType: z.enum(["bank_statement", "invoice", "receipt"]).default("bank_statement"),
});

export function registerIngestionRoutes(app: Express) {
  app.post("/api/ingest", upload.single("file"), async (req, res) => {
    const parsed = ingestSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { fileName, contentBase64, documentType } = parsed.data;

    const fileBuffer = req.file?.buffer || (contentBase64 ? Buffer.from(contentBase64, "base64") : null);

    if (!fileBuffer) {
      return res.status(400).json({ error: "Missing file content" });
    }

    const docAiConfig = getDocumentAiConfig();
    const ingestStarted = Date.now();

    try {
      const docResult = await processWithDocumentAI(fileBuffer, documentType);

      if (docResult.document) {
        return res.json({
          source: "documentai",
          document: docResult.document,
          fallback: docAiConfig.ready ? null : docAiConfig.reason ?? "disabled",
          meta: docResult.meta,
          errors: docResult.errors,
        });
      }
      const fallbackReason = docResult.meta.fallbackReason ?? docResult.meta.errorType ?? "failed";
      const legacyDoc = await parseLegacyDocument(fileBuffer, documentType, fileName ?? "uploaded.pdf");

      recordIngestMetric({
        source: "legacy",
        durationMs: Date.now() - ingestStarted,
        documentType,
        timestamp: Date.now(),
        fallbackReason,
      });

      return res.json({
        source: "legacy",
        document: legacyDoc,
        fallback: docAiConfig.enabled ? (docAiConfig.ready ? fallbackReason : "missing_credentials") : "disabled",
        errors: docResult.errors,
        meta: docResult.meta,
      });
    } catch (error) {
      console.error("Error processing ingestion", { fileName, documentType, error });
      recordIngestMetric({
        source: "error",
        durationMs: Date.now() - ingestStarted,
        documentType,
        timestamp: Date.now(),
        fallbackReason: "exception",
      });
      return res.status(500).json({ error: "Failed to ingest document", fallback: "legacy" });
    }
  });
}

async function parseLegacyDocument(
  fileBuffer: Buffer,
  documentType: CanonicalDocument["documentType"],
  fileName: string
): Promise<CanonicalDocument> {
  try {
    const text = await extractTextFromPdfBuffer(fileBuffer);
    const legacyTransactions = parseStatementText(text);
    const transactions = legacyTransactionsToCanonical(legacyTransactions);

    return {
      documentType,
      transactions,
      rawText: text,
      warnings: transactions.length === 0 ? ["Legacy parser returned no transactions"] : undefined,
    } satisfies CanonicalDocument;
  } catch (error) {
    console.error("Legacy parsing failed", { fileName, error });
    return {
      documentType,
      transactions: normalizeLegacyTransactions([]),
      rawText: undefined,
      warnings: ["Legacy parser failed; no transactions extracted"],
    } satisfies CanonicalDocument;
  }
}

async function extractTextFromPdfBuffer(fileBuffer: Buffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: fileBuffer }).promise;
  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(" ");
    fullText += pageText + "\n";
  }

  return fullText;
}

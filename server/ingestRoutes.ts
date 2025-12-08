import type { Express, Request } from "express";
import multer from "multer";
import { z } from "zod";
import { processWithDocumentAI, processWithDocumentAIStructured } from "./_core/documentAIClient";
import { getDocumentAiConfig } from "./_core/env";
import { normalizeLegacyTransactions } from "@shared/normalization";
import type { CanonicalDocument, CanonicalTransaction } from "@shared/transactions";
import type { DocumentAiTelemetry, IngestionSource } from "@shared/types";
import { storeTransactions } from "./exportRoutes";

// Support both JSON and multipart form data
const upload = multer({ storage: multer.memoryStorage() });

// Schema for JSON body (when contentBase64 is provided)
const jsonIngestSchema = z.object({
  fileName: z.string(),
  contentBase64: z.string(),
  documentType: z.enum(["bank_statement", "invoice", "receipt"]).default("bank_statement"),
});

// Schema for multipart form data (when file is uploaded)
const multipartIngestSchema = z.object({
  documentType: z.enum(["bank_statement", "invoice", "receipt"]).default("bank_statement"),
});

interface ParsedRequest {
  fileName: string;
  buffer: Buffer;
  documentType: "bank_statement" | "invoice" | "receipt";
}

function parseRequest(req: Request): ParsedRequest | { error: string; status: number } {
  // Check if multipart form data (has file)
  if (req.file) {
    const parsed = multipartIngestSchema.safeParse(req.body);
    if (!parsed.success) {
      return { error: "Invalid multipart request", status: 400 };
    }
    return {
      fileName: req.file.originalname || "uploaded.pdf",
      buffer: req.file.buffer,
      documentType: parsed.data.documentType,
    };
  }

  // Check if JSON body (has contentBase64)
  const parsed = jsonIngestSchema.safeParse(req.body);
  if (!parsed.success) {
    return { error: "Invalid request: must provide either file (multipart) or contentBase64 (JSON)", status: 400 };
  }

  try {
    const buffer = Buffer.from(parsed.data.contentBase64, "base64");
    return {
      fileName: parsed.data.fileName,
      buffer,
      documentType: parsed.data.documentType,
    };
  } catch (error) {
    return { error: "Invalid base64 content", status: 400 };
  }
}

async function processLegacyFallback(
  buffer: Buffer,
  documentType: "bank_statement" | "invoice" | "receipt"
): Promise<CanonicalTransaction[]> {
  // Import legacy parser functions dynamically
  // In tests, these are mocked via vi.mock("../client/src/lib/pdfParser")
  try {
    // Use dynamic import to allow test mocks to work
    const pdfParser = await import("../client/src/lib/pdfParser");
    const text = await extractTextFromPDFBuffer(buffer);
    const legacyTransactions = pdfParser.parseStatementText(text);
    return pdfParser.legacyTransactionsToCanonical(legacyTransactions);
  } catch (error) {
    // If legacy parser fails, return empty array
    console.warn("Legacy parser failed", error);
    return [];
  }
}

async function extractTextFromPDFBuffer(buffer: Buffer): Promise<string> {
  // Import pdfjs dynamically
  const pdfjsLib = await import("pdfjs-dist");
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  
  let fullText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(" ");
    fullText += pageText + "\n";
  }
  
  return fullText;
}

export function registerIngestionRoutes(app: Express) {
  // Support both multipart and JSON
  app.post("/api/ingest", upload.single("file"), async (req, res) => {
    const parsed = parseRequest(req);
    
    if ("error" in parsed) {
      return res.status(parsed.status).json({ error: parsed.error });
    }

    const { fileName, buffer, documentType } = parsed;

    try {
      // Get config first to check if Document AI is enabled
      const config = getDocumentAiConfig();
      const isDocAIEnabled = config && config.enabled === true;
      
      // Try Document AI first (if enabled)
      let docAIDocument: CanonicalDocument | null = null;
      let processorId: string | undefined;
      let processorType: string | undefined;
      let docAiTelemetry: DocumentAiTelemetry | undefined;
      const startTime = Date.now();
      
      if (isDocAIEnabled) {
        // Use structured version to get processor info for debug panel
        const docAIResult = await processWithDocumentAIStructured(buffer, documentType);
        const latencyMs = Date.now() - startTime;
        
        if (docAIResult.success) {
          docAIDocument = docAIResult.document;
          processorId = docAIResult.processorId;
          processorType = docAIResult.processorType;
          console.log(`[Ingestion] Document AI succeeded for ${fileName}: ${docAIResult.document.transactions.length} transactions using processor ${docAIResult.processorId} (${docAIResult.processorType})`);
          
          // Generate telemetry for successful Document AI
          docAiTelemetry = {
            enabled: true,
            processor: processorId,
            latencyMs,
            entityCount: docAIResult.document.transactions.length,
          };
        } else {
          // Log structured error info
          console.warn(`[Ingestion] Document AI failed for ${fileName}:`, {
            code: docAIResult.error.code,
            message: docAIResult.error.message,
            processorId: docAIResult.error.processorId,
          });
          
          // Generate telemetry for failed Document AI
          docAiTelemetry = {
            enabled: true,
            processor: docAIResult.error.processorId ?? null,
            latencyMs,
            entityCount: 0,
          };
        }
      } else {
        // Document AI disabled
        docAiTelemetry = {
          enabled: false,
          processor: null,
          latencyMs: null,
          entityCount: 0,
        };
      }

      if (docAIDocument && docAIDocument.transactions.length > 0) {
        // Document AI succeeded - store transactions and return all fields
        const exportId = storeTransactions(docAIDocument.transactions);
        return res.json({ 
          source: "documentai" as IngestionSource,
          document: docAIDocument,
          error: undefined,
          fallback: undefined,
          docAiTelemetry,
          exportId,
        });
      }

      // Document AI failed or disabled - use legacy fallback
      // "disabled" if Document AI is not enabled, "failed" if enabled but returned null/empty
      const fallbackReason = !isDocAIEnabled ? "disabled" : "failed";
      console.log(`[Ingestion] Document AI ${fallbackReason} for ${fileName}, using legacy parser`);

      // Process with legacy parser
      const legacyTransactions = await processLegacyFallback(buffer, documentType);
      
      const legacyDoc: CanonicalDocument = {
        documentType,
        transactions: legacyTransactions,
        warnings: fallbackReason === "disabled" 
          ? ["Document AI is disabled"] 
          : ["Document AI processing failed, using legacy parser"],
        rawText: undefined,
      };

      // Store transactions and return all fields
      const exportId = storeTransactions(legacyTransactions);

      return res.json({
        source: "legacy" as IngestionSource,
        document: legacyDoc,
        error: undefined,
        fallback: fallbackReason,
        docAiTelemetry: docAiTelemetry ?? {
          enabled: false,
          processor: null,
          latencyMs: null,
          entityCount: 0,
        },
        exportId,
      });
    } catch (error) {
      console.error("Error processing ingestion", { fileName, documentType, error });
      return res.status(500).json({
        source: "error" as IngestionSource,
        document: null,
        error: "Failed to ingest document",
        fallback: "legacy",
        docAiTelemetry: {
          enabled: false,
          processor: null,
          latencyMs: null,
          entityCount: 0,
        } satisfies DocumentAiTelemetry,
        exportId: undefined,
      });
    }
  });
}

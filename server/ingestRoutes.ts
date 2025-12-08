import type { Express, Request } from "express";
import multer from "multer";
import { z } from "zod";
import { processWithDocumentAI } from "./_core/documentAIClient";
import { getDocumentAiConfig } from "./_core/env";
import { normalizeLegacyTransactions } from "@shared/normalization";
import type { CanonicalDocument, CanonicalTransaction } from "@shared/transactions";

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
      const docAIDocument = isDocAIEnabled 
        ? await processWithDocumentAI(buffer, documentType)
        : null;

      if (docAIDocument && docAIDocument.transactions.length > 0) {
        // Document AI succeeded
        console.log(`[Ingestion] Document AI succeeded for ${fileName}: ${docAIDocument.transactions.length} transactions`);
        return res.json({ source: "documentai", document: docAIDocument });
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

      return res.json({ 
        source: "legacy", 
        fallback: fallbackReason,
        document: legacyDoc 
      });
    } catch (error) {
      console.error("Error processing ingestion", { fileName, documentType, error });
      return res.status(500).json({ 
        error: "Failed to ingest document", 
        fallback: "legacy",
        source: "error"
      });
    }
  });
}

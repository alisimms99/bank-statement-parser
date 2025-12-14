import type { Express, Request } from "express";
import multer from "multer";
import { z } from "zod";
import { processWithDocumentAI, processWithDocumentAIStructured } from "./_core/documentAIClient";
import { getDocumentAiConfig } from "./_core/env";
import type { CanonicalDocument, CanonicalTransaction } from "@shared/transactions";
import type { DocumentAiTelemetry, IngestionFailure } from "@shared/types";
import { legacyTransactionsToCanonical, parseStatementText } from "@shared/legacyStatementParser";
import { storeTransactions } from "./exportRoutes";
import { recordIngestFailure, recordIngestMetric } from "./_core/metrics";
import { logEvent, serializeError } from "./_core/log";
import { extractTextFromPDFBuffer } from "./_core/pdfText";
import { recordFirstRequest, getColdStartDuration } from "./_core/coldStart";

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
  try {
    const text = await extractTextFromPDFBuffer(buffer);
    const legacyTransactions = parseStatementText(text);
    return legacyTransactionsToCanonical(legacyTransactions);
  } catch (error) {
    // If legacy parser fails, return empty array
    recordIngestFailure({
      phase: "normalize",
      message: error instanceof Error ? error.message : "Legacy parser failed",
      ts: Date.now(),
      hint: "Legacy PDF parser threw while extracting/normalizing transactions",
    });
    console.warn("Legacy parser failed", error);
    return [];
  }
}

export function registerIngestionRoutes(app: Express) {
  // Support both multipart and JSON
  app.post("/api/ingest", upload.single("file"), async (req, res) => {
    // Track cold start if this is the first request
    const coldStartMs = recordFirstRequest();
    if (coldStartMs !== null) {
      logEvent("cold_start", {
        durationMs: coldStartMs,
        containerStartup: true,
      });
    }
    
    const parsed = parseRequest(req);
    
    if ("error" in parsed) {
      const failure: IngestionFailure = {
        phase: "upload",
        message: parsed.error,
        ts: Date.now(),
        hint: `Request rejected with HTTP ${parsed.status}`,
      };
      recordIngestFailure(failure);
      logEvent(
        "ingest_failure",
        { phase: failure.phase, status: parsed.status, failure, ip: req.ip },
        "warn"
      );
      return res.status(parsed.status).json({ error: parsed.error, source: "error", failure });
    }

    const { fileName, buffer, documentType } = parsed;

    // Track start time for telemetry (must be outside try block for error path)
    const startTime = Date.now();
    logEvent("ingest_start", {
      fileName,
      documentType,
      bytes: buffer.length,
      contentType: req.headers["content-type"],
      coldStartMs: getColdStartDuration(),
    });

    try {
      // Get config first to check if Document AI is enabled
      const config = getDocumentAiConfig();
      const isDocAIEnabled = config && config.enabled === true;
      
      // Try Document AI first (if enabled)
      let docAIDocument: CanonicalDocument | null = null;
      let processorId: string | undefined;
      let processorType: string | undefined;
      let docAiTelemetry: DocumentAiTelemetry | undefined;
      let docAiFailure: IngestionFailure | undefined;
      
      if (isDocAIEnabled) {
        // Use structured version to get processor info for debug panel
        const docAIResult = await processWithDocumentAIStructured(buffer, documentType);
        const latencyMs = Date.now() - startTime;
        
        if (docAIResult.success) {
          docAIDocument = docAIResult.document;
          processorId = docAIResult.processorId;
          processorType = docAIResult.processorType;
          
          // Generate telemetry for successful Document AI
          docAiTelemetry = {
            enabled: true,
            processor: processorId,
            latencyMs,
            entityCount: docAIResult.document.transactions.length,
          };
        } else {
          // Log structured error info
          logEvent(
            "ingest_failure",
            {
              phase: "docai",
              fileName,
              documentType,
              code: docAIResult.error.code,
              message: docAIResult.error.message,
              processorId: docAIResult.error.processorId,
              details: docAIResult.error.details,
              durationMs: latencyMs,
            },
            "warn"
          );

          docAiFailure = {
            phase: "docai",
            message: docAIResult.error.message ?? "Document AI processing failed",
            ts: Date.now(),
            hint: `code=${docAIResult.error.code}${docAIResult.error.processorId ? ` processorId=${docAIResult.error.processorId}` : ""}`,
          };
          recordIngestFailure(docAiFailure);
          
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
        // Document AI succeeded - store transactions and include export ID
        const exportId = storeTransactions(docAIDocument.transactions);
        const durationMs = Date.now() - startTime;
        
        // Record ingest telemetry for Document AI success
        recordIngestMetric({
          source: "documentai",
          durationMs,
          documentType,
          timestamp: Date.now(),
          fallbackReason: null,
        });

        logEvent("ingest_complete", {
          source: "documentai",
          fileName,
          documentType,
          processorId,
          processorType,
          transactionCount: docAIDocument.transactions.length,
          durationMs,
          exportId,
        });
        
        return res.json({ 
          source: "documentai", 
          document: docAIDocument,
          error: undefined,
          fallback: undefined,
          docAiTelemetry,
          exportId, // Include export ID for CSV download
        });
      }

      // Document AI failed or disabled - use legacy fallback
      // "disabled" if Document AI is not enabled, "failed" if enabled but returned null/empty
      const fallbackReason = !isDocAIEnabled ? "disabled" : "failed";

      // Process with legacy parser
      const legacyStartTime = Date.now();
      const legacyTransactions = (await processLegacyFallback(buffer, documentType)) ?? [];
      const legacyDurationMs = Date.now() - legacyStartTime;
      
      const legacyDoc: CanonicalDocument = {
        documentType,
        transactions: legacyTransactions,
        warnings: fallbackReason === "disabled" 
          ? ["Document AI is disabled"] 
          : ["Document AI processing failed, using legacy parser"],
        rawText: undefined,
      };

      // Store transactions and include export ID
      const exportId = storeTransactions(legacyTransactions);

      // Record ingest telemetry for legacy fallback
      recordIngestMetric({
        source: "legacy",
        durationMs: legacyDurationMs,
        documentType,
        timestamp: Date.now(),
        fallbackReason,
      });

      logEvent("ingest_complete", {
        source: "legacy",
        fileName,
        documentType,
        transactionCount: legacyTransactions.length,
        durationMs: Date.now() - startTime,
        fallbackReason,
        exportId,
      });

      return res.json({
        source: "legacy",
        fallback: fallbackReason,
        document: legacyDoc,
        error: undefined,
        docAiTelemetry: docAiTelemetry ?? {
          enabled: false,
          processor: null,
          latencyMs: null,
          entityCount: 0,
        },
        exportId, // Include export ID for CSV download
        docAiFailure,
      });
    } catch (error) {
      logEvent(
        "ingest_error",
        { phase: "unknown", fileName, documentType, error: serializeError(error), durationMs: Date.now() - startTime },
        "error"
      );
      const errorDurationMs = Date.now() - startTime;
      const failure: IngestionFailure = {
        phase: "unknown",
        message: error instanceof Error ? error.message : "Failed to ingest document",
        ts: Date.now(),
        hint: `file=${fileName} documentType=${documentType}`,
      };
      recordIngestFailure(failure);
      
      // Record ingest telemetry for error path
      recordIngestMetric({
        source: "error",
        durationMs: errorDurationMs,
        documentType,
        timestamp: Date.now(),
        fallbackReason: "error",
      });
      
      return res.status(500).json({
        error: "Failed to ingest document",
        fallback: "legacy",
        source: "error",
        failure,
        docAiTelemetry: {
          enabled: false,
          processor: null,
          latencyMs: null,
          entityCount: 0,
        } satisfies DocumentAiTelemetry,
      });
    }
  });
}

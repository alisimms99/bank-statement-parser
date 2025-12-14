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

// Support both JSON and multipart form data
const upload = multer({ storage: multer.memoryStorage() });

// Multer configuration for bulk uploads
const bulkUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    files: 60, // Max 60 files
    fileSize: 25 * 1024 * 1024 // 25MB per file
  }
});

// Rate limiting for bulk ingestion
const MAX_CONCURRENT_INGESTIONS = 5;
let currentIngestions = 0;

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

/**
 * Process a single PDF file
 * Returns the result with exportId and transaction data
 */
async function processSinglePDF(
  fileName: string,
  buffer: Buffer,
  documentType: "bank_statement" | "invoice" | "receipt"
): Promise<{
  fileName: string;
  success: boolean;
  source: "documentai" | "legacy" | "error";
  exportId?: string;
  transactions: CanonicalTransaction[];
  month?: string | null;
  year?: string | null;
  error?: string;
  docAiTelemetry?: DocumentAiTelemetry;
  fallback?: string;
}> {
  const startTime = Date.now();
  
  try {
    // Get config first to check if Document AI is enabled
    const config = getDocumentAiConfig();
    const isDocAIEnabled = config && config.enabled === true;
    
    // Try Document AI first (if enabled)
    let docAIDocument: CanonicalDocument | null = null;
    let processorId: string | undefined;
    let processorType: string | undefined;
    let docAiTelemetry: DocumentAiTelemetry | undefined;
    
    if (isDocAIEnabled) {
      const docAIResult = await processWithDocumentAIStructured(buffer, documentType);
      const latencyMs = Date.now() - startTime;
      
      if (docAIResult.success) {
        docAIDocument = docAIResult.document;
        processorId = docAIResult.processorId;
        processorType = docAIResult.processorType;
        
        docAiTelemetry = {
          enabled: true,
          processor: processorId,
          latencyMs,
          entityCount: docAIResult.document.transactions.length,
        };
      } else {
        docAiTelemetry = {
          enabled: true,
          processor: docAIResult.error.processorId ?? null,
          latencyMs,
          entityCount: 0,
        };
      }
    } else {
      docAiTelemetry = {
        enabled: false,
        processor: null,
        latencyMs: null,
        entityCount: 0,
      };
    }

    if (docAIDocument && docAIDocument.transactions.length > 0) {
      // Document AI succeeded
      const exportId = storeTransactions(docAIDocument.transactions);
      const durationMs = Date.now() - startTime;
      
      recordIngestMetric({
        source: "documentai",
        durationMs,
        documentType,
        timestamp: Date.now(),
        fallbackReason: null,
      });

      // Extract month/year from statement_period
      const firstTx = docAIDocument.transactions[0];
      const periodEnd = firstTx?.statement_period?.end;
      let month: string | null = null;
      let year: string | null = null;
      
      if (periodEnd) {
        const date = new Date(periodEnd);
        if (!isNaN(date.getTime())) {
          month = String(date.getMonth() + 1).padStart(2, '0');
          year = String(date.getFullYear());
        }
      }

      return {
        fileName,
        success: true,
        source: "documentai",
        exportId,
        transactions: docAIDocument.transactions,
        month,
        year,
        docAiTelemetry,
      };
    }

    // Document AI failed or disabled - use legacy fallback
    const fallbackReason = !isDocAIEnabled ? "disabled" : "failed";
    const legacyTransactions = (await processLegacyFallback(buffer, documentType)) ?? [];
    
    const exportId = storeTransactions(legacyTransactions);

    recordIngestMetric({
      source: "legacy",
      durationMs: Date.now() - startTime,
      documentType,
      timestamp: Date.now(),
      fallbackReason,
    });

    // Extract month/year from statement_period
    const firstTx = legacyTransactions[0];
    const periodEnd = firstTx?.statement_period?.end;
    let month: string | null = null;
    let year: string | null = null;
    
    if (periodEnd) {
      const date = new Date(periodEnd);
      if (!isNaN(date.getTime())) {
        month = String(date.getMonth() + 1).padStart(2, '0');
        year = String(date.getFullYear());
      }
    }

    return {
      fileName,
      success: true,
      source: "legacy",
      exportId,
      transactions: legacyTransactions,
      month,
      year,
      fallback: fallbackReason,
      docAiTelemetry,
    };
  } catch (error) {
    const errorDurationMs = Date.now() - startTime;
    const failure: IngestionFailure = {
      phase: "unknown",
      message: error instanceof Error ? error.message : "Failed to ingest document",
      ts: Date.now(),
      hint: `file=${fileName} documentType=${documentType}`,
    };
    recordIngestFailure(failure);
    
    recordIngestMetric({
      source: "error",
      durationMs: errorDurationMs,
      documentType,
      timestamp: Date.now(),
      fallbackReason: "error",
    });
    
    return {
      fileName,
      success: false,
      source: "error",
      transactions: [],
      error: error instanceof Error ? error.message : "Failed to ingest document",
    };
  }
}

export function registerIngestionRoutes(app: Express) {
  // Support both multipart and JSON
  app.post("/api/ingest", upload.single("file"), async (req, res) => {
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
        "ingest_failure",
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

  /**
   * Bulk PDF ingestion endpoint
   * Accepts multiple PDF files and processes them independently
   * Returns an array of results with month, year, exportId, and transactions
   */
  app.post("/api/ingest/bulk", bulkUpload.array("files", 60), async (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        error: "No files provided",
        message: "Please upload at least one PDF file",
      });
    }

    // Validate file count
    if (files.length < 12) {
      return res.status(400).json({
        error: "Insufficient files",
        message: "Bulk ingestion requires at least 12 files",
      });
    }

    if (files.length > 60) {
      return res.status(400).json({
        error: "Too many files",
        message: "Maximum 60 files allowed per bulk upload",
      });
    }

    // Check rate limit
    if (currentIngestions >= MAX_CONCURRENT_INGESTIONS) {
      return res.status(429).json({
        error: "Rate limit exceeded",
        message: "Server is currently processing other bulk uploads. Please try again in a moment.",
      });
    }

    currentIngestions++;
    const startTime = Date.now();

    logEvent("bulk_ingest_start", {
      fileCount: files.length,
      totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    });

    try {
      const documentType = (req.body.documentType as "bank_statement" | "invoice" | "receipt") || "bank_statement";

      // Process files with concurrency control
      const results: Array<{
        month: string | null;
        year: string | null;
        exportId: string | null;
        transactions: CanonicalTransaction[];
        fileName: string;
        success: boolean;
        error?: string;
      }> = [];

      // Process in batches to prevent OOM
      const batchSize = 5;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        
        const batchResults = await Promise.all(
          batch.map(async (file) => {
            const result = await processSinglePDF(
              file.originalname,
              file.buffer,
              documentType
            );
            
            return {
              month: result.month ?? null,
              year: result.year ?? null,
              exportId: result.exportId ?? null,
              transactions: result.transactions,
              fileName: result.fileName,
              success: result.success,
              error: result.error,
            };
          })
        );

        results.push(...batchResults);
      }

      const durationMs = Date.now() - startTime;
      const successCount = results.filter(r => r.success).length;

      logEvent("bulk_ingest_complete", {
        fileCount: files.length,
        successCount,
        failureCount: files.length - successCount,
        durationMs,
      });

      return res.json({
        success: true,
        results,
        summary: {
          total: files.length,
          successful: successCount,
          failed: files.length - successCount,
          durationMs,
        },
      });
    } catch (error) {
      logEvent(
        "bulk_ingest_failure",
        {
          fileCount: files.length,
          error: serializeError(error),
          durationMs: Date.now() - startTime,
        },
        "error"
      );

      return res.status(500).json({
        error: "Bulk ingestion failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      currentIngestions--;
    }
  });
}

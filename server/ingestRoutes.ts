import type { Express, Request } from "express";
import multer from "multer";
import { z } from "zod";
import { randomUUID } from "crypto";
import { processWithDocumentAI, processWithDocumentAIStructured } from "./_core/documentAIClient";
import { getDocumentAiConfig } from "./_core/env";
import type { CanonicalDocument, CanonicalTransaction } from "@shared/transactions";
import type { DocumentAiTelemetry, IngestionFailure } from "@shared/types";
import { legacyTransactionsToCanonical, parseStatementText } from "@shared/legacyStatementParser";
import { storeTransactions } from "./exportRoutes";
import { recordIngestFailure, recordIngestMetric } from "./_core/metrics";
import { logEvent, serializeError, logIngestionError, logIngestionSuccess } from "./_core/log";
import { extractTextFromPDFBuffer } from "./_core/pdfText";
import { requireAuth } from "./middleware/auth";

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

// Schema for bulk ingestion
const bulkIngestSchema = z.object({
  files: z
    .array(
      z.object({
        fileName: z.string(),
        contentBase64: z.string(),
        documentType: z.enum(["bank_statement", "invoice", "receipt"]).default("bank_statement"),
      })
    )
    .min(1)
    .max(60),
});

// Rate limiting for bulk uploads
const BULK_MAX_FILES = 60;
const BULK_MAX_SIZE_PER_FILE = 10 * 1024 * 1024; // 10MB per file

interface BulkIngestionResult {
  month: string;
  year: string;
  exportId: string;
  transactions: number;
  status: "success" | "error";
  error?: string;
}

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
  documentType: "bank_statement" | "invoice" | "receipt",
  fileName?: string
): Promise<CanonicalTransaction[]> {
  try {
    const text = await extractTextFromPDFBuffer(buffer);
    const legacyTransactions = parseStatementText(text);
    // Extract year from filename if provided
    const defaultYear = fileName ? extractYear(fileName) : undefined;
    return legacyTransactionsToCanonical(legacyTransactions, defaultYear);
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

// Helper to extract a valid month from filename (e.g., "statement-2024-03.pdf" -> "03")
// Rules:
// - Accept only numeric months 01-12 when delimited by '-' or '_' and followed by '-', '_' or '.'
// - Accept short month names (jan-dec) after '-' or '_'
function extractMonth(fileName: string): string {
  // Capture either:
  // 1) a valid 2-digit month 01-12 between delimiters, or
  // 2) a short month name (jan-dec) preceded by '-' or '_'
  const match = fileName.match(
    /[-_](0[1-9]|1[0-2])(?=[-_.])|[-_](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i
  );
  if (match) {
    // Numeric month (01-12)
    if (match[1]) return match[1];
    // Short month name
    const monthMap: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    return monthMap[match[2].toLowerCase()] || "";
  }
  return "";
}

function extractYear(fileName: string): string {
  const match = fileName.match(/(20\d{2})/);
  return match ? match[1] : new Date().getFullYear().toString();
}

export function registerIngestionRoutes(app: Express) {
  // Endpoint for client-parsed transactions (custom parser path)
  app.post("/api/ingest/parsed", requireAuth, async (req, res) => {
    try {
      const { fileName, transactions } = req.body;
      
      if (!fileName || !Array.isArray(transactions)) {
        return res.status(400).json({
          error: "Invalid request: fileName and transactions array required",
          source: "error",
        });
      }
      
      // Validate transactions are in canonical format
      const canonicalTransactions: CanonicalTransaction[] = transactions.map((tx: any) => ({
        date: tx.date ?? null,
        posted_date: tx.posted_date ?? tx.date ?? null,
        description: tx.description ?? "",
        payee: tx.payee ?? null,
        debit: tx.debit ?? 0,
        credit: tx.credit ?? 0,
        balance: tx.balance ?? null,
        account_id: tx.account_id ?? null,
        source_bank: tx.source_bank ?? null,
        statement_period: tx.statement_period ?? {
          start: null,
          end: null,
        },
        metadata: tx.metadata,
      }));
      
      // Store transactions and get export ID
      const exportId = storeTransactions(canonicalTransactions);
      
      logEvent("ingest_complete", {
        source: "custom",
        fileName,
        transactionCount: canonicalTransactions.length,
        exportId,
      });
      
      logIngestionSuccess(exportId, fileName, canonicalTransactions.length, "legacy", Date.now());
      
      res.json({
        source: "custom",
        document: {
          documentType: "bank_statement" as const,
          transactions: canonicalTransactions,
          rawText: undefined,
        },
        exportId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logEvent("ingest_failure", {
        phase: "parsed",
        error: errorMessage,
      }, "error");
      
      res.status(500).json({
        error: errorMessage,
        source: "error",
      });
    }
  });

  // Status endpoint for deployment information
  app.get("/api/status", (req, res) => {
    const config = getDocumentAiConfig();
    res.json({
      // Cloud Run environment variables
      deployedRevision: process.env.K_REVISION || "local",
      serviceName: process.env.K_SERVICE || "dev",
      
      // Build info
      buildId: process.env.BUILD_ID || process.env.K_REVISION?.split("-").pop() || "unknown",
      timestamp: new Date().toISOString(),
      
      // Feature flags
      documentAiEnabled: config && config.enabled === true,
      
      // App info
      version: process.env.npm_package_version || "1.0.0",
      nodeEnv: process.env.NODE_ENV || "development",
      
      // Uptime
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  // Support both multipart and JSON
  app.post("/api/ingest", requireAuth, upload.single("file"), async (req, res) => {
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
        const docAIResult = await processWithDocumentAIStructured(buffer, documentType, fileName);
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
          // Log structured error info with full details
          console.error("[Ingest Route] Document AI failed:", {
            fileName,
            documentType,
            errorCode: docAIResult.error.code,
            errorMessage: docAIResult.error.message,
            processorId: docAIResult.error.processorId,
            errorDetails: docAIResult.error.details,
            durationMs: latencyMs,
            fullError: docAIResult.error,
          });

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
              fullError: docAIResult.error,
            },
            "error" // Changed from "warn" to "error" for better visibility
          );

          docAiFailure = {
            phase: "docai",
            message: docAIResult.error.message ?? "Document AI processing failed",
            ts: Date.now(),
            hint: `code=${docAIResult.error.code}${docAIResult.error.processorId ? ` processorId=${docAIResult.error.processorId}` : ""}${docAIResult.error.details ? ` details=${JSON.stringify(docAIResult.error.details)}` : ""}`,
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

        // Use structured logging for success
        logIngestionSuccess(exportId, fileName, docAIDocument.transactions.length, "documentai", durationMs);
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
      const legacyTransactions = (await processLegacyFallback(buffer, documentType, fileName)) ?? [];
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
      const totalDurationMs = Date.now() - startTime;

      // Record ingest telemetry for legacy fallback
      recordIngestMetric({
        source: "legacy",
        durationMs: legacyDurationMs,
        documentType,
        timestamp: Date.now(),
        fallbackReason,
      });

      // Use structured logging for success
      logIngestionSuccess(exportId, fileName, legacyTransactions.length, "legacy", totalDurationMs);
      logEvent("ingest_complete", {
        source: "legacy",
        fileName,
        documentType,
        transactionCount: legacyTransactions.length,
        durationMs: totalDurationMs,
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
      const errorDurationMs = Date.now() - startTime;
      const exportId = randomUUID(); // Generate export ID for error tracking
      const errorObj = error instanceof Error ? error : new Error("Failed to ingest document");
      
      // Use structured logging for errors (Google Cloud Error Reporting compatible)
      logIngestionError(exportId, fileName, errorObj, "extraction");
      logEvent(
        "ingest_failure",
        { phase: "unknown", fileName, documentType, error: serializeError(error), durationMs: errorDurationMs },
        "error"
      );
      
      const failure: IngestionFailure = {
        phase: "unknown",
        message: errorObj.message,
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
        exportId, // Include export ID for error tracking
        docAiTelemetry: {
          enabled: false,
          processor: null,
          latencyMs: null,
          entityCount: 0,
        } satisfies DocumentAiTelemetry,
      });
    }
  });

  // Bulk ingestion endpoint
  app.post("/api/ingest/bulk", async (req, res) => {
    const batchId = randomUUID();
    const batchStartTime = Date.now();

    // Validate request body
    const parsed = bulkIngestSchema.safeParse(req.body);
    if (!parsed.success) {
      // Check if the error is specifically about too many files
      const errors = parsed.error?.issues || [];
      const tooManyFilesError = errors.find(
        (e) => e.code === "too_big" && e.path?.[0] === "files"
      );
      
      if (tooManyFilesError) {
        // Try to extract the actual count from the request body
        const receivedCount = Array.isArray(req.body.files) ? req.body.files.length : 0;
        const failure: IngestionFailure = {
          phase: "upload",
          message: `Too many files. Maximum is ${BULK_MAX_FILES}`,
          ts: Date.now(),
          hint: `received=${receivedCount}`,
        };
        recordIngestFailure(failure);
        logEvent("bulk_ingest_failure", { batchId, error: "Too many files", received: receivedCount }, "warn");
        return res.status(400).json({
          error: `Too many files. Maximum is ${BULK_MAX_FILES}`,
          received: receivedCount,
        });
      }

      const failure: IngestionFailure = {
        phase: "upload",
        message: "Invalid bulk request",
        ts: Date.now(),
        hint: "Request validation failed",
      };
      recordIngestFailure(failure);
      logEvent("bulk_ingest_failure", { batchId, error: "Invalid request", details: parsed.error }, "warn");
      return res.status(400).json({ error: "Invalid request", details: parsed.error });
    }

    const { files } = parsed.data;

    logEvent("bulk_ingest_start", { batchId, fileCount: files.length });

    const results: BulkIngestionResult[] = [];
    const config = getDocumentAiConfig();
    const isDocAIEnabled = config && config.enabled === true;

    // Process files sequentially to avoid OOM
    for (const file of files) {
      const fileStartTime = Date.now();
      const exportId = randomUUID();

      try {
        // Validate file size
        const fileSize = Buffer.byteLength(file.contentBase64, "base64");
        if (fileSize > BULK_MAX_SIZE_PER_FILE) {
          const errorMessage = `File too large: ${Math.round(fileSize / 1024 / 1024)}MB exceeds ${BULK_MAX_SIZE_PER_FILE / 1024 / 1024}MB limit`;
          results.push({
            month: extractMonth(file.fileName),
            year: extractYear(file.fileName),
            exportId: "",
            transactions: 0,
            status: "error",
            error: errorMessage,
          });
          logIngestionError(exportId, file.fileName, new Error(errorMessage), "upload");
          continue;
        }

        const buffer = Buffer.from(file.contentBase64, "base64");
        const documentType = file.documentType || "bank_statement";

        let document: CanonicalDocument | null = null;
        let source: "documentai" | "legacy" = "legacy";

        // Try Document AI first (if enabled)
        if (isDocAIEnabled) {
          const docAIResult = await processWithDocumentAIStructured(buffer, documentType, file.fileName);
          if (docAIResult.success && docAIResult.document.transactions.length > 0) {
            document = docAIResult.document;
            source = "documentai";
          } else if (!docAIResult.success) {
            // Log Document AI failure in bulk processing
            console.error(`[Bulk Ingest] Document AI failed for ${file.fileName}:`, {
              errorCode: docAIResult.error.code,
              errorMessage: docAIResult.error.message,
              processorId: docAIResult.error.processorId,
              errorDetails: docAIResult.error.details,
            });
          } else if (docAIResult.success && docAIResult.document.transactions.length === 0) {
            console.warn(`[Bulk Ingest] Document AI returned no transactions for ${file.fileName}`);
          }
        }

        // Fallback to legacy if Document AI failed or disabled
        if (!document || document.transactions.length === 0) {
          const legacyTransactions = await processLegacyFallback(buffer, documentType, file.fileName);
          document = {
            documentType,
            transactions: legacyTransactions,
            warnings: isDocAIEnabled
              ? ["Document AI processing failed, using legacy parser"]
              : ["Document AI is disabled"],
            rawText: undefined,
          };
          source = "legacy";
        }

        // Store transactions
        const storedExportId = storeTransactions(document.transactions);
        const durationMs = Date.now() - fileStartTime;

        // Log success
        logIngestionSuccess(storedExportId, file.fileName, document.transactions.length, source, durationMs);

        // Record metrics
        recordIngestMetric({
          source,
          durationMs,
          documentType,
          timestamp: Date.now(),
          fallbackReason: source === "legacy" ? (isDocAIEnabled ? "failed" : "disabled") : null,
        });

        results.push({
          month: extractMonth(file.fileName),
          year: extractYear(file.fileName),
          exportId: storedExportId,
          transactions: document.transactions.length,
          status: "success",
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`Error processing ${file.fileName}:`, error);
        logIngestionError(exportId, file.fileName, error instanceof Error ? error : new Error(errorMessage), "extraction");

        results.push({
          month: extractMonth(file.fileName),
          year: extractYear(file.fileName),
          exportId: "",
          transactions: 0,
          status: "error",
          error: errorMessage,
        });
      }
    }

    const batchDurationMs = Date.now() - batchStartTime;
    const successful = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "error").length;

    logEvent("bulk_ingest_complete", {
      batchId,
      totalFiles: files.length,
      successful,
      failed,
      durationMs: batchDurationMs,
    });

    res.json({
      batchId,
      totalFiles: files.length,
      successful,
      failed,
      results,
    });
  });
}

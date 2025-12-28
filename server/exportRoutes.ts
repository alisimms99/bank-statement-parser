import type { Express } from "express";
import { randomUUID } from "crypto";
import { toCSV } from "@shared/export/csv";
import type { CanonicalTransaction } from "@shared/transactions";
import type { NormalizedTransaction } from "@shared/types";
import { recordExportEvent, type ExportFormat } from "./_core/exportMetrics";
import { logEvent, serializeError } from "./_core/log";
import { requireAuth } from "./middleware/auth";

// In-memory store for transactions (keyed by UUID)
// In production, this could be replaced with Redis or a database
interface StoredEntry {
  data: CanonicalTransaction[];
  createdAt: number;
}

const transactionStore = new Map<string, StoredEntry>();

// Clean up old entries after 1 hour
const STORE_TTL_MS = 60 * 60 * 1000;

// Cleanup interval: every 10 minutes
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Purge expired entries from the store
 * Uses lazy cleanup based on createdAt timestamps
 */
function purgeExpired(): void {
  const now = Date.now();
  const idsToDelete: string[] = [];
  
  transactionStore.forEach((entry, id) => {
    if (now - entry.createdAt > STORE_TTL_MS) {
      idsToDelete.push(id);
    }
  });
  
  idsToDelete.forEach(id => transactionStore.delete(id));
}

// Start periodic cleanup on module load
// Single timer handles all entries, scales infinitely
if (typeof setInterval !== "undefined") {
  setInterval(purgeExpired, CLEANUP_INTERVAL_MS);
}

/**
 * Convert CanonicalTransaction to NormalizedTransaction for CSV export
 */
function toNormalized(tx: CanonicalTransaction): NormalizedTransaction {
  return {
    ...tx,
    statement_period: tx.statement_period,
  };
}

/**
 * Store transactions and return a UUID for retrieval
 * 
 * Uses timestamp-based storage for lazy cleanup that survives server restarts.
 * Cleanup runs periodically via setInterval, preventing timer explosion at scale.
 */
export function storeTransactions(transactions: CanonicalTransaction[]): string {
  const id = randomUUID();
  transactionStore.set(id, {
    data: transactions,
    createdAt: Date.now(),
  });
  
  return id;
}

/**
 * Retrieve stored transactions by export ID
 * 
 * Automatically purges expired entries before retrieval to prevent race conditions.
 * Returns null if the ID doesn't exist or has expired.
 */
export function getStoredTransactions(id: string): CanonicalTransaction[] | null {
  // Lazy cleanup before retrieval to prevent TTL race bugs
  purgeExpired();
  
  const entry = transactionStore.get(id);
  if (!entry) {
    return null;
  }
  
  // Double-check expiration (in case cleanup didn't run yet)
  const now = Date.now();
  if (now - entry.createdAt > STORE_TTL_MS) {
    transactionStore.delete(id);
    return null;
  }
  
  return entry.data;
}

/**
 * Check if export ID exists and is expired
 * Returns: { found: boolean, expired: boolean }
 * Checks expiration before purging to avoid race conditions
 */
function checkExportStatus(id: string): { found: boolean; expired: boolean } {
  const entry = transactionStore.get(id);
  if (!entry) {
    // Entry doesn't exist - purge expired entries and return not found
    purgeExpired();
    return { found: false, expired: false };
  }
  
  // Check expiration before purging
  const now = Date.now();
  const isExpired = now - entry.createdAt > STORE_TTL_MS;
  
  if (isExpired) {
    // Delete expired entry and purge others
    transactionStore.delete(id);
    purgeExpired();
    return { found: true, expired: true };
  }
  
  // Entry is valid - purge other expired entries but keep this one
  purgeExpired();
  return { found: true, expired: false };
}

/**
 * Generate stub PDF buffer (placeholder for future PDF rendering)
 */
function generateStubPDF(transactions: CanonicalTransaction[]): Buffer {
  // NOTE: This is a stub generator, but it must still produce a structurally-valid PDF.
  // In particular, stream `/Length` and xref offsets must match the actual bytes.

  const escapePdfString = (value: string): string =>
    value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  const header = "%PDF-1.4\n";

  const obj1 = `1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
`;

  const obj2 = `2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
`;

  const obj3 = `3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>
endobj
`;

  const text = escapePdfString(`Bank Transactions Export - ${transactions.length} transactions`);
  const streamContent = `BT
/F1 12 Tf
100 700 Td
(${text}) Tj
ET
`;
  const streamLengthBytes = Buffer.byteLength(streamContent, "utf8");

  const obj4 = `4 0 obj
<< /Length ${streamLengthBytes} >>
stream
${streamContent}endstream
endobj
`;

  const objects = [obj1, obj2, obj3, obj4];
  const offsets: number[] = [0];
  let cursor = Buffer.byteLength(header, "utf8");
  for (const obj of objects) {
    offsets.push(cursor);
    cursor += Buffer.byteLength(obj, "utf8");
  }

  const startXref = cursor;
  const formatOffset = (n: number): string => String(n).padStart(10, "0");
  const xref =
    `xref
0 5
0000000000 65535 f 
${formatOffset(offsets[1])} 00000 n 
${formatOffset(offsets[2])} 00000 n 
${formatOffset(offsets[3])} 00000 n 
${formatOffset(offsets[4])} 00000 n 
`;

  const trailer = `trailer
<< /Size 5 /Root 1 0 R >>
startxref
${startXref}
%%EOF
`;

  const pdfContent = header + objects.join("") + xref + trailer;
  return Buffer.from(pdfContent, "utf8");
}

export function registerExportRoutes(app: Express): void {
  /**
   * GET /api/export/:id/csv
   * Export transactions as CSV
   */
  app.get("/api/export/:id/csv", requireAuth, (req, res) => {
    const { id } = req.params;
    const includeBOM = req.query.bom === "true" || req.query.bom === "1";
    
    // Check export status
    const status = checkExportStatus(id);
    if (!status.found) {
      logEvent("export_csv", { exportId: id, includeBOM, success: false, status: 404 }, "warn");
      recordExportEvent({
        exportId: id,
        format: "csv",
        transactionCount: 0,
        timestamp: Date.now(),
        success: false,
        error: "Export not found",
      });
      
      return res.status(404).json({ 
        error: "Export not found",
        message: "The requested export is not available.",
      });
    }
    
    if (status.expired) {
      logEvent("export_csv", { exportId: id, includeBOM, success: false, status: 410, error: "expired" }, "warn");
      recordExportEvent({
        exportId: id,
        format: "csv",
        transactionCount: 0,
        timestamp: Date.now(),
        success: false,
        error: "Export expired",
      });
      
      return res.status(410).json({ 
        error: "Export expired",
        message: "The requested export has expired. Please regenerate the export.",
      });
    }
    
    const transactions = getStoredTransactions(id);
    
    if (!transactions || transactions.length === 0) {
      logEvent("export_csv", { exportId: id, includeBOM, success: false, status: 404 }, "warn");
      recordExportEvent({
        exportId: id,
        format: "csv",
        transactionCount: 0,
        timestamp: Date.now(),
        success: false,
        error: "Export not found",
      });
      
      return res.status(404).json({ 
        error: "Export not found",
        message: "The requested export is not available.",
      });
    }

    try {
      // Convert CanonicalTransaction[] to NormalizedTransaction[] for CSV export
      const normalizedTransactions: NormalizedTransaction[] = transactions.map(toNormalized);
      const csv = toCSV(normalizedTransactions, { includeBOM });
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `bank-transactions-${timestamp}.csv`;
      
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);

      logEvent("export_csv", {
        exportId: id,
        includeBOM,
        success: true,
        status: 200,
        transactionCount: transactions.length,
      });
      
      // Log successful export
      recordExportEvent({
        exportId: id,
        format: "csv",
        transactionCount: transactions.length,
        timestamp: Date.now(),
        success: true,
      });
    } catch (error) {
      logEvent(
        "export_csv",
        { exportId: id, includeBOM, success: false, status: 500, error: serializeError(error) },
        "error"
      );
      
      recordExportEvent({
        exportId: id,
        format: "csv",
        transactionCount: transactions.length,
        timestamp: Date.now(),
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      
      res.status(500).json({ 
        error: "Failed to generate CSV export",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * POST /api/export/pdf
   * Export transactions as PDF from request body (for accumulated transactions)
   */
  app.post("/api/export/pdf", requireAuth, (req, res) => {
    try {
      const { transactions } = req.body;
      
      if (!Array.isArray(transactions) || transactions.length === 0) {
        return res.status(400).json({ 
          error: "Invalid request",
          message: "transactions array is required and must not be empty",
        });
      }

      // Generate stub PDF buffer
      const pdfBuffer = generateStubPDF(transactions);
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `bank-transactions-${timestamp}.pdf`;
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdfBuffer);

      logEvent("export_pdf", {
        exportId: "combined",
        success: true,
        status: 200,
        transactionCount: transactions.length,
      });
      
      recordExportEvent({
        exportId: "combined",
        format: "pdf",
        transactionCount: transactions.length,
        timestamp: Date.now(),
        success: true,
      });
    } catch (error) {
      logEvent("export_pdf", { 
        exportId: "combined", 
        success: false, 
        status: 500, 
        error: serializeError(error) 
      }, "error");
      
      recordExportEvent({
        exportId: "combined",
        format: "pdf",
        transactionCount: 0,
        timestamp: Date.now(),
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      
      res.status(500).json({ 
        error: "Failed to generate PDF export",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/export/:id/pdf
   * Export transactions as PDF (stub implementation)
   */
  app.get("/api/export/:id/pdf", requireAuth, (req, res) => {
    const { id } = req.params;
    
    // Check export status
    const status = checkExportStatus(id);
    if (!status.found) {
      logEvent("export_pdf", { exportId: id, success: false, status: 404 }, "warn");
      recordExportEvent({
        exportId: id,
        format: "pdf",
        transactionCount: 0,
        timestamp: Date.now(),
        success: false,
        error: "Export not found",
      });
      
      return res.status(404).json({ 
        error: "Export not found",
        message: "The requested export is not available.",
      });
    }
    
    if (status.expired) {
      logEvent("export_pdf", { exportId: id, success: false, status: 410, error: "expired" }, "warn");
      recordExportEvent({
        exportId: id,
        format: "pdf",
        transactionCount: 0,
        timestamp: Date.now(),
        success: false,
        error: "Export expired",
      });
      
      return res.status(410).json({ 
        error: "Export expired",
        message: "The requested export has expired. Please regenerate the export.",
      });
    }
    
    const transactions = getStoredTransactions(id);
    
    if (!transactions || transactions.length === 0) {
      logEvent("export_pdf", { exportId: id, success: false, status: 404 }, "warn");
      recordExportEvent({
        exportId: id,
        format: "pdf",
        transactionCount: 0,
        timestamp: Date.now(),
        success: false,
        error: "Export not found",
      });
      
      return res.status(404).json({ 
        error: "Export not found",
        message: "The requested export is not available.",
      });
    }

    try {
      // Generate stub PDF buffer (real PDF rendering will be implemented later)
      const pdfBuffer = generateStubPDF(transactions);
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `bank-transactions-${timestamp}.pdf`;
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdfBuffer);

      logEvent("export_pdf", {
        exportId: id,
        success: true,
        status: 200,
        transactionCount: transactions.length,
      });
      
      // Log successful export
      recordExportEvent({
        exportId: id,
        format: "pdf",
        transactionCount: transactions.length,
        timestamp: Date.now(),
        success: true,
      });
    } catch (error) {
      logEvent("export_pdf", { exportId: id, success: false, status: 500, error: serializeError(error) }, "error");
      
      recordExportEvent({
        exportId: id,
        format: "pdf",
        transactionCount: transactions.length,
        timestamp: Date.now(),
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      
      res.status(500).json({ 
        error: "Failed to generate PDF export",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}


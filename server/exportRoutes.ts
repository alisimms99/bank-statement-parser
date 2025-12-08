import type { Express, Response } from "express";
import { toCSV } from "@shared/export/csv";
import type { CanonicalTransaction } from "@shared/transactions";
import type { NormalizedTransaction } from "@shared/types";
import { exportEventStore } from "./exportEventStore";

/**
 * Convert CanonicalTransaction to NormalizedTransaction for CSV export
 */
function toNormalized(tx: CanonicalTransaction): NormalizedTransaction {
  return {
    ...tx,
    statement_period: tx.statement_period,
  };
}

function buildCsvFilename(): string {
  const timestamp = new Date().toISOString().split("T")[0];
  return `bank-transactions-${timestamp}.csv`;
}

function buildPdfFilename(): string {
  const timestamp = new Date().toISOString().split("T")[0];
  return `bank-transactions-${timestamp}.pdf`;
}

function getTransactionsOr404(id: string, format: "csv" | "pdf") {
  const transactions = exportEventStore.getTransactions(id);

  if (!transactions || transactions.length === 0) {
    exportEventStore.logEvent({ exportId: id, format, status: "expired" });
    return null;
  }

  return transactions;
}

function sendCsvExport(
  res: Response,
  id: string,
  transactions: CanonicalTransaction[],
  includeBOM: boolean,
) {
  try {
    const normalizedTransactions: NormalizedTransaction[] = transactions.map(toNormalized);
    const csv = toCSV(normalizedTransactions, { includeBOM });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${buildCsvFilename()}"`);
    res.send(csv);

    exportEventStore.logEvent({ exportId: id, format: "csv", status: "success" });
  } catch (error) {
    console.error("Error generating CSV export", error);
    exportEventStore.logEvent({
      exportId: id,
      format: "csv",
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    res.status(500).json({
      error: "Failed to generate CSV export",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

function buildStubPdf(transactions: CanonicalTransaction[]): Buffer {
  const summary = `PDF Export Stub\nTransactions: ${transactions.length}`;
  return Buffer.from(summary, "utf-8");
}

function sendPdfExport(res: Response, id: string, transactions: CanonicalTransaction[]) {
  try {
    const pdfBuffer = buildStubPdf(transactions);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${buildPdfFilename()}"`);
    res.send(pdfBuffer);

    exportEventStore.logEvent({ exportId: id, format: "pdf", status: "success" });
  } catch (error) {
    console.error("Error generating PDF export", error);
    exportEventStore.logEvent({
      exportId: id,
      format: "pdf",
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    res.status(500).json({
      error: "Failed to generate PDF export",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function storeTransactions(transactions: CanonicalTransaction[]): string {
  return exportEventStore.storeTransactions(transactions);
}

export function getTransactions(id: string): CanonicalTransaction[] | null {
  return exportEventStore.getTransactions(id);
}

export function registerExportRoutes(app: Express) {
  app.get("/api/export/:id/csv", (req, res) => {
    const { id } = req.params;
    const includeBOM = req.query.bom === "true" || req.query.bom === "1";

    const transactions = getTransactionsOr404(id, "csv");
    if (!transactions) {
      return res.status(404).json({
        error: "Export not found or expired",
        message: "The requested export is no longer available. Please regenerate the export.",
      });
    }

    sendCsvExport(res, id, transactions, includeBOM);
  });

  app.get("/api/export/:id/pdf", (req, res) => {
    const { id } = req.params;
    const transactions = getTransactionsOr404(id, "pdf");

    if (!transactions) {
      return res.status(404).json({
        error: "Export not found or expired",
        message: "The requested export is no longer available. Please regenerate the export.",
      });
    }

    sendPdfExport(res, id, transactions);
  });
}

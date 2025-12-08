import type { Express } from "express";
import { randomUUID } from "crypto";
import { toCSV } from "@shared/export/csv";
import type { CanonicalTransaction } from "@shared/transactions";
import type { NormalizedTransaction } from "@shared/types";

// In-memory store for transactions (keyed by UUID)
// In production, this could be replaced with Redis or a database
const transactionStore = new Map<string, CanonicalTransaction[]>();

// Clean up old entries after 1 hour
const STORE_TTL_MS = 60 * 60 * 1000;

function cleanupOldEntries() {
  // For now, we'll just clear entries older than TTL on access
  // In production, use a proper TTL mechanism
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
 */
export function storeTransactions(transactions: CanonicalTransaction[]): string {
  const id = randomUUID();
  transactionStore.set(id, transactions);
  
  // Schedule cleanup after TTL
  setTimeout(() => {
    transactionStore.delete(id);
  }, STORE_TTL_MS);
  
  return id;
}

/**
 * Get transactions by ID
 */
export function getTransactions(id: string): CanonicalTransaction[] | null {
  cleanupOldEntries();
  return transactionStore.get(id) ?? null;
}

export function registerExportRoutes(app: Express) {
  /**
   * GET /api/export/:id
   * Export transactions as CSV
   */
  app.get("/api/export/:id", (req, res) => {
    const { id } = req.params;
    const includeBOM = req.query.bom === "true" || req.query.bom === "1";
    
    const transactions = getTransactions(id);
    
    if (!transactions || transactions.length === 0) {
      return res.status(404).json({ 
        error: "Export not found or expired",
        message: "The requested export is no longer available. Please regenerate the export.",
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
    } catch (error) {
      console.error("Error generating CSV export", error);
      res.status(500).json({ 
        error: "Failed to generate CSV export",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}


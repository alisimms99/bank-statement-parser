import type { Express } from "express";
import { nanoid } from "nanoid";
import { toCSV } from "@shared/export/csv";
import type { NormalizedTransaction } from "@shared/types";

// Interface for stored export data with timestamp
interface StoredExport {
  transactions: NormalizedTransaction[];
  timestamp: number;
}

// In-memory storage for parsed transactions (temporary storage with UUIDs)
// In production, you might want to use Redis or a proper database
const transactionStore = new Map<string, StoredExport>();

// TTL for stored transactions (30 minutes)
const STORAGE_TTL = 30 * 60 * 1000;

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  const idsToDelete: string[] = [];
  
  transactionStore.forEach((data, id) => {
    if (now - data.timestamp > STORAGE_TTL) {
      idsToDelete.push(id);
    }
  });
  
  idsToDelete.forEach(id => transactionStore.delete(id));
}, 5 * 60 * 1000); // Check every 5 minutes

/**
 * Parse boolean query parameter safely
 */
function parseBoolean(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    return lower === 'true' || lower === '1' || lower === 'yes';
  }
  return false;
}

/**
 * Store transactions and return a UUID for later retrieval
 */
export function storeTransactions(transactions: NormalizedTransaction[]): string {
  const id = nanoid();
  transactionStore.set(id, {
    transactions,
    timestamp: Date.now(),
  });
  return id;
}

/**
 * Retrieve transactions by UUID
 */
export function getTransactions(id: string): NormalizedTransaction[] | null {
  const stored = transactionStore.get(id);
  return stored ? stored.transactions : null;
}

export function registerExportRoutes(app: Express) {
  /**
   * POST /api/export - Store transactions and return an ID
   */
  app.post("/api/export", (req, res) => {
    try {
      const { transactions } = req.body;

      if (!Array.isArray(transactions) || transactions.length === 0) {
        return res.status(400).json({ error: "Invalid or empty transactions array" });
      }

      const id = storeTransactions(transactions);
      return res.json({ id });
    } catch (error) {
      console.error("Error storing transactions for export:", error);
      return res.status(500).json({ error: "Failed to prepare export" });
    }
  });

  /**
   * GET /api/export/:id - Generate and download CSV
   */
  app.get("/api/export/:id", (req, res) => {
    try {
      const { id } = req.params;
      const includeBOM = parseBoolean(req.query.includeBOM);

      const transactions = getTransactions(id);
      
      if (!transactions) {
        return res.status(404).json({ error: "Export not found or expired" });
      }

      const csv = toCSV(transactions, { includeBOM });
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `bank-transactions-${timestamp}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      console.error("Error generating CSV export:", error);
      return res.status(500).json({ error: "Failed to generate CSV" });
    }
  });
}

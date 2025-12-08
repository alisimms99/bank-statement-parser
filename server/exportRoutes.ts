import type { Express } from "express";
import { nanoid } from "nanoid";
import { toCSV } from "@shared/export/csv";
import type { NormalizedTransaction } from "@shared/types";

// In-memory storage for parsed transactions (temporary storage with UUIDs)
// In production, you might want to use Redis or a proper database
const transactionStore = new Map<string, NormalizedTransaction[]>();

// TTL for stored transactions (30 minutes)
const STORAGE_TTL = 30 * 60 * 1000;

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  const idsToDelete: string[] = [];
  
  transactionStore.forEach((data, id) => {
    const timestamp = (data as any).__timestamp;
    if (timestamp && now - timestamp > STORAGE_TTL) {
      idsToDelete.push(id);
    }
  });
  
  idsToDelete.forEach(id => transactionStore.delete(id));
}, 5 * 60 * 1000); // Check every 5 minutes

/**
 * Store transactions and return a UUID for later retrieval
 */
export function storeTransactions(transactions: NormalizedTransaction[]): string {
  const id = nanoid();
  const dataWithTimestamp = transactions as any;
  dataWithTimestamp.__timestamp = Date.now();
  transactionStore.set(id, transactions);
  return id;
}

/**
 * Retrieve transactions by UUID
 */
export function getTransactions(id: string): NormalizedTransaction[] | null {
  return transactionStore.get(id) || null;
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
      const includeBOM = req.query.includeBOM === "true";

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

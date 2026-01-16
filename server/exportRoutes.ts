import type { Express } from "express";
import { createHash, randomUUID } from "crypto";
import { toCSV } from "@shared/export/csv";
import type { CanonicalTransaction } from "@shared/transactions";
import type { NormalizedTransaction } from "@shared/types";
import { recordExportEvent, type ExportFormat } from "./_core/exportMetrics";
import { logEvent, serializeError } from "./_core/log";
import { requireAuth, type AuthenticatedRequest } from "./middleware/auth";
import { ENV } from "./_core/env";

// In-memory store for transactions (keyed by UUID)
interface StoredEntry {
  data: NormalizedTransaction[];
  createdAt: number;
}

const transactionStore = new Map<string, StoredEntry>();

// Clean up old entries after 1 hour
const STORE_TTL_MS = 60 * 60 * 1000;

// Cleanup interval: every 10 minutes
setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];
  transactionStore.forEach((entry, key) => {
    if (now - entry.createdAt > STORE_TTL_MS) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach(key => transactionStore.delete(key));
}, 10 * 60 * 1000);

function toSheetsRow(tx: NormalizedTransaction): string[] {
  const amount = tx.credit !== undefined && tx.credit !== null && tx.credit !== 0
    ? tx.credit
    : (tx.debit !== undefined && tx.debit !== null ? -tx.debit : 0);

  return [
    tx.date || "",
    tx.payee || tx.description || "",
    tx.description || "",
    amount.toString(),
    tx.balance?.toString() || "",
    "",
    "",
    new Date().toISOString().split("T")[0],
  ];
}

function computeTransactionHash(tx: NormalizedTransaction): string {
  const row = toSheetsRow(tx);
  row[6] = "";
  row[7] = "";
  const stable = row.join("\u001f");
  return createHash("sha256").update(stable, "utf8").digest("hex");
}

async function fetchWithAuth(url: string, accessToken: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function registerExportRoutes(app: Express): void {
  // Store transactions temporarily for export
  app.post("/api/export/store", async (req, res) => {
    try {
      const { transactions } = req.body;
      if (!transactions || !Array.isArray(transactions)) {
        return res.status(400).json({ error: "transactions array required" });
      }

      const exportId = randomUUID();
      transactionStore.set(exportId, {
        data: transactions,
        createdAt: Date.now(),
      });

      logEvent("export.store", { exportId, count: transactions.length });
      return res.json({ exportId, count: transactions.length });
    } catch (error) {
      logEvent("export.store.error", serializeError(error));
      return res.status(500).json({ error: "Failed to store transactions" });
    }
  });

  // Download stored transactions as CSV
  app.get("/api/export/csv/:exportId", async (req, res) => {
    try {
      const { exportId } = req.params;
      const entry = transactionStore.get(exportId);

      if (!entry) {
        return res.status(404).json({ error: "Export not found or expired" });
      }

      const includeBom = req.query.bom !== "false";
      const csv = toCSV(entry.data as CanonicalTransaction[], { includeBOM: includeBom });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="transactions-${exportId.slice(0, 8)}.csv"`);

      recordExportEvent({ format: "csv", transactionCount: entry.data.length });
      logEvent("export.csv.download", { exportId, count: entry.data.length });

      return res.send(csv);
    } catch (error) {
      logEvent("export.csv.error", serializeError(error));
      return res.status(500).json({ error: "Failed to generate CSV" });
    }
  });

  // Export to Google Sheets (simplified version using service account)
  app.post("/api/export/sheets", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { spreadsheetId, transactions } = req.body;

      if (!spreadsheetId) {
        return res.status(400).json({ error: "spreadsheetId required" });
      }

      if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
        return res.status(400).json({ error: "transactions array required" });
      }

      const user = req.user;
      if (!user?.accessToken) {
        return res.status(401).json({ error: "User access token not available. Please re-authenticate." });
      }

      // Prepare rows for Sheets API
      const headers = ["Date", "Description", "Original Description", "Amount", "Balance", "Category", "Source", "Import Date"];
      const dataRows = transactions.map(toSheetsRow);

      // First, check if sheet exists and has headers
      const spreadsheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
      const spreadsheetRes = await fetchWithAuth(spreadsheetUrl, user.accessToken, { method: "GET" });

      if (!spreadsheetRes.ok) {
        const errorText = await spreadsheetRes.text();
        logEvent("export.sheets.error", { error: errorText, spreadsheetId });
        return res.status(400).json({
          error: "Could not access spreadsheet. Make sure it exists and you have edit access.",
          details: errorText,
        });
      }

      // Append data to the first sheet
      const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A:H:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

      const appendRes = await fetchWithAuth(appendUrl, user.accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: dataRows,
        }),
      });

      if (!appendRes.ok) {
        const errorText = await appendRes.text();
        logEvent("export.sheets.append.error", { error: errorText, spreadsheetId });
        return res.status(500).json({
          error: "Failed to append data to spreadsheet",
          details: errorText,
        });
      }

      const result = await appendRes.json();

      recordExportEvent({ format: "sheets", transactionCount: transactions.length });
      logEvent("export.sheets.success", {
        spreadsheetId,
        count: transactions.length,
        updatedRange: result.updates?.updatedRange,
      });

      return res.json({
        success: true,
        count: transactions.length,
        spreadsheetId,
        updatedRange: result.updates?.updatedRange,
      });
    } catch (error) {
      logEvent("export.sheets.error", serializeError(error));
      return res.status(500).json({ error: "Failed to export to Google Sheets" });
    }
  });

  // Health check for export service
  app.get("/api/export/health", (_req, res) => {
    res.json({
      status: "ok",
      storedExports: transactionStore.size,
    });
  });
}

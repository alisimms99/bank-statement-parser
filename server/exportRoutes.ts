import type { Express } from "express";
import { createHash, randomUUID } from "crypto";
import { toCSV } from "@shared/export/csv";
import type { CanonicalTransaction } from "@shared/transactions";
import type { NormalizedTransaction } from "@shared/types";
import { recordExportEvent, type ExportFormat } from "./_core/exportMetrics";
import { logEvent, serializeError } from "./_core/log";
import { requireAuth } from "./middleware/auth";
import { OAuth2Client } from "google-auth-library";
import { ENV } from "./_core/env";
import { getAccounts, checkImportExists, storeImportLog, getImportLogs } from "./db";
import { verifySessionToken } from "./middleware/auth";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "@shared/const";

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

const SHEETS_TRANSACTIONS_SHEET_TITLE = "Transactions";
const SHEETS_HASHES_SHEET_TITLE = "Transaction Hashes";

// Pattern for extracting YYYY-MM from ISO date format (YYYY-MM-DD)
// Intentionally uses partial matching to extract period from full date
const PERIOD_PATTERN = /^(\d{4}-\d{2})/;

function toSheetsRow(tx: CanonicalTransaction): string[] {
  // Spec #129 Columns:
  // A: Date
  // B: Description (normalized)
  // C: Original Description (raw from statement)
  // D: Amount
  // E: Balance (if available, nullable for CCs)
  // F: Category (from QuickBooks history match)
  // G: Source File
  // H: Import Date
  
  const amount = tx.credit !== undefined && tx.credit !== null && tx.credit !== 0 
    ? tx.credit 
    : (tx.debit !== undefined && tx.debit !== null ? -tx.debit : 0);

  return [
    tx.date || "",
    tx.payee || tx.description || "", // Normalized description
    tx.description || "", // Original description
    amount.toString(),
    tx.balance?.toString() || "",
    (tx as any).category || "", // Category from AI/QuickBooks
    (tx as any).sourceFile || "",
    new Date().toISOString().split('T')[0], // Import Date
  ];
}

function computeTransactionHash(tx: CanonicalTransaction): string {
  // Hash a stable projection that ignores volatile fields (source file, import date)
  const row = toSheetsRow(tx);
  // Indices: 0 Date, 1 Normalized Desc, 2 Original Desc, 3 Amount, 4 Balance, 5 Category, 6 Source File, 7 Import Date
  row[6] = ""; // ignore source file
  row[7] = ""; // ignore import date
  const stable = row.join("\u001f");
  return createHash("sha256").update(stable, "utf8").digest("hex");
}

function asSheetCellString(value: string) {
  return { userEnteredValue: { stringValue: value } };
}

function asRowData(values: string[]) {
  return { values: values.map(asSheetCellString) };
}

function escapeSheetTabNameForA1(name: string): string {
  if (/^[a-zA-Z0-9_]+$/.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

async function fetchJsonWithAuth(
  url: string,
  accessToken: string,
  init: RequestInit
): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await res.text();
  const json = text.length > 0 ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(json?.error?.message || json?.message || `Request failed: ${res.status}`);
  }

  return json;
}

function pickUnusedSheetId(used: Set<number>): number {
  // Sheets uses 32-bit signed ints for sheetId.
  for (let attempts = 0; attempts < 20; attempts++) {
    const candidate = Math.floor(Math.random() * 2_000_000_000) + 1;
    if (!used.has(candidate)) return candidate;
  }
  // Fallback: extremely unlikely to collide after 20 attempts.
  return Date.now() % 2_000_000_000;
}

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
   * POST /api/sheets/validate
   * Pre-upload validation for Google Sheets sync
   */
  app.post("/api/sheets/validate", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const { account_id, statement_periods } = req.body;
      const accountIdNum: number =
        typeof account_id === "string" ? Number.parseInt(account_id, 10) : account_id;
      if (Number.isNaN(accountIdNum) || !statement_periods || !Array.isArray(statement_periods)) {
        return res.status(400).json({ error: "Missing account_id or statement_periods" });
      }

      // Ensure the account belongs to the requester
      const accounts = await getAccounts(user.id);
      const account = accounts.find((a) => a.id === accountIdNum);
      if (!account) {
        return res.status(404).json({ error: "Account not found or access denied" });
      }

      const warnings = [];
      const new_periods = [];

      for (const period of statement_periods) {
        const exists = await checkImportExists(accountIdNum, period);
        if (exists) {
          warnings.push({ period, status: "already_imported" });
        } else {
          new_periods.push(period);
        }
      }

      res.json({
        valid: true,
        warnings,
        new_periods,
      });
    } catch (error) {
      res.status(500).json({ error: "Validation failed" });
    }
  });

  /**
   * POST /api/sheets/sync
   * Robust Google Sheets synchronization
   */
  app.post("/api/sheets/sync", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const { account_id, year, transactions, statement_periods, file_hashes } = req.body;

      if (!account_id || !year || !transactions || !statement_periods) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // 1. Validate account
      const accounts = await getAccounts(user.id);
      const accountIdNum: number =
        typeof account_id === "string" ? Number.parseInt(account_id, 10) : account_id;
      const account = accounts.find(a => a.id === accountIdNum);
      if (!account) {
        return res.status(404).json({ error: "Account not found or access denied" });
      }

      // 2. Check for duplicate periods
      const newPeriods = [];
      for (const period of statement_periods) {
        const exists = await checkImportExists(accountIdNum, period);
        if (!exists) {
          newPeriods.push(period);
        }
      }

      if (newPeriods.length === 0) {
        return res.json({
          success: true,
          message: "All periods already imported",
          transactions_added: 0,
          duplicates_skipped: transactions.length,
        });
      }

      // 3. Resolve target Sheet + Tab
      const masterSheetId = ENV.googleSheetsMasterId; // From env as per spec
      if (!masterSheetId) {
        return res.status(500).json({ error: "Master Sheet ID not configured" });
      }

      const tabName = `${account.accountName}-${account.accountLast4 || "XXXX"}-${year}`;
      
      // Get access token
      const cookieHeader = req.headers.cookie;
      const cookies = parseCookie(cookieHeader || "");
      const sessionToken = cookies[COOKIE_NAME];
      const session = await verifySessionToken(sessionToken || "");
      
      if (!session || !session.accessToken) {
        return res.status(401).json({ error: "Authentication required" });
      }

      // 4. Append transactions
      const spreadsheetId = masterSheetId;
      const finalSheetTabName = tabName;

      // Get the spreadsheet metadata to find the Transactions and Hashes sheets
      const spreadsheet = await fetchJsonWithAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
        session.accessToken,
        { method: "GET" }
      );

      let transactionsSheet = spreadsheet.sheets.find(
        (s: any) => s.properties.title === finalSheetTabName
      );
      let hashesSheet = spreadsheet.sheets.find(
        (s: any) => s.properties.title === SHEETS_HASHES_SHEET_TITLE
      );

      const usedSheetIds = new Set<number>(
        spreadsheet.sheets.map((s: any) => s.properties.sheetId)
      );

      const setupRequests: any[] = [];

      if (!transactionsSheet) {
        const sheetId = pickUnusedSheetId(usedSheetIds);
        usedSheetIds.add(sheetId);
        setupRequests.push({
          addSheet: {
            properties: {
              title: finalSheetTabName,
              sheetId,
              gridProperties: { frozenRowCount: 1 },
              tabColor: account.accountType === "bank" ? { blue: 1.0 } : { green: 1.0 },
            },
          },
        });
        setupRequests.push({
          updateCells: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 8,
            },
            rows: [
              asRowData([
                "Date",
                "Description (normalized)",
                "Original Description",
                "Amount",
                "Balance",
                "Category",
                "Source File",
                "Import Date",
              ]),
            ],
            fields: "userEnteredValue",
          },
        });
        setupRequests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        });
        setupRequests.push({
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 8 },
          },
        });
      }

      if (!hashesSheet) {
        const sheetId = pickUnusedSheetId(usedSheetIds);
        usedSheetIds.add(sheetId);
        setupRequests.push({
          addSheet: {
            properties: {
              title: SHEETS_HASHES_SHEET_TITLE,
              sheetId,
              hidden: true,
            },
          },
        });
      }

      if (setupRequests.length > 0) {
        await fetchJsonWithAuth(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          session.accessToken,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requests: setupRequests }),
          }
        );

        // Refresh metadata
        const updatedSpreadsheet = await fetchJsonWithAuth(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
          session.accessToken,
          { method: "GET" }
        );
        transactionsSheet = updatedSpreadsheet.sheets.find(
          (s: any) => s.properties.title === finalSheetTabName
        );
        hashesSheet = updatedSpreadsheet.sheets.find(
          (s: any) => s.properties.title === SHEETS_HASHES_SHEET_TITLE
        );
      }

      // Fetch existing hashes for deduplication
      const hashesResponse = await fetchJsonWithAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
          `${escapeSheetTabNameForA1(SHEETS_HASHES_SHEET_TITLE)}!A:A`
        )}`,
        session.accessToken,
        { method: "GET" }
      );

      const existingHashes = new Set<string>(
        (hashesResponse.values || []).map((row: string[]) => row[0])
      );

      const transactionsToAppend: CanonicalTransaction[] = [];
      const hashesToAppend: string[] = [];

      for (const tx of transactions) {
        const hash = computeTransactionHash(tx);
        if (!existingHashes.has(hash)) {
          transactionsToAppend.push(tx);
          hashesToAppend.push(hash);
        }
      }

      if (transactionsToAppend.length > 0) {
        const appendRequests = [
          {
            appendCells: {
              sheetId: transactionsSheet!.properties.sheetId,
              rows: transactionsToAppend.map((tx) => asRowData(toSheetsRow(tx))),
              fields: "userEnteredValue",
            },
          },
          {
            appendCells: {
              sheetId: hashesSheet!.properties.sheetId,
              rows: hashesToAppend.map((h) => asRowData([h])),
              fields: "userEnteredValue",
            },
          },
        ];

        await fetchJsonWithAuth(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          session.accessToken,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requests: appendRequests }),
          }
        );
      }

      // 5. Update Import Log
      // Group transactions by period once for better performance
      const transactionsByPeriod = new Map<string, number>();
      for (const tx of transactions) {
        const txDate = tx.date ?? tx.posted_date;
        if (!txDate) continue;
        
        // Extract YYYY-MM from ISO date format (YYYY-MM-DD)
        const periodMatch = txDate.match(PERIOD_PATTERN);
        const txPeriod = periodMatch?.[1];
        if (!txPeriod) continue;
        
        transactionsByPeriod.set(txPeriod, (transactionsByPeriod.get(txPeriod) || 0) + 1);
      }

      for (let i = 0; i < statement_periods.length; i++) {
        const period = statement_periods[i];
        if (newPeriods.includes(period)) {
          const periodTransactionCount = transactionsByPeriod.get(period) || 0;

          await storeImportLog({
            userId: user.id,
            accountId: account.id,
            statementPeriod: period,
            statementYear: year,
            fileHash: file_hashes?.[i] || null,
            transactionCount: periodTransactionCount,
            sheetTabName: tabName,
          });
        }
      }

      // 6. Sync CONFIG tabs (Audit Trail)
      let registrySheet = spreadsheet.sheets.find((s: any) => s.properties.title === "_Account Registry");
      let importLogSheet = spreadsheet.sheets.find((s: any) => s.properties.title === "_Import Log");
      
      const auditRequests: any[] = [];
      if (!registrySheet) {
        auditRequests.push({ addSheet: { properties: { title: "_Account Registry", index: spreadsheet.sheets.length } } });
      }
      if (!importLogSheet) {
        auditRequests.push({ addSheet: { properties: { title: "_Import Log", index: spreadsheet.sheets.length + 1 } } });
      }

      if (auditRequests.length > 0) {
        await fetchJsonWithAuth(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          session.accessToken,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests: auditRequests }) }
        );
        // Refresh metadata to capture newly-created sheet IDs
        const refreshed = await fetchJsonWithAuth(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
          session.accessToken,
          { method: "GET" }
        );
        registrySheet = refreshed.sheets.find((s: any) => s.properties.title === "_Account Registry");
        importLogSheet = refreshed.sheets.find((s: any) => s.properties.title === "_Import Log");
      }

      // Update Audit Trail Content
      const allAccounts = await getAccounts(user.id);
      const allImports = await getImportLogs(user.id);

      if (!registrySheet || !importLogSheet) {
        throw new Error("Failed to locate audit sheets after creation");
      }

      const updateAuditRequests = [
        {
          updateCells: {
            range: { sheetId: registrySheet.properties.sheetId, startRowIndex: 0, startColumnIndex: 0 },
            rows: [
              asRowData(["ID", "Account Name", "Last 4", "Type", "Issuer", "Active"]),
              ...allAccounts.map(a => asRowData([a.id.toString(), a.accountName, a.accountLast4 || "", a.accountType, a.issuer || "", a.isActive ? "Yes" : "No"]))
            ],
            fields: "userEnteredValue"
          }
        },
        {
          updateCells: {
            range: { sheetId: importLogSheet.properties.sheetId, startRowIndex: 0, startColumnIndex: 0 },
            rows: [
              asRowData(["ID", "Account ID", "Period", "Year", "File Hash", "File Name", "Tx Count", "Tab Name", "Imported At"]),
              ...allImports.map((l: any) => asRowData([l.id.toString(), l.accountId?.toString() || "", l.statementPeriod, l.statementYear.toString(), l.fileHash || "", l.fileName || "", l.transactionCount?.toString() || "", l.sheetTabName || "", l.importedAt.toISOString()]))
            ],
            fields: "userEnteredValue"
          }
        }
      ];

      await fetchJsonWithAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        session.accessToken,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests: updateAuditRequests }) }
      );

      res.json({
        success: true,
        tab_name: tabName,
        transactions_added: transactionsToAppend.length,
        duplicates_skipped: transactions.length - transactionsToAppend.length,
        sheet_url: `https://docs.google.com/spreadsheets/d/${masterSheetId}`,
      });

    } catch (error) {
      console.error("Sync failed:", error);
      res.status(500).json({ error: "Sync failed" });
    }
  });

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
      const csv = toCSV(transactions.map(toNormalized), { includeBOM });
      
      logEvent("export_csv", { exportId: id, includeBOM, success: true, status: 200 });
      recordExportEvent({
        exportId: id,
        format: "csv",
        transactionCount: transactions.length,
        timestamp: Date.now(),
        success: true,
      });
      
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="transactions-${id}.csv"`);
      res.send(csv);
    } catch (error) {
      logEvent("export_csv", { exportId: id, includeBOM, success: false, status: 500, error: serializeError(error) }, "error");
      
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
   * GET /api/export/:id/pdf
   * Export transactions as PDF
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
      const pdfBuffer = generateStubPDF(transactions);
      
      logEvent("export_pdf", { exportId: id, success: true, status: 200 });
      recordExportEvent({
        exportId: id,
        format: "pdf",
        transactionCount: transactions.length,
        timestamp: Date.now(),
        success: true,
      });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="transactions-${id}.pdf"`);
      res.send(pdfBuffer);
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

  /**
   * POST /api/export/sheets
   * Export transactions to Google Sheets
   * Supports both 'create' and 'append' modes
   */
  app.post("/api/export/sheets", requireAuth, async (req, res) => {
    try {
      const {
        transactions,
        folderId,
        sheetName,
        mode = "create",
        spreadsheetId: providedSpreadsheetId,
        sheetTabName,
      } = req.body ?? {};

      const isAppendMode =
        (typeof mode === "string" && mode.toLowerCase() === "append") ||
        (typeof providedSpreadsheetId === "string" && providedSpreadsheetId.length > 0);

      const finalSheetTabName =
        typeof sheetTabName === "string" && sheetTabName.trim()
          ? sheetTabName.trim()
          : "Transactions";

      const escapeSheetTabNameForA1 = (tabName: string) => tabName.replace(/'/g, "''");

      if (!Array.isArray(transactions) || transactions.length === 0) {
        return res.status(400).json({
          error: "Invalid request",
          message: "transactions array is required and must not be empty",
        });
      }

      // folderId is only required for 'create' mode
      if (!isAppendMode && (!folderId || typeof folderId !== "string")) {
        return res.status(400).json({
          error: "Invalid request",
          message: "folderId is required for create mode",
        });
      }

      // sheetName is only required for 'create' mode
      if (!isAppendMode && (!sheetName || typeof sheetName !== "string")) {
        return res.status(400).json({
          error: "Invalid request",
          message: "sheetName is required for create mode",
        });
      }

      if (isAppendMode && (!providedSpreadsheetId || typeof providedSpreadsheetId !== "string")) {
        return res.status(400).json({
          error: "Invalid request",
          message: "spreadsheetId is required for append mode",
        });
      }

      // Get access token from session
      const cookieHeader = req.headers.cookie;
      if (!cookieHeader) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const cookies = parseCookie(cookieHeader);
      const sessionToken = cookies[COOKIE_NAME];

      if (!sessionToken) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const session = await verifySessionToken(sessionToken);
      if (!session || !session.accessToken) {
        return res.status(401).json({ error: "No access token available. Please sign in again." });
      }

      // Initialize Google Sheets API (kept for parity with other Google flows)
      const oauth2Client = new OAuth2Client();
      oauth2Client.setCredentials({
        access_token: session.accessToken,
      });

      let spreadsheetId: string;
      let sheetUrl: string;
      let appendedCount = 0;
      let skippedDuplicateCount = 0;

      if (isAppendMode) {
        // APPEND MODE: Add transactions to existing spreadsheet
        spreadsheetId = providedSpreadsheetId!;

        // Get the spreadsheet metadata to find the Transactions and Hashes sheets
        const spreadsheet = await fetchJsonWithAuth(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
          session.accessToken,
          { method: "GET" }
        );

        sheetUrl = spreadsheet.spreadsheetUrl;

        let transactionsSheet = spreadsheet.sheets.find(
          (s: any) => s.properties.title === finalSheetTabName
        );
        let hashesSheet = spreadsheet.sheets.find(
          (s: any) => s.properties.title === SHEETS_HASHES_SHEET_TITLE
        );

        const usedSheetIds = new Set<number>(
          spreadsheet.sheets.map((s: any) => s.properties.sheetId)
        );

        const setupRequests: any[] = [];

        if (!transactionsSheet) {
          const sheetId = pickUnusedSheetId(usedSheetIds);
          usedSheetIds.add(sheetId);
          setupRequests.push({
            addSheet: {
              properties: {
                title: finalSheetTabName,
                sheetId,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          });
          setupRequests.push({
            updateCells: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 10,
              },
              rows: [
                asRowData([
                  "Date",
                  "Description",
                  "Payee",
                  "Debit",
                  "Credit",
                  "Balance",
                  "Account ID",
                  "Source Bank",
                  "Period Start",
                  "Period End",
                ]),
              ],
              fields: "userEnteredValue",
            },
          });
          setupRequests.push({
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: "userEnteredFormat.textFormat.bold",
            },
          });
          setupRequests.push({
            autoResizeDimensions: {
              dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 10 },
            },
          });
        }

        if (!hashesSheet) {
          const sheetId = pickUnusedSheetId(usedSheetIds);
          usedSheetIds.add(sheetId);
          setupRequests.push({
            addSheet: {
              properties: {
                title: SHEETS_HASHES_SHEET_TITLE,
                sheetId,
                hidden: true,
              },
            },
          });
        }

        if (setupRequests.length > 0) {
          const setupResult = await fetchJsonWithAuth(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
            session.accessToken,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ requests: setupRequests }),
            }
          );

          // Refresh metadata to get the new sheet objects
          if (!transactionsSheet || !hashesSheet) {
            const updatedSpreadsheet = await fetchJsonWithAuth(
              `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
              session.accessToken,
              { method: "GET" }
            );
            transactionsSheet = updatedSpreadsheet.sheets.find(
              (s: any) => s.properties.title === finalSheetTabName
            );
            hashesSheet = updatedSpreadsheet.sheets.find(
              (s: any) => s.properties.title === SHEETS_HASHES_SHEET_TITLE
            );
          }
        }

        // Fetch existing hashes for deduplication
        const hashesResponse = await fetchJsonWithAuth(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
            `${escapeSheetTabNameForA1(SHEETS_HASHES_SHEET_TITLE)}!A:A`
          )}`,
          session.accessToken,
          { method: "GET" }
        );

        const existingHashes = new Set<string>(
          (hashesResponse.values || []).map((row: string[]) => row[0])
        );

        const transactionsToAppend: CanonicalTransaction[] = [];
        const hashesToAppend: string[] = [];

        for (const tx of transactions) {
          const hash = computeTransactionHash(tx);
          if (!existingHashes.has(hash)) {
            transactionsToAppend.push(tx);
            hashesToAppend.push(hash);
          } else {
            skippedDuplicateCount++;
          }
        }

        appendedCount = transactionsToAppend.length;

        if (appendedCount > 0) {
          const appendRequests = [
            {
              appendCells: {
                sheetId: transactionsSheet!.properties.sheetId,
                rows: transactionsToAppend.map((tx) => asRowData(toSheetsRow(tx))),
                fields: "userEnteredValue",
              },
            },
            {
              appendCells: {
                sheetId: hashesSheet!.properties.sheetId,
                rows: hashesToAppend.map((h) => asRowData([h])),
                fields: "userEnteredValue",
              },
            },
          ];

          await fetchJsonWithAuth(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
            session.accessToken,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ requests: appendRequests }),
            }
          );
        }
      } else {
        // CREATE MODE: Create new spreadsheet
        const createResponse = await fetchJsonWithAuth(
          "https://sheets.googleapis.com/v4/spreadsheets",
          session.accessToken,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              properties: { title: sheetName },
              sheets: [
                {
                  properties: {
                    title: finalSheetTabName,
                    sheetId: 0,
                    gridProperties: { frozenRowCount: 1 },
                  },
                },
                {
                  properties: {
                    title: SHEETS_HASHES_SHEET_TITLE,
                    sheetId: 1,
                    hidden: true,
                  },
                },
              ],
            }),
          }
        );

        spreadsheetId = createResponse.spreadsheetId;
        sheetUrl = createResponse.spreadsheetUrl;

        // Move to folder if specified
        if (folderId) {
          await fetchJsonWithAuth(
            `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?addParents=${folderId}`,
            session.accessToken,
            { method: "PATCH" }
          );
        }

        const hashesToAppend = transactions.map(computeTransactionHash);
        appendedCount = transactions.length;

        const initialRequests = [
          {
            updateCells: {
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 10,
              },
              rows: [
                asRowData([
                  "Date",
                  "Description",
                  "Payee",
                  "Debit",
                  "Credit",
                  "Balance",
                  "Account ID",
                  "Source Bank",
                  "Period Start",
                  "Period End",
                ]),
              ],
              fields: "userEnteredValue",
            },
          },
          {
            repeatCell: {
              range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: "userEnteredFormat.textFormat.bold",
            },
          },
          {
            appendCells: {
              sheetId: 0,
              rows: transactions.map((tx) => asRowData(toSheetsRow(tx))),
              fields: "userEnteredValue",
            },
          },
          {
            appendCells: {
              sheetId: 1,
              rows: hashesToAppend.map((h) => asRowData([h])),
              fields: "userEnteredValue",
            },
          },
          {
            autoResizeDimensions: {
              dimensions: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: 10 },
            },
          },
        ];

        await fetchJsonWithAuth(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
          session.accessToken,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requests: initialRequests }),
          }
        );
      }

      logEvent("export_sheets", {
        exportId: spreadsheetId,
        success: true,
        status: 200,
        transactionCount: appendedCount,
        skippedDuplicateCount,
        sheetName: isAppendMode ? undefined : sheetName,
        folderId: isAppendMode ? undefined : folderId,
        sheetTabName: finalSheetTabName,
      });

      recordExportEvent({
        exportId: spreadsheetId,
        format: "sheets" as ExportFormat,
        transactionCount: appendedCount,
        timestamp: Date.now(),
        success: true,
      });

      res.json({
        success: true,
        spreadsheetId,
        sheetUrl,
        appendedCount,
        skippedDuplicateCount,
      });
    } catch (error) {
      logEvent(
        "export_sheets",
        {
          success: false,
          status: 500,
          error: serializeError(error),
        },
        "error"
      );

      recordExportEvent({
        exportId: "failed",
        format: "sheets" as ExportFormat,
        transactionCount: 0,
        timestamp: Date.now(),
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      res.status(500).json({
        error: "Failed to export to Google Sheets",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}

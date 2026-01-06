import { createHash } from "crypto";
import fs from "fs";
import type { CanonicalTransaction } from "@shared/transactions";
import { google } from "googleapis";
import type { drive_v3, sheets_v4 } from "googleapis";

/**
 * Generate a SHA256 hash for a transaction
 * Hash is based on: date + amount + description
 */
export function hashTransaction(tx: CanonicalTransaction): string {
  const amount = tx.debit || tx.credit || 0;
  // Keep consistent with exported sheet values: fall back to posted_date when date is null/undefined.
  const effectiveDate = tx.date ?? tx.posted_date ?? "";
  const hashInput = `${effectiveDate}|${amount}|${tx.description ?? ""}`;
  return createHash("sha256").update(hashInput).digest("hex");
}

/**
 * Get existing transaction hashes from the Hashes sheet
 */
export async function getExistingHashes(
  spreadsheetId: string,
  accessToken: string
): Promise<Set<string>> {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Hashes!A:A`,
    {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    // If the Hashes sheet doesn't exist, return empty set
    if (response.status === 400) {
      return new Set<string>();
    }
    let errorText = "";
    try {
      errorText = await response.text();
    } catch {
      // If we can't read the response body, use a generic message
      errorText = response.statusText || "Unknown error";
    }
    throw new Error(`Failed to fetch existing hashes (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const hashes = new Set<string>();
  
  if (data.values && Array.isArray(data.values)) {
    // Skip the header row if it exists
    const startIndex = data.values[0]?.[0] === "Hash" ? 1 : 0;
    for (let i = startIndex; i < data.values.length; i++) {
      if (data.values[i]?.[0]) {
        hashes.add(data.values[i][0]);
      }
    }
  }

  return hashes;
}

/**
 * Ensure the Hashes sheet exists and is hidden
 */
export async function ensureHashesSheet(
  spreadsheetId: string,
  accessToken: string
): Promise<number> {
  try {
    // First, get the spreadsheet metadata to check if Hashes sheet exists
    const metadataResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
        },
      }
    );

    if (!metadataResponse.ok) {
      throw new Error("Failed to fetch spreadsheet metadata");
    }

    const metadata = await metadataResponse.json();
    const hashesSheet = metadata.sheets?.find(
      (sheet: any) => sheet.properties.title === "Hashes"
    );

    if (hashesSheet) {
      // Sheet exists, return its ID
      return hashesSheet.properties.sheetId;
    }

    // Create the Hashes sheet
    const createResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: "Hashes",
                  hidden: true,
                },
              },
            },
          ],
        }),
      }
    );

    if (!createResponse.ok) {
      const error = await createResponse.json();
      throw new Error(error.error?.message || "Failed to create Hashes sheet");
    }

    const createResult = await createResponse.json();
    const newSheetId = createResult.replies[0].addSheet.properties.sheetId;

    // Add header row to Hashes sheet
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Hashes!A1:append?valueInputOption=RAW`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: [["Hash"]],
        }),
      }
    );

    return newSheetId;
  } catch (error) {
    console.error("Error ensuring Hashes sheet:", error);
    throw error;
  }
}

/**
 * Append new hashes to the Hashes sheet
 */
export async function appendHashes(
  spreadsheetId: string,
  accessToken: string,
  hashes: string[]
): Promise<void> {
  if (hashes.length === 0) {
    return;
  }

  try {
    const values = hashes.map(hash => [hash]);
    
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Hashes!A:A:append?valueInputOption=RAW`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "Failed to append hashes");
    }
  } catch (error) {
    console.error("Error appending hashes:", error);
    throw error;
  }
}

/**
 * Spreadsheet-level cooperative lock using a Named Range on the Hashes sheet.
 *
 * Rationale:
 * - Google Sheets API does not provide atomic read-then-append semantics.
 * - We serialize append flows by creating a unique NamedRange (constant name).
 * - Creation of a duplicate NamedRange fails, which we interpret as "locked".
 * - We retry with backoff. As a safety valve, if a stale lock is detected
 *   (based on a timestamp written to Hashes!Z1), we delete it.
 *
 * NOTE: This is best-effort to prevent duplicate appends in concurrent requests.
 */
export interface SpreadsheetLock {
  namedRangeId: string;
  lockName: string;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire a cooperative lock for append operations.
 * Returns the created namedRangeId which must be passed to releaseSpreadsheetLock.
 *
 * - lockName: constant, spreadsheet-scoped (default: "APPEND_LOCK")
 * - ttlMs: if an existing lock is older than ttlMs, it is considered stale and removed
 * - maxWaitMs: maximum total time to wait before failing to acquire
 */
export async function acquireSpreadsheetLock(params: {
  spreadsheetId: string;
  accessToken: string;
  lockName?: string;
  ttlMs?: number;
  maxWaitMs?: number;
}): Promise<SpreadsheetLock> {
  const {
    spreadsheetId,
    accessToken,
    lockName = "APPEND_LOCK",
    ttlMs = 60_000,
    maxWaitMs = 15_000,
  } = params;

  // Ensure Hashes sheet exists so we have a valid target range
  const hashesSheetId = await ensureHashesSheet(spreadsheetId, accessToken);

  const start = Date.now();
  let attempt = 0;

  // Helper: try to create the named range lock.
  const tryCreateLock = async () => {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              addNamedRange: {
                namedRange: {
                  name: lockName,
                  range: {
                    sheetId: hashesSheetId,
                    startRowIndex: 0,
                    endRowIndex: 1,
                    startColumnIndex: 0,
                    endColumnIndex: 1,
                  },
                },
              },
            },
          ],
        }),
      }
    );

    if (res.ok) {
      const data = await res.json();
      const namedRangeId: string | undefined =
        data?.replies?.[0]?.addNamedRange?.namedRange?.namedRangeId;
      if (!namedRangeId) {
        throw new Error("Lock created but no namedRangeId returned");
      }
      // Write lock timestamp to a harmless cell (Z1) for stale lock detection
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
          "Hashes!Z1"
        )}?valueInputOption=RAW`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            values: [[String(Date.now())]],
          }),
        }
      ).catch(() => {
        // Non-fatal; continue without timestamp
      });

      return { namedRangeId, lockName };
    }

    // Attempt to parse error
    let message = "";
    try {
      const errBody = await res.json();
      message =
        errBody?.error?.message ||
        errBody?.message ||
        (await res.text()) ||
        res.statusText;
    } catch {
      message = res.statusText || "Unknown error";
    }

    // If name already exists, treat as locked
    if (
      res.status === 400 &&
      typeof message === "string" &&
      message.toLowerCase().includes("already exists")
    ) {
      return null;
    }

    // Other errors are fatal
    throw new Error(`Failed to create lock: ${message}`);
  };

  // Helper: try to remove stale lock (if TTL exceeded).
  const tryRemoveStaleLock = async () => {
    // Read lock timestamp
    let ts: number | null = null;
    try {
      const tsRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
          "Hashes!Z1"
        )}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );
      if (tsRes.ok) {
        const tsData = await tsRes.json();
        const raw = tsData?.values?.[0]?.[0];
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) ts = parsed;
      }
    } catch {
      // ignore
    }

    const now = Date.now();
    if (ts && now - ts < ttlMs) {
      // Not stale yet
      return false;
    }

    // Fetch named ranges to get ID
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=namedRanges(namedRangeId,name)`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (!metaRes.ok) return false;
    const meta = await metaRes.json();
    const existing = (meta?.namedRanges ?? []).find(
      (nr: { name?: string }) => nr?.name === lockName
    );
    if (!existing?.namedRangeId) return false;

    // Delete the stale lock
    const delRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              deleteNamedRange: {
                namedRangeId: existing.namedRangeId,
              },
            },
          ],
        }),
      }
    );
    return delRes.ok;
  };

  while (Date.now() - start < maxWaitMs) {
    const lock = await tryCreateLock();
    if (lock) {
      return lock;
    }

    // Could not acquire due to existing lock.
    // Attempt stale cleanup once in a while.
    if (attempt % 3 === 0) {
      await tryRemoveStaleLock().catch(() => {
        /* ignore */
      });
    }

    attempt++;
    const backoff = Math.min(1000, 150 + attempt * 100);
    const jitter = Math.floor(Math.random() * 100);
    await sleep(backoff + jitter);
  }

  throw new Error(
    "Another export is in progress for this spreadsheet. Please try again shortly."
  );
}

/**
 * Release a previously acquired spreadsheet lock.
 */
export async function releaseSpreadsheetLock(params: {
  spreadsheetId: string;
  accessToken: string;
  namedRangeId: string;
}): Promise<void> {
  const { spreadsheetId, accessToken, namedRangeId } = params;
  try {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              deleteNamedRange: {
                namedRangeId,
              },
            },
          ],
        }),
      }
    );
  } catch {
    // Best effort: if release fails, the TTL mechanism will clear stale locks.
  }
}

/**
 * Filter out duplicate transactions based on existing hashes
 * Returns: { uniqueTransactions, duplicateCount }
 */
export function filterDuplicates(
  transactions: CanonicalTransaction[],
  existingHashes: Set<string>
): { uniqueTransactions: CanonicalTransaction[]; duplicateCount: number; newHashes: string[] } {
  const uniqueTransactions: CanonicalTransaction[] = [];
  const newHashes: string[] = [];
  let duplicateCount = 0;

  for (const tx of transactions) {
    const hash = hashTransaction(tx);
    
    if (!existingHashes.has(hash)) {
      uniqueTransactions.push(tx);
      newHashes.push(hash);
      existingHashes.add(hash); // Add to set to catch duplicates within the same batch
    } else {
      duplicateCount++;
    }
  }

  return { uniqueTransactions, duplicateCount, newHashes };
}

export interface SheetsExportParams {
  transactions: CanonicalTransaction[];
  sheetName: string;
  folderId?: string | null;
  /**
   * Dependency injection for tests. If provided, avoids constructing real Google
   * API clients (and avoids needing service account credentials in tests).
   */
  clients?: {
    sheets: sheets_v4.Sheets;
    drive: drive_v3.Drive;
  };
  /**
   * Email of the authenticated user who should have access to the exported file.
   * The spreadsheet is created by a service account, so we must explicitly share it.
   */
  userEmail: string;
}

export interface SheetsExportResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
}

export type SheetsExportErrorKind =
  | "drive_move_failed_spreadsheet_deleted"
  | "drive_move_failed_spreadsheet_retained";

/**
 * Error thrown when a Google Sheets export partially succeeds.
 *
 * In particular, if the spreadsheet is created but cannot be moved to `folderId`,
 * we either delete it (to avoid orphaning) or (if deletion fails) include the URL
 * so the caller can still access it.
 */
export class SheetsExportError extends Error {
  kind: SheetsExportErrorKind;
  spreadsheetId: string;
  spreadsheetUrl: string;
  cleanupError?: unknown;

  constructor(
    message: string,
    opts: {
      kind: SheetsExportErrorKind;
      spreadsheetId: string;
      spreadsheetUrl: string;
      cleanupError?: unknown;
      cause?: unknown;
    }
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(message, opts.cause ? ({ cause: opts.cause } as any) : undefined);
    this.name = "SheetsExportError";
    this.kind = opts.kind;
    this.spreadsheetId = opts.spreadsheetId;
    this.spreadsheetUrl = opts.spreadsheetUrl;
    this.cleanupError = opts.cleanupError;
  }
}

function extractGoogleApiErrorMessage(err: unknown, fallback: string): string {
  if (!err) return fallback;
  const asAny = err as unknown as { errors?: Array<{ message?: string }> };
  const nested = asAny.errors?.[0]?.message;
  if (nested && typeof nested === "string") return nested;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function readEnvOrFile(name: string): string {
  const direct = process.env[name];
  if (direct && direct.length > 0) return direct;

  const filePath = process.env[`${name}_FILE`];
  if (!filePath) return "";

  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function tryParseJsonCredentials(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

function resolveServiceAccountCredentials(): Record<string, unknown> {
  const raw =
    readEnvOrFile("GCP_SERVICE_ACCOUNT_JSON") ||
    readEnvOrFile("GCP_DOCUMENTAI_CREDENTIALS"); // legacy env var name

  const parsed = tryParseJsonCredentials(raw);
  if (parsed) return parsed;

  const serviceAccountPath = process.env.GCP_SERVICE_ACCOUNT_PATH ?? "";
  if (serviceAccountPath) {
    try {
      if (fs.existsSync(serviceAccountPath)) {
        const content = fs.readFileSync(serviceAccountPath, "utf8");
        const fromFile = tryParseJsonCredentials(content);
        if (fromFile) return fromFile;
      }
    } catch {
      // Ignore and fall through to error
    }
  }

  throw new Error(
    "Google service account credentials not configured. Set GCP_SERVICE_ACCOUNT_JSON (or *_FILE) or GCP_SERVICE_ACCOUNT_PATH."
  );
}

async function getGoogleClients(): Promise<{
  sheets: sheets_v4.Sheets;
  drive: drive_v3.Drive;
}> {
  const credentials = resolveServiceAccountCredentials();
  const scopes = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.file",
  ];
  const auth = new google.auth.GoogleAuth({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    credentials: credentials as any,
    scopes,
  });
  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });
  return { sheets, drive };
}

async function shareFileWithUser(params: {
  drive: drive_v3.Drive;
  fileId: string;
  userEmail: string;
}) {
  const { drive, fileId, userEmail } = params;
  if (!userEmail || typeof userEmail !== "string") {
    throw new Error("userEmail is required to share the exported spreadsheet");
  }

  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        type: "user",
        role: "writer",
        emailAddress: userEmail,
      },
      sendNotificationEmail: false,
      fields: "id",
    });
  } catch (err) {
    const message = extractGoogleApiErrorMessage(
      err,
      "Failed to share spreadsheet with user"
    );
    throw new Error(`Drive permission grant failed: ${message}`);
  }
}

function formatISODate(value: string | null | undefined): string {
  if (!value) return "";
  return value.split("T")[0];
}

function toAmount(tx: CanonicalTransaction): number {
  const credit = Number(tx.credit || 0);
  const debit = Number(tx.debit || 0);
  // Convention: credits positive, debits negative
  if (credit > 0) return credit;
  if (debit > 0) return -Math.abs(debit);
  return 0;
}

function buildSheetValues(transactions: CanonicalTransaction[]) {
  const headers = ["Date", "Description", "Payee", "Amount", "Balance"];
  const rows = transactions.map((tx) => [
    // Keep consistent with CSV export: fall back to posted_date when date is missing.
    formatISODate(tx.date ?? tx.posted_date),
    tx.description ?? "",
    tx.payee ?? "",
    toAmount(tx),
    tx.balance ?? "",
  ]);
  return { headers, rows };
}

export async function exportTransactionsToGoogleSheet(
  params: SheetsExportParams
): Promise<SheetsExportResult> {
  const { transactions, sheetName, folderId, userEmail, clients } = params;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    throw new Error("transactions array is required and must not be empty");
  }

  const safeSheetName = (sheetName || "Transactions Export").slice(0, 100);

  const { sheets, drive } = clients ?? (await getGoogleClients());

  // 1) Create spreadsheet
  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: safeSheetName },
      sheets: [{ properties: { title: "Transactions" } }],
    },
    fields: "spreadsheetId,spreadsheetUrl,sheets(properties(sheetId,title))",
  });

  const spreadsheetId = createRes.data.spreadsheetId!;
  const spreadsheetUrl =
    createRes.data.spreadsheetUrl ||
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  const sheetId =
    createRes.data.sheets?.[0]?.properties?.sheetId ?? undefined;
  const sheetTitle =
    createRes.data.sheets?.[0]?.properties?.title ?? "Sheet1";

  // 1b) Ensure the authenticated user can access the file.
  await shareFileWithUser({ drive, fileId: spreadsheetId, userEmail });

  // 2) Write header + rows
  const { headers, rows } = buildSheetValues(transactions);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetTitle}!A1:E${rows.length + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers, ...rows] },
  });

  // 3) Format: freeze header, bold header, date/currency formats, autoresize
  if (typeof sheetId === "number") {
    const requests: sheets_v4.Schema$Request[] = [];

    // Freeze first row
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1 },
        },
        fields: "gridProperties.frozenRowCount",
      },
    });

    // Bold header row
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat.bold",
      },
    });

    if (rows.length > 0) {
      // Date format for column A (index 0), rows 2..N (skip header)
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: rows.length + 1,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" },
            },
          },
          fields: "userEnteredFormat.numberFormat",
        },
      });

      // Currency format for column D (index 3)
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: rows.length + 1,
            startColumnIndex: 3,
            endColumnIndex: 4,
          },
          cell: {
            userEnteredFormat: {
              numberFormat: {
                type: "CURRENCY",
                pattern: '"$"#,##0.00;-"$"#,##0.00',
              },
            },
          },
          fields: "userEnteredFormat.numberFormat",
        },
      });
    }

    // Auto-resize columns A..E
    requests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: 0,
          endIndex: 5,
        },
      },
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  // 4) Move to folder if provided
  if (folderId) {
    try {
      const getRes = await drive.files.get({
        fileId: spreadsheetId,
        fields: "parents",
        supportsAllDrives: true,
      });
      const previousParents = getRes.data.parents?.join(",") ?? "";

      await drive.files.update({
        fileId: spreadsheetId,
        addParents: folderId,
        removeParents: previousParents || undefined,
        fields: "id, parents",
        supportsAllDrives: true,
      });
    } catch (moveErr) {
      const message = extractGoogleApiErrorMessage(
        moveErr,
        "Failed to move spreadsheet to target folder"
      );

      // Best-effort cleanup to avoid orphaning the created sheet in Drive root.
      let cleanupErr: unknown | undefined;
      try {
        await drive.files.delete({
          fileId: spreadsheetId,
          supportsAllDrives: true,
        });
      } catch (err) {
        cleanupErr = err;
      }

      if (!cleanupErr) {
        throw new SheetsExportError(
          `Drive move failed: ${message}. The spreadsheet was deleted to avoid orphaning.`,
          {
            kind: "drive_move_failed_spreadsheet_deleted",
            spreadsheetId,
            spreadsheetUrl,
            cause: moveErr,
          }
        );
      }

      throw new SheetsExportError(
        `Drive move failed: ${message}. The spreadsheet was created successfully and can be accessed at: ${spreadsheetUrl}`,
        {
          kind: "drive_move_failed_spreadsheet_retained",
          spreadsheetId,
          spreadsheetUrl,
          cleanupError: cleanupErr,
          cause: moveErr,
        }
      );
    }
  }

  return { spreadsheetId, spreadsheetUrl };
}


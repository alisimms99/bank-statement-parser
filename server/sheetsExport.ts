import { google, sheets_v4, drive_v3 } from "googleapis";
import { google, sheets_v4 } from "googleapis";
import type { CanonicalTransaction } from "@shared/transactions";
import { getDocumentAiConfig } from "./_core/env";

export interface SheetsExportParams {
  transactions: CanonicalTransaction[];
  sheetName: string;
  folderId?: string | null;
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
    // Preserve the root cause when supported (Node 16+/modern runtimes)
    // while still attaching useful metadata for callers/tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(message, opts.cause ? ({ cause: opts.cause } as any) : undefined);
    this.name = "SheetsExportError";
    this.kind = opts.kind;
    this.spreadsheetId = opts.spreadsheetId;
    this.spreadsheetUrl = opts.spreadsheetUrl;
    this.cleanupError = opts.cleanupError;
  }
}

function resolveServiceAccountCredentials(): Record<string, unknown> {
  // Reuse service account loader used by Document AI config
  const docAiConfig = getDocumentAiConfig();
  const credentials = docAiConfig.credentials;
  if (!credentials) {
    throw new Error(
      "Google service account credentials not configured. Set GCP_SERVICE_ACCOUNT_JSON or GCP_SERVICE_ACCOUNT_PATH."
    );
  }
  return credentials;
}

async function getGoogleClients() {
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
  // Pass GoogleAuth instance directly to clients for proper typing
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
    const message =
      (err as any)?.errors?.[0]?.message ||
      (err as Error)?.message ||
      "Failed to share spreadsheet with user";
    throw new Error(`Drive permission grant failed: ${message}`);
  }
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
  const rows = transactions.map(tx => [
    tx.date ?? "",
    tx.description ?? "",
    tx.payee ?? "",
    toAmount(tx),
    tx.balance ?? "",
  ]);
  return {
    headers,
    rows,
  };
}

export async function exportTransactionsToGoogleSheet(
  params: SheetsExportParams
): Promise<SheetsExportResult> {
  const { transactions, sheetName, folderId, userEmail } = params;
function extractGoogleApiErrorMessage(err: unknown, fallback: string): string {
  if (!err) return fallback;
  const asAny = err as unknown as { errors?: Array<{ message?: string }> };
  const nested = asAny.errors?.[0]?.message;
  if (nested && typeof nested === "string") return nested;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export async function exportTransactionsToGoogleSheet(
  params: SheetsExportParams
): Promise<SheetsExportResult> {
  const { transactions, sheetName, folderId } = params;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    throw new Error("transactions array is required and must not be empty");
  }
  const safeSheetName = (sheetName || "Transactions Export").slice(0, 100);

  const { sheets, drive } = await getGoogleClients();

  // 1) Create spreadsheet
  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: safeSheetName,
      },
      sheets: [
        {
          properties: {
            title: "Transactions",
          },
        },
      ],
    },
    fields: "spreadsheetId,spreadsheetUrl,sheets(properties(sheetId,title))",
  });

  const spreadsheetId = createRes.data.spreadsheetId!;
  const spreadsheetUrl =
    createRes.data.spreadsheetUrl ||
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  const sheetId: number | undefined = createRes.data.sheets?.[0]?.properties?.sheetId ?? undefined;
  const sheetTitle = createRes.data.sheets?.[0]?.properties?.title ?? "Sheet1";

  // 1b) Ensure the authenticated user can access the file.
  // Without this, the service account owns the sheet and the user will get "Access denied".
  await shareFileWithUser({ drive, fileId: spreadsheetId, userEmail });

  const sheetId: number | undefined =
    createRes.data.sheets?.[0]?.properties?.sheetId ?? undefined;
  const sheetTitle = createRes.data.sheets?.[0]?.properties?.title ?? "Sheet1";

  // 2) Write header + rows
  const { headers, rows } = buildSheetValues(transactions);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetTitle}!A1:E${rows.length + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [headers, ...rows],
    },
  });

  // 3) Format: freeze header, bold header, date/currency formats, autoresize
  if (typeof sheetId === "number") {
    const requests: sheets_v4.Schema$Request[] = [];

    // Freeze first row
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        fields: "gridProperties.frozenRowCount",
      },
    });

    // Bold header row
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
          },
        },
        fields: "userEnteredFormat.textFormat.bold",
      },
    });

    // Date format for column A (index 0), rows 2..N (skip header)
    if (rows.length > 0) {
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
              numberFormat: {
                type: "DATE",
                pattern: "yyyy-mm-dd",
              },
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
      });
    } catch (err) {
      // Surface a helpful error to the caller
      const message =
        (err as any)?.errors?.[0]?.message ||
        (err as Error)?.message ||
        "Failed to move spreadsheet to target folder";
      throw new Error(`Drive move failed: ${message}`);
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

      {
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
  }

  return {
    spreadsheetId,
    spreadsheetUrl,
  };
}


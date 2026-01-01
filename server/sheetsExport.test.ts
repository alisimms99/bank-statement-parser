import { describe, expect, it, vi, beforeEach } from "vitest";

// vitest hoists `vi.mock` calls, so any referenced variables must be hoisted too.
const { mockSheets, mockDrive } = vi.hoisted(() => {
  const mockSheets = {
    spreadsheets: {
      create: vi.fn(),
      values: {
        update: vi.fn(),
      },
      batchUpdate: vi.fn(),
    },
  };

  const mockDrive = {
    files: {
      get: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };

  return { mockSheets, mockDrive };
});

vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn().mockImplementation(() => ({})),
    },
    sheets: vi.fn().mockReturnValue(mockSheets),
    drive: vi.fn().mockReturnValue(mockDrive),
  },
  sheets_v4: {},
  drive_v3: {},
}));

vi.mock("./_core/env", () => ({
  getDocumentAiConfig: vi.fn().mockReturnValue({
    credentials: { client_email: "x", private_key: "y" },
  }),
}));

import {
  exportTransactionsToGoogleSheet,
  SheetsExportError,
} from "./sheetsExport";

describe("exportTransactionsToGoogleSheet - folder move failure behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSheets.spreadsheets.create.mockResolvedValue({
      data: {
        spreadsheetId: "sheet_123",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet_123",
        sheets: [{ properties: { sheetId: 1, title: "Transactions" } }],
      },
    });
    mockSheets.spreadsheets.values.update.mockResolvedValue({});
    mockSheets.spreadsheets.batchUpdate.mockResolvedValue({});

    mockDrive.files.get.mockResolvedValue({ data: { parents: ["root"] } });
  });

  it("deletes created spreadsheet when move fails (no orphan)", async () => {
    mockDrive.files.update.mockRejectedValue(new Error("Invalid folder ID"));
    mockDrive.files.delete.mockResolvedValue({});

    await expect(
      exportTransactionsToGoogleSheet({
        transactions: [
          {
            date: "2025-01-01",
            description: "Test",
            payee: "Payee",
            credit: 10,
            debit: 0,
            balance: 100,
          } as any,
        ],
        sheetName: "Test Export",
        folderId: "bad_folder",
      })
    ).rejects.toMatchObject({
      name: "SheetsExportError",
      kind: "drive_move_failed_spreadsheet_deleted",
      spreadsheetId: "sheet_123",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet_123",
    });

    expect(mockDrive.files.delete).toHaveBeenCalledWith({ fileId: "sheet_123" });
  });

  it("includes spreadsheet URL in error if cleanup fails (caller can still access)", async () => {
    mockDrive.files.update.mockRejectedValue(new Error("Permission denied"));
    mockDrive.files.delete.mockRejectedValue(new Error("Delete failed"));

    let thrown: unknown;
    try {
      await exportTransactionsToGoogleSheet({
        transactions: [
          {
            date: "2025-01-01",
            description: "Test",
            payee: "Payee",
            credit: 10,
            debit: 0,
            balance: 100,
          } as any,
        ],
        sheetName: "Test Export",
        folderId: "no_permission",
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SheetsExportError);
    const e = thrown as SheetsExportError;
    expect(e.kind).toBe("drive_move_failed_spreadsheet_retained");
    expect(e.spreadsheetUrl).toBe("https://docs.google.com/spreadsheets/d/sheet_123");
    expect(e.message).toContain(e.spreadsheetUrl);
  });
});


import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hashTransaction, filterDuplicates, getExistingHashes } from "./sheetsExport";
import type { CanonicalTransaction } from "@shared/transactions";

describe("sheetsExport", () => {
  describe("hashTransaction", () => {
    it("should generate consistent hash for same transaction", () => {
      const tx: CanonicalTransaction = {
        date: "2024-01-15",
        description: "Coffee Shop",
        payee: "Starbucks",
        debit: 5.50,
        credit: undefined,
        balance: 100.00,
        account_id: "12345",
        source_bank: "Chase",
        statement_period: {
          start: "2024-01-01",
          end: "2024-01-31",
        },
      };

      const hash1 = hashTransaction(tx);
      const hash2 = hashTransaction(tx);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 produces 64 hex characters
    });

    it("should generate different hashes for different transactions", () => {
      const tx1: CanonicalTransaction = {
        date: "2024-01-15",
        description: "Coffee Shop",
        payee: "Starbucks",
        debit: 5.50,
        credit: undefined,
        balance: 100.00,
        account_id: "12345",
        source_bank: "Chase",
        statement_period: {
          start: "2024-01-01",
          end: "2024-01-31",
        },
      };

      const tx2: CanonicalTransaction = {
        ...tx1,
        debit: 6.00, // Different amount
      };

      const hash1 = hashTransaction(tx1);
      const hash2 = hashTransaction(tx2);

      expect(hash1).not.toBe(hash2);
    });

    it("should use debit amount when present", () => {
      const tx: CanonicalTransaction = {
        date: "2024-01-15",
        description: "Coffee Shop",
        payee: "Starbucks",
        debit: 5.50,
        credit: undefined,
        balance: 100.00,
        account_id: "12345",
        source_bank: "Chase",
        statement_period: {
          start: "2024-01-01",
          end: "2024-01-31",
        },
      };

      const hash = hashTransaction(tx);
      expect(hash).toBeTruthy();
    });

    it("should use credit amount when debit is not present", () => {
      const tx: CanonicalTransaction = {
        date: "2024-01-15",
        description: "Salary Deposit",
        payee: "Employer",
        debit: undefined,
        credit: 1000.00,
        balance: 1100.00,
        account_id: "12345",
        source_bank: "Chase",
        statement_period: {
          start: "2024-01-01",
          end: "2024-01-31",
        },
      };

      const hash = hashTransaction(tx);
      expect(hash).toBeTruthy();
    });

    it("should handle transactions with no amount", () => {
      const tx: CanonicalTransaction = {
        date: "2024-01-15",
        description: "Memo",
        payee: "Bank",
        debit: undefined,
        credit: undefined,
        balance: 100.00,
        account_id: "12345",
        source_bank: "Chase",
        statement_period: {
          start: "2024-01-01",
          end: "2024-01-31",
        },
      };

      const hash = hashTransaction(tx);
      expect(hash).toBeTruthy();
      expect(hash).toHaveLength(64);
    });
  });

  describe("filterDuplicates", () => {
    it("should return all transactions when no existing hashes", () => {
      const transactions: CanonicalTransaction[] = [
        {
          date: "2024-01-15",
          description: "Coffee Shop",
          payee: "Starbucks",
          debit: 5.50,
          credit: undefined,
          balance: 100.00,
          account_id: "12345",
          source_bank: "Chase",
          statement_period: {
            start: "2024-01-01",
            end: "2024-01-31",
          },
        },
        {
          date: "2024-01-16",
          description: "Grocery Store",
          payee: "Whole Foods",
          debit: 50.00,
          credit: undefined,
          balance: 50.00,
          account_id: "12345",
          source_bank: "Chase",
          statement_period: {
            start: "2024-01-01",
            end: "2024-01-31",
          },
        },
      ];

      const existingHashes = new Set<string>();
      const result = filterDuplicates(transactions, existingHashes);

      expect(result.uniqueTransactions).toHaveLength(2);
      expect(result.duplicateCount).toBe(0);
      expect(result.newHashes).toHaveLength(2);
    });

    it("should filter out duplicate transactions", () => {
      const tx1: CanonicalTransaction = {
        date: "2024-01-15",
        description: "Coffee Shop",
        payee: "Starbucks",
        debit: 5.50,
        credit: undefined,
        balance: 100.00,
        account_id: "12345",
        source_bank: "Chase",
        statement_period: {
          start: "2024-01-01",
          end: "2024-01-31",
        },
      };

      const tx2: CanonicalTransaction = {
        date: "2024-01-16",
        description: "Grocery Store",
        payee: "Whole Foods",
        debit: 50.00,
        credit: undefined,
        balance: 50.00,
        account_id: "12345",
        source_bank: "Chase",
        statement_period: {
          start: "2024-01-01",
          end: "2024-01-31",
        },
      };

      const transactions = [tx1, tx2, tx1]; // tx1 appears twice

      const existingHashes = new Set<string>();
      const result = filterDuplicates(transactions, existingHashes);

      expect(result.uniqueTransactions).toHaveLength(2);
      expect(result.duplicateCount).toBe(1);
      expect(result.newHashes).toHaveLength(2);
    });

    it("should filter out transactions that exist in existing hashes", () => {
      const tx1: CanonicalTransaction = {
        date: "2024-01-15",
        description: "Coffee Shop",
        payee: "Starbucks",
        debit: 5.50,
        credit: undefined,
        balance: 100.00,
        account_id: "12345",
        source_bank: "Chase",
        statement_period: {
          start: "2024-01-01",
          end: "2024-01-31",
        },
      };

      const tx2: CanonicalTransaction = {
        date: "2024-01-16",
        description: "Grocery Store",
        payee: "Whole Foods",
        debit: 50.00,
        credit: undefined,
        balance: 50.00,
        account_id: "12345",
        source_bank: "Chase",
        statement_period: {
          start: "2024-01-01",
          end: "2024-01-31",
        },
      };

      const transactions = [tx1, tx2];
      const existingHashes = new Set<string>([hashTransaction(tx1)]);

      const result = filterDuplicates(transactions, existingHashes);

      expect(result.uniqueTransactions).toHaveLength(1);
      expect(result.uniqueTransactions[0]).toBe(tx2);
      expect(result.duplicateCount).toBe(1);
      expect(result.newHashes).toHaveLength(1);
    });

    it("should handle empty transaction array", () => {
      const transactions: CanonicalTransaction[] = [];
      const existingHashes = new Set<string>();

      const result = filterDuplicates(transactions, existingHashes);

      expect(result.uniqueTransactions).toHaveLength(0);
      expect(result.duplicateCount).toBe(0);
      expect(result.newHashes).toHaveLength(0);
    });

    it("should detect duplicates within the same batch", () => {
      const tx: CanonicalTransaction = {
        date: "2024-01-15",
        description: "Coffee Shop",
        payee: "Starbucks",
        debit: 5.50,
        credit: undefined,
        balance: 100.00,
        account_id: "12345",
        source_bank: "Chase",
        statement_period: {
          start: "2024-01-01",
          end: "2024-01-31",
        },
      };

      const transactions = [tx, tx, tx]; // Same transaction three times
      const existingHashes = new Set<string>();

      const result = filterDuplicates(transactions, existingHashes);

      expect(result.uniqueTransactions).toHaveLength(1);
      expect(result.duplicateCount).toBe(2);
      expect(result.newHashes).toHaveLength(1);
    });
  });

  describe("getExistingHashes", () => {
    const mockSpreadsheetId = "test-spreadsheet-id";
    const mockAccessToken = "test-access-token";

    beforeEach(() => {
      // Reset fetch mock before each test
      global.fetch = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should return empty set when Hashes sheet does not exist (400 error)", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
      } as Response);

      const result = await getExistingHashes(mockSpreadsheetId, mockAccessToken);

      expect(result).toEqual(new Set<string>());
      expect(global.fetch).toHaveBeenCalledWith(
        `https://sheets.googleapis.com/v4/spreadsheets/${mockSpreadsheetId}/values/Hashes!A:A`,
        expect.objectContaining({
          method: "GET",
          headers: {
            "Authorization": `Bearer ${mockAccessToken}`,
            "Content-Type": "application/json",
          },
        })
      );
    });

    it("should throw error on non-400 HTTP errors (e.g., 403 permission denied)", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: vi.fn().mockResolvedValueOnce("Permission denied"),
      } as Response);

      await expect(getExistingHashes(mockSpreadsheetId, mockAccessToken))
        .rejects.toThrow(/Failed to fetch existing hashes \(403\)/);
    });

    it("should throw error on 500 server errors", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValueOnce("Internal server error"),
      } as Response);

      await expect(getExistingHashes(mockSpreadsheetId, mockAccessToken))
        .rejects.toThrow(/Failed to fetch existing hashes \(500\)/);
    });

    it("should throw error on network failures", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));

      await expect(getExistingHashes(mockSpreadsheetId, mockAccessToken))
        .rejects.toThrow("Network error");
    });

    it("should return parsed hashes on success", async () => {
      const mockHashes = ["hash1", "hash2", "hash3"];
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          values: [
            ["Hash"], // header
            ["hash1"],
            ["hash2"],
            ["hash3"],
          ],
        }),
      } as Response);

      const result = await getExistingHashes(mockSpreadsheetId, mockAccessToken);

      expect(result).toEqual(new Set(mockHashes));
    });

    it("should return empty set when no hashes exist (no values)", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({}),
      } as Response);

      const result = await getExistingHashes(mockSpreadsheetId, mockAccessToken);

      expect(result).toEqual(new Set<string>());
    });

    it("should skip header row when present", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          values: [
            ["Hash"], // header
            ["hash1"],
          ],
        }),
      } as Response);

      const result = await getExistingHashes(mockSpreadsheetId, mockAccessToken);

      expect(result).toEqual(new Set(["hash1"]));
      expect(result.has("Hash")).toBe(false); // Header should not be included
    });

    it("should include all rows when no header is present", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          values: [
            ["hash1"],
            ["hash2"],
          ],
        }),
      } as Response);

      const result = await getExistingHashes(mockSpreadsheetId, mockAccessToken);

      expect(result).toEqual(new Set(["hash1", "hash2"]));
    });
  });
});

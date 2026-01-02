import { describe, it, expect } from "vitest";
import { hashTransaction, filterDuplicates } from "./sheetsExport";
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
});

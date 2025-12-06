import { describe, expect, it } from "vitest";
import {
  collapseWhitespace,
  normalizeAmount,
  normalizeDateString,
  normalizeDocumentAITransactions,
  normalizeLegacyTransactions,
} from "./normalization";
import { docAiBankFixture } from "../fixtures/transactions";

describe("normalizeAmount", () => {
  it("assigns negative values to debit and strips currency", () => {
    expect(normalizeAmount("-$1,234.56")).toEqual({ debit: 1234.56, credit: 0 });
    expect(normalizeAmount("(200.10)", "credit")).toEqual({ debit: 200.1, credit: 0 });
  });

  it("assigns positive values to credit when no negative markers", () => {
    expect(normalizeAmount("99.99")).toEqual({ debit: 0, credit: 99.99 });
    expect(normalizeAmount("1,000", "credit")).toEqual({ debit: 0, credit: 1000 });
  });
});

describe("normalizeDateString", () => {
  it("accepts ISO and converts MM/DD to ISO", () => {
    expect(normalizeDateString("2024-12-01")).toBe("2024-12-01");
    expect(normalizeDateString("01/07/24")).toBe("2024-01-07");
  });

  it("returns null on unparseable input", () => {
    expect(normalizeDateString("not-a-date")).toBeNull();
  });
});

describe("normalizeLegacyTransactions", () => {
  it("falls back to description for missing payee and assigns debits/credits", () => {
    const normalized = normalizeLegacyTransactions([
      { date: "02/01/2024", description: "Coffee Shop", amount: "-5.25" },
      { date: "02/02/2024", description: "PAYROLL", amount: "1200", payee: "" },
    ]);

    expect(normalized[0]).toMatchObject({ payee: "Coffee Shop", debit: 5.25, credit: 0, posted_date: "2024-02-01" });
    expect(normalized[1]).toMatchObject({ payee: "PAYROLL", credit: 1200, debit: 0, posted_date: "2024-02-02" });
  });
});

describe("normalizeDocumentAITransactions", () => {
  it("maps Document AI entities into canonical transactions with direction inference", () => {
    const transactions = normalizeDocumentAITransactions(docAiBankFixture, "bank_statement");

    expect(transactions).toEqual([
      expect.objectContaining({ description: "Grocery Store -45.67", payee: "Grocery Store", debit: 45.67, credit: 0 }),
      expect.objectContaining({ description: "PAYROLL INC 1200.00", payee: "PAYROLL INC", debit: 0, credit: 1200 }),
    ]);
  });
});

describe("collapseWhitespace", () => {
  it("trims and collapses repeated whitespace", () => {
    expect(collapseWhitespace("  Hello    World  ")).toBe("Hello World");
  });
});

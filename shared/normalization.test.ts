import { describe, expect, it } from "vitest";
import {
  collapseWhitespace,
  normalizeAmount,
  normalizeDateString,
  normalizeDocumentAITransactions,
  normalizeLegacyTransactions,
  type DocumentAiNormalizedDocument,
} from "./normalization";
import { docAiBankFixture, legacyTransactionsFixture } from "../fixtures/transactions";

describe("normalizeAmount", () => {
  it("assigns negative values to debit and strips currency", () => {
    expect(normalizeAmount("-$1,234.56")).toEqual({ debit: 1234.56, credit: 0 });
    expect(normalizeAmount("(200.10)", "credit")).toEqual({ debit: 200.1, credit: 0 });
  });

  it("assigns positive values to credit when no negative markers", () => {
    expect(normalizeAmount("99.99")).toEqual({ debit: 0, credit: 99.99 });
    expect(normalizeAmount("1,000", "credit")).toEqual({ debit: 0, credit: 1000 });
  });

  it("cleans currency markers and applies direction hints", () => {
    expect(normalizeAmount("€1,234.00", "credit")).toEqual({ debit: 0, credit: 1234 });
    expect(normalizeAmount("USD 89.10", "debit")).toEqual({ debit: 89.1, credit: 0 });
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

  it("trims surrounding whitespace and normalizes separators", () => {
    expect(normalizeDateString(" 2024-03-02 ")).toBe("2024-03-02");
    expect(normalizeDateString("03-04-2024")).toBe("2024-03-04");
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

  it("normalizes fixture data with payee fallback, cleaned numbers, and dates", () => {
    const normalized = normalizeLegacyTransactions(legacyTransactionsFixture);

    expect(normalized[0]).toMatchObject({
      description: "Morning Coffee",
      payee: "Morning Coffee",
      debit: 4.5,
      credit: 0,
      balance: 995.5,
      posted_date: "2024-01-15",
      statement_period: { start: "2024-01-01", end: "2024-01-31" },
    });

    expect(normalized[1]).toMatchObject({
      payee: "Employer Payroll",
      debit: 0,
      credit: 1200,
      balance: 2195.5,
      posted_date: "2024-01-16",
    });

    expect(normalized[2]).toMatchObject({
      description: "CHECK #1234",
      payee: "CHECK #1234",
      debit: 200,
      credit: 0,
      posted_date: "2024-01-17",
      statement_period: { start: "2024-01-01", end: "2024-01-31" },
      metadata: { raw_type: "check" },
    });
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

describe("Capital One year inference", () => {
  it("does not roll back year for later-in-year months on a mid-year statement (regression)", () => {
    const doc: DocumentAiNormalizedDocument = {
      text: "Capital One",
      entities: [
        {
          type: "table_item",
          mentionText: "May 15 SOME MERCHANT $10.00",
        },
      ],
    };

    const result = normalizeDocumentAITransactions(doc, "bank_statement", 2025, "Statement_032025_9163.pdf");
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ posted_date: "2025-05-15" })]));
  });

  it("rolls back year for late-year (Oct–Dec) transactions on early-year (Jan–Mar) statements", () => {
    const doc: DocumentAiNormalizedDocument = {
      text: "Capital One",
      entities: [
        {
          type: "table_item",
          mentionText: "Dec 31 YEAR END $1.00",
        },
      ],
    };

    const result = normalizeDocumentAITransactions(doc, "bank_statement", 2025, "Statement_012025_9163.pdf");
    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ posted_date: "2024-12-31" })]));
  });
});

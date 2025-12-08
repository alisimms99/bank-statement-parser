/**
 * Integration test for CSV export flow
 * This test verifies the full end-to-end flow of exporting transactions to CSV
 */

import { describe, it, expect } from "vitest";

describe("CSV Export Integration", () => {
  const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

  it("should complete the full export flow: POST to store, then GET to download", async () => {
    const sampleTransactions = [
      {
        date: "2024-01-10",
        posted_date: "2024-01-10",
        description: "Coffee Shop",
        payee: "Local Coffee",
        debit: 5.5,
        credit: 0,
        balance: 994.5,
        account_id: "1234",
        source_bank: "Citizens Bank",
        statement_period: { start: null, end: null },
        metadata: { source: "legacy" },
      },
      {
        date: "2024-01-11",
        posted_date: "2024-01-11",
        description: "Paycheck",
        payee: "Employer Inc",
        debit: 0,
        credit: 2500,
        balance: 3494.5,
        account_id: "1234",
        source_bank: "Citizens Bank",
        statement_period: { start: null, end: null },
        metadata: { source: "documentai" },
      },
    ];

    // Step 1: Store transactions and get an ID
    const storeResponse = await fetch(`${BASE_URL}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: sampleTransactions }),
    });

    expect(storeResponse.ok).toBe(true);
    const { id } = await storeResponse.json();
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");

    // Step 2: Download CSV using the ID
    const downloadResponse = await fetch(`${BASE_URL}/api/export/${id}`);
    expect(downloadResponse.ok).toBe(true);
    expect(downloadResponse.headers.get("content-type")).toContain("text/csv");
    expect(downloadResponse.headers.get("content-disposition")).toContain("attachment");

    const csvContent = await downloadResponse.text();

    // Verify CSV content
    expect(csvContent).toContain("Date,Description,Payee,Debit,Credit,Balance,Memo");
    expect(csvContent).toContain("01/10/2024");
    expect(csvContent).toContain("Coffee Shop");
    expect(csvContent).toContain("Local Coffee");
    expect(csvContent).toContain("5.50");
    expect(csvContent).toContain("01/11/2024");
    expect(csvContent).toContain("Paycheck");
    expect(csvContent).toContain("2500.00");

    // Step 3: Test with BOM option
    const downloadWithBOMResponse = await fetch(`${BASE_URL}/api/export/${id}?includeBOM=true`);
    expect(downloadWithBOMResponse.ok).toBe(true);

    // Use arrayBuffer to get raw bytes and check for BOM
    const buffer = await downloadWithBOMResponse.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    
    // Check for UTF-8 BOM (EF BB BF)
    expect(bytes[0]).toBe(0xEF);
    expect(bytes[1]).toBe(0xBB);
    expect(bytes[2]).toBe(0xBF);
  });

  it("should work with transactions from both DocAI and legacy sources", async () => {
    const mixedTransactions = [
      {
        date: "2024-02-01",
        posted_date: "2024-02-01",
        description: "DocAI Transaction",
        payee: "DocAI Payee",
        debit: 100,
        credit: 0,
        balance: 900,
        account_id: "1234",
        source_bank: "Test Bank",
        statement_period: { start: "2024-02-01", end: "2024-02-28" },
        metadata: { source: "documentai", confidence: 0.95 },
      },
      {
        date: "2024-02-02",
        posted_date: null,
        description: "Legacy Transaction",
        payee: null,
        debit: 0,
        credit: 50,
        balance: 950,
        account_id: null,
        source_bank: null,
        statement_period: { start: null, end: null },
        metadata: { source: "legacy" },
      },
    ];

    const storeResponse = await fetch(`${BASE_URL}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: mixedTransactions }),
    });

    const { id } = await storeResponse.json();
    const downloadResponse = await fetch(`${BASE_URL}/api/export/${id}`);
    const csvContent = await downloadResponse.text();

    // Both transactions should be in the CSV
    expect(csvContent).toContain("DocAI Transaction");
    expect(csvContent).toContain("DocAI Payee");
    expect(csvContent).toContain("Legacy Transaction");
    // Legacy transaction should use description as payee when payee is null
    expect(csvContent).toMatch(/Legacy Transaction,Legacy Transaction/);
  });
});

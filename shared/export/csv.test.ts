import { describe, expect, it } from "vitest";

import { toCSV } from "./csv";
import type { NormalizedTransaction } from "../types";

const baseTransaction: NormalizedTransaction = {
  date: "2024-01-05",
  posted_date: null,
  description: "Sample Description",
  payee: null,
  debit: 0,
  credit: 0,
  balance: null,
  account_id: null,
  source_bank: null,
  metadata: {},
};

describe("toCSV", () => {
  it("handles credit-only transactions", () => {
    const records: NormalizedTransaction[] = [
      {
        ...baseTransaction,
        date: "2024-02-10",
        description: "Direct Deposit",
        credit: 1250.5,
      },
    ];

    const csv = toCSV(records);
    const [, row] = csv.split("\n");

    expect(row).toBe("02/10/2024,Direct Deposit,Direct Deposit,0.00,1250.50,,");
  });

  it("handles debit-only transactions and strips commas", () => {
    const records: NormalizedTransaction[] = [
      {
        ...baseTransaction,
        date: "2024-03-15",
        description: "ATM Withdrawal",
        debit: Number("1,234.56".replace(/,/g, "")),
      },
    ];

    const csv = toCSV(records);
    const [, row] = csv.split("\n");

    expect(row).toBe("03/15/2024,ATM Withdrawal,ATM Withdrawal,1234.56,0.00,,");
  });

  it("falls back to description when payee is null", () => {
    const records: NormalizedTransaction[] = [
      {
        ...baseTransaction,
        description: "Payee Placeholder",
        payee: null,
        debit: 42,
      },
    ];

    const csv = toCSV(records);
    const [, row] = csv.split("\n");

    expect(row).toBe("01/05/2024,Payee Placeholder,Payee Placeholder,42.00,0.00,,");
  });

  it("ignores edited flags in metadata while keeping other entries", () => {
    const records: NormalizedTransaction[] = [
      {
        ...baseTransaction,
        metadata: {
          edited: true,
          edited_at: "2024-01-06T12:00:00Z",
          note: "keep me",
        },
      },
    ];

    const csv = toCSV(records);
    const [, row] = csv.split("\n");

    expect(row.endsWith("{\"note\":\"keep me\"}")).toBe(true);
  });

  it("returns only headers for an empty list", () => {
    const csv = toCSV([]);

    expect(csv).toBe("Date,Description,Payee,Debit,Credit,Balance,Memo");
  });
});

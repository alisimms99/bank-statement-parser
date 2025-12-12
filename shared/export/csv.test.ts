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
  it("exports signed amount (credit positive)", () => {
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

    expect(row).toBe("2024-02-10,Direct Deposit,1250.50,,,,,Direct Deposit");
  });

  it("exports signed amount (debit negative)", () => {
    const records: NormalizedTransaction[] = [
      {
        ...baseTransaction,
        date: "2024-03-15",
        description: "ATM Withdrawal",
        debit: 1234.56,
      },
    ];

    const csv = toCSV(records);
    const [, row] = csv.split("\n");

    expect(row).toBe("2024-03-15,ATM Withdrawal,-1234.56,,,,,ATM Withdrawal");
  });

  it("exports edited metadata fields and coerces nulls to empty strings", () => {
    const records: NormalizedTransaction[] = [
      {
        ...baseTransaction,
        description: "Edited Tx",
        debit: 42,
        metadata: {
          edited: true,
          edited_at: "2024-01-06T12:00:00Z",
        },
      },
    ];

    const csv = toCSV(records);
    const [, row] = csv.split("\n");

    expect(row).toBe("2024-01-05,Edited Tx,-42.00,,true,2024-01-06T12:00:00Z,,Edited Tx");
  });

  it("computes ending_balance for the final row when missing", () => {
    const records: NormalizedTransaction[] = [
      {
        ...baseTransaction,
        date: "2024-01-01",
        metadata: {
          edited: false,
        },
        debit: 10,
        // Balance after first transaction
        balance: 1000,
      },
      {
        ...baseTransaction,
        date: "2024-01-02",
        credit: 50,
        balance: 1050,
      },
    ];

    const csv = toCSV(records);
    const [, row1, row2] = csv.split("\n");

    // non-last row should be blank
    expect(row1.split(",")[6]).toBe("");
    // last row should equal computed ending balance (starting_balance + sum(amounts))
    // starting_balance inferred as first.balance - first.amount = 1000 - (-10) = 1010
    // sum(amounts) = (-10 + 50) = 40; ending_balance = 1050
    expect(row2.split(",")[6]).toBe("1050.00");
  });

  it("returns only headers for an empty list", () => {
    const csv = toCSV([]);

    expect(csv).toBe(
      "date,description,amount,balance,metadata_edited,metadata_edited_at,ending_balance,inferred_description",
    );
  });
});

import type { CanonicalTransaction } from "@shared/transactions";
import type { DocumentAiNormalizedDocument, LegacyTransactionLike } from "@shared/normalization";

export const sampleCanonicalTransactions: CanonicalTransaction[] = [
  {
    date: "2024-01-05",
    posted_date: "2024-01-05",
    description: "Grocery Store",
    payee: "Grocery Store",
    debit: 45.67,
    credit: 0,
    balance: 1000.25,
    account_id: "acct-123",
    source_bank: "Citizens",
    statement_period: { start: "2024-01-01", end: "2024-01-31" },
    metadata: { source: "fixture" },
  },
  {
    date: "2024-01-06",
    posted_date: "2024-01-06",
    description: "PAYROLL INC",
    payee: "PAYROLL INC",
    debit: 0,
    credit: 1200,
    balance: 2200.25,
    account_id: "acct-123",
    source_bank: "Citizens",
    statement_period: { start: "2024-01-01", end: "2024-01-31" },
    metadata: { source: "fixture" },
  },
];

export const docAiBankFixture: DocumentAiNormalizedDocument = {
  text: "Grocery Store -45.67 on 01/05/2024 and PAYROLL INC 1200.00 on 01/06/2024",
  entities: [
    {
      type: "bank_transaction",
      mentionText: "Grocery Store -45.67",
      normalizedValue: { text: "01/05/2024" },
      properties: [
        { type: "amount", mentionText: "-45.67" },
        { type: "merchant_name", mentionText: "Grocery Store" },
        { type: "posting_date", mentionText: "01/05/2024", normalizedValue: { text: "01/05/2024" } },
      ],
    },
    {
      type: "transaction_credit",
      mentionText: "PAYROLL INC 1200.00",
      normalizedValue: { text: "2024-01-06" },
      properties: [
        { type: "amount", mentionText: "1200.00" },
        { type: "counterparty", mentionText: "PAYROLL INC" },
        { type: "posting_date", mentionText: "2024-01-06", normalizedValue: { text: "2024-01-06" } },
      ],
    },
  ],
};

export const docAiInvoiceFixture: DocumentAiNormalizedDocument = {
  text: "Invoice with two line items",
  entities: [
    {
      type: "line_item",
      mentionText: "Consulting Services",
      properties: [
        { type: "amount", mentionText: "500.00" },
        { type: "transaction_date", mentionText: "2024-02-10" },
        { type: "vendor", mentionText: "ACME Co" },
      ],
    },
    {
      type: "line_item",
      mentionText: "Materials",
      properties: [
        { type: "amount", mentionText: "-150.00" },
        { type: "transaction_date", mentionText: "2024-02-11" },
        { type: "vendor", mentionText: "ACME Co" },
      ],
    },
  ],
};

export const malformedPdfBuffer = Buffer.from("not-a-real-pdf");

export const legacyTransactionsFixture: LegacyTransactionLike[] = [
  {
    date: " 01/15/24 ",
    description: "  Morning Coffee  ",
    amount: "$-4.50",
    payee: "",
    balance: "$995.50",
    account_id: "acct-123",
    source_bank: "Citizens",
    statement_period: { start: "01/01/2024", end: "01/31/2024" },
  },
  {
    date: "2024-01-16",
    description: "Employer Payroll",
    amount: "1,200.00",
    payee: "Employer Payroll",
    directionHint: "credit",
    balance: "2,195.50",
    account_id: "acct-123",
    source_bank: "Citizens",
    statement_period: { start: "2024-01-01", end: "2024-01-31" },
  },
  {
    date: "01-17-2024",
    description: "CHECK #1234",
    amount: "(200.00)",
    payee: "  ",
    type: "check",
    account_id: "acct-123",
    source_bank: "Citizens",
    statement_period: { start: "2024/01/01", end: "2024/01/31" },
  },
];

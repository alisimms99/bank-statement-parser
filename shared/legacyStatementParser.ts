import { normalizeLegacyTransactions } from "./normalization";
import type { CanonicalTransaction } from "./transactions";

export interface LegacyTransaction {
  date: string;
  type: string;
  payee: string;
  amount: string;
}

interface ParsedTransaction {
  date: string;
  amount: number;
  description: string;
  isDebit: boolean;
}

/**
 * Parse Citizens Bank statement text into legacy transactions.
 * (Pure string parsing; no PDF dependencies so it can run in Node or the browser.)
 */
export function parseStatementText(text: string): LegacyTransaction[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const lines = text
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const transactions: ParsedTransaction[] = [];

  // Find statement period to determine year
  const statementYear = detectStatementYear(text);

  // Track current section
  let currentSection: "debit" | "credit" | "none" = "none";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section headers
    if (line.includes("ATM/Purchases") || line.includes("Other Debits") || line.includes("Debits")) {
      currentSection = "debit";
      continue;
    }
    if (line.includes("Deposits & Credits")) {
      currentSection = "credit";
      continue;
    }
    if (line.includes("Daily Balance") || line.includes("Balance Calculation")) {
      currentSection = "none";
      continue;
    }

    // Skip headers and non-transaction lines
    if (line.includes("Date") && line.includes("Amount") && line.includes("Description")) continue;
    if (line.includes("Page ") && line.includes(" of ")) continue;
    if (line.includes("Please See Additional")) continue;
    if (line.includes("Member FDIC")) continue;
    if (line.includes("TRANSACTION DETAILS")) continue;
    if (line.includes("Clearly Better Business")) continue;

    // Parse transaction lines across multiple bank formats
    const parsedFromColumns = parseDualColumnTransaction(line, statementYear);
    if (parsedFromColumns) {
      transactions.push(parsedFromColumns);
      continue;
    }

    const parsedSingleColumn = parseSingleColumnTransaction(line, statementYear, currentSection);

    if (parsedSingleColumn) {
      transactions.push(parsedSingleColumn);
    }
  }

  // Convert to final format
  return transactions.map(t => ({
    date: t.date,
    type: determineTransactionType(t.description, t.isDebit),
    payee: cleanPayeeName(t.description),
    amount: formatAmount(t.amount, t.isDebit),
  }));
}

export function legacyTransactionsToCanonical(transactions: LegacyTransaction[]): CanonicalTransaction[] {
  return normalizeLegacyTransactions(
    transactions.map(tx => ({
      date: tx.date,
      description: tx.payee || tx.type,
      amount: tx.amount,
      type: tx.type,
      payee: tx.payee,
    }))
  );
}

function determineTransactionType(description: string, isDebit: boolean): string {
  const upper = description.toUpperCase();

  if (upper.includes("POS DEBIT") || upper.includes("DBT PURCHASE")) {
    return "Debit Card Purchase";
  }
  if (upper.includes("ATM DEPOSIT")) {
    return "ATM Deposit";
  }
  if (upper.includes("MOBILE DEPOSIT")) {
    return "Mobile Deposit";
  }
  if (upper.includes("ACH")) {
    return isDebit ? "ACH Debit" : "ACH Credit";
  }
  if (upper.includes("TRANSFER")) {
    return "Transfer";
  }
  if (upper.includes("PAYMENT")) {
    return "Payment";
  }
  if (upper.includes("OVERDRAFT FEE")) {
    return "Fee";
  }
  if (upper.includes("DEPOSIT")) {
    return "Deposit";
  }
  if (upper.includes("PAYPAL")) {
    return "PayPal";
  }
  if (upper.includes("CASH APP")) {
    return "Cash App";
  }

  return isDebit ? "Debit" : "Credit";
}

function cleanPayeeName(description: string): string {
  // Remove transaction codes at the beginning
  let cleaned = description.replace(/^\d{4}\s+(POS DEBIT|DBT PURCHASE|ATM DEPOSIT)\s+-\s+/, "");

  // Remove known channel prefixes
  cleaned = cleaned
    .replace(/^POS\s+DEBIT\s+/i, "")
    .replace(/^ACH\s+(DEBIT|CREDIT)\s+/i, "")
    .replace(/^DBT\s+PURCHASE\s+/i, "");

  // Remove reference numbers
  cleaned = cleaned.replace(/\s+\d{6,}\s*$/, "");

  // Remove trailing store identifiers (e.g., ":1234" or "#1234")
  cleaned = cleaned.replace(/[:#]\d{3,}\s*$/, "");

  // Truncate at location info (state codes, etc.)
  cleaned = cleaned.replace(/\s+[A-Z]{2}$/, "");

  // Clean up multiple spaces
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

function formatAmount(amount: number, isDebit: boolean): string {
  const sign = isDebit ? "-" : "";
  return `${sign}$${amount.toFixed(2)}`;
}

function detectStatementYear(text: string): number {
  // Prefer explicit four-digit years present in a period header
  const periodMatch = text.match(/Beginning\s+(\w+)\s+\d+,\s+(\d{4})/);
  if (periodMatch) {
    return parseInt(periodMatch[2], 10);
  }

  // Fallback: use any four-digit year mentioned in the text
  const yearMatch = text.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    return parseInt(yearMatch[1], 10);
  }

  // Last resort: current year to avoid undefined behavior
  return new Date().getFullYear();
}

function normalizeDate(month: string, day: string, year: string | undefined, defaultYear: number): string {
  const resolvedYear = year
    ? year.length === 2
      ? 2000 + parseInt(year, 10)
      : parseInt(year, 10)
    : defaultYear;

  const paddedMonth = month.padStart(2, "0");
  const paddedDay = day.padStart(2, "0");

  return `${paddedMonth}/${paddedDay}/${resolvedYear}`;
}

function parseAmount(amountRaw: string, defaultSectionIsDebit: boolean): { amount: number; isDebit: boolean } | null {
  const hasParens = amountRaw.includes("(") && amountRaw.includes(")");
  const normalized = amountRaw.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  const parsed = parseFloat(normalized);

  if (Number.isNaN(parsed)) return null;

  const explicitNegative = hasParens || /^-/.test(normalized) || /-$/.test(amountRaw.trim());
  const valueIsDebit = explicitNegative || defaultSectionIsDebit;

  return {
    amount: Math.abs(parsed),
    isDebit: valueIsDebit,
  };
}

function parseDualColumnTransaction(line: string, statementYear: number): ParsedTransaction | null {
  // Matches: MM/DD[/YY] Description Debit Credit (amount columns at the end)
  const match = line.match(
    /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(.+?)\s+(-?[()$\d.,]+)?\s+(-?[()$\d.,]+)$/
  );

  if (!match) return null;

  const [, month, day, year, descriptionRaw, debitRaw, creditRaw] = match;
  const debit = debitRaw && debitRaw.trim() !== "-" ? parseAmount(debitRaw, true) : null;
  const credit = creditRaw && creditRaw.trim() !== "-" ? parseAmount(creditRaw, false) : null;

  const chosen = debit || credit;
  if (!chosen) return null;

  return {
    date: normalizeDate(month, day, year, statementYear),
    amount: chosen.amount,
    description: descriptionRaw,
    isDebit: chosen.isDebit,
  };
}

function parseSingleColumnTransaction(
  line: string,
  statementYear: number,
  currentSection: "debit" | "credit" | "none"
): ParsedTransaction | null {
  // Parse transaction line: MM/DD[/YY] Amount Description
  const transactionMatch = line.match(
    /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(-?[()$\d.,]+)\s+(.+)$/
  );

  if (!transactionMatch || currentSection === "none") {
    return null;
  }

  const [, month, day, year, amountStr, description] = transactionMatch;
  const amount = parseAmount(amountStr, currentSection === "debit");

  if (!amount) return null;

  return {
    date: normalizeDate(month, day, year, statementYear),
    amount: amount.amount,
    description,
    isDebit: amount.isDebit,
  };
}


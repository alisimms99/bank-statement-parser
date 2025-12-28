import * as pdfjsLib from "pdfjs-dist";
import type { CanonicalTransaction } from "@shared/transactions";
import {
  legacyTransactionsToCanonical as legacyTransactionsToCanonicalShared,
  parseStatementText as parseStatementTextShared,
  type LegacyTransaction as Transaction,
} from "@shared/legacyStatementParser";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export type { Transaction };

export interface CsvExportOptions {
  includeBom?: boolean;
}

interface ParsedTransaction {
  date: string;
  amount: number;
  description: string;
  isDebit: boolean;
}

/**
 * Extract text from PDF file
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let fullText = "";
  
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(" ");
    fullText += pageText + "\n";
  }
  
  return fullText;
}

/**
 * Parse Citizens Bank statement text into transactions
 */
export function parseStatementText(text: string): Transaction[] {
  return parseStatementTextShared(text);
}

/**
 * Determine transaction type from description
 */
function determineTransactionType(description: string, isDebit: boolean): string {
  const upper = description.toUpperCase();
  
  if (upper.includes('POS DEBIT') || upper.includes('DBT PURCHASE')) {
    return 'Debit Card Purchase';
  }
  if (upper.includes('ATM DEPOSIT')) {
    return 'ATM Deposit';
  }
  if (upper.includes('MOBILE DEPOSIT')) {
    return 'Mobile Deposit';
  }
  if (upper.includes('ACH')) {
    return isDebit ? 'ACH Debit' : 'ACH Credit';
  }
  if (upper.includes('TRANSFER')) {
    return 'Transfer';
  }
  if (upper.includes('PAYMENT')) {
    return 'Payment';
  }
  if (upper.includes('OVERDRAFT FEE')) {
    return 'Fee';
  }
  if (upper.includes('DEPOSIT')) {
    return 'Deposit';
  }
  if (upper.includes('PAYPAL')) {
    return 'PayPal';
  }
  if (upper.includes('CASH APP')) {
    return 'Cash App';
  }
  
  return isDebit ? 'Debit' : 'Credit';
}

/**
 * Clean and extract payee name from description
 */
function cleanPayeeName(description: string): string {
  // Remove transaction codes at the beginning
  let cleaned = description.replace(/^\d{4}\s+(POS DEBIT|DBT PURCHASE|ATM DEPOSIT)\s+-\s+/, '');

  // Remove known channel prefixes
  cleaned = cleaned
    .replace(/^POS\s+DEBIT\s+/i, '')
    .replace(/^ACH\s+(DEBIT|CREDIT)\s+/i, '')
    .replace(/^DBT\s+PURCHASE\s+/i, '');
  
  // Remove reference numbers
  cleaned = cleaned.replace(/\s+\d{6,}\s*$/, '');

  // Remove trailing store identifiers (e.g., ":1234" or "#1234")
  cleaned = cleaned.replace(/[:#]\d{3,}\s*$/, '');
  
  // Truncate at location info (state codes, etc.)
  cleaned = cleaned.replace(/\s+[A-Z]{2}$/, '');

  // Clean up multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * Format amount with sign
 */
function formatAmount(amount: number, isDebit: boolean): string {
  const sign = isDebit ? '-' : '';
  return `${sign}$${amount.toFixed(2)}`;
}

function detectStatementYear(text: string): number {
  // Prefer explicit four-digit years present in a period header
  const periodMatch = text.match(/Beginning\s+(\w+)\s+\d+,\s+(\d{4})/);
  if (periodMatch) {
    return parseInt(periodMatch[2]);
  }

  // Fallback: use any four-digit year mentioned in the text
  const yearMatch = text.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    return parseInt(yearMatch[1]);
  }

  // Last resort: current year to avoid undefined behavior
  return new Date().getFullYear();
}

function normalizeDate(month: string, day: string, year: string | undefined, defaultYear: number): string {
  const resolvedYear = year
    ? year.length === 2
      ? 2000 + parseInt(year)
      : parseInt(year)
    : defaultYear;

  const paddedMonth = month.padStart(2, '0');
  const paddedDay = day.padStart(2, '0');

  return `${paddedMonth}/${paddedDay}/${resolvedYear}`;
}

function parseAmount(amountRaw: string, defaultSectionIsDebit: boolean): { amount: number; isDebit: boolean } | null {
  const hasParens = amountRaw.includes('(') && amountRaw.includes(')');
  const normalized = amountRaw.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const parsed = parseFloat(normalized);

  if (Number.isNaN(parsed)) return null;

  const explicitNegative = hasParens || /^-/.test(normalized) || /-$/.test(amountRaw.trim());
  const valueIsDebit = explicitNegative || defaultSectionIsDebit;

  return {
    amount: Math.abs(parsed),
    isDebit: valueIsDebit
  };
}

function parseDualColumnTransaction(line: string, statementYear: number): ParsedTransaction | null {
  // Matches: MM/DD[/YY] Description Debit Credit (amount columns at the end)
  const match = line.match(
    /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(.+?)\s+(-?[()$\d.,]+)?\s+(-?[()$\d.,]+)$/
  );

  if (!match) return null;

  const [, month, day, year, descriptionRaw, debitRaw, creditRaw] = match;
  const debit = debitRaw && debitRaw.trim() !== '-' ? parseAmount(debitRaw, true) : null;
  const credit = creditRaw && creditRaw.trim() !== '-' ? parseAmount(creditRaw, false) : null;

  const chosen = debit || credit;
  if (!chosen) return null;

  return {
    date: normalizeDate(month, day, year, statementYear),
    amount: chosen.amount,
    description: descriptionRaw,
    isDebit: chosen.isDebit
  };
}

function parseSingleColumnTransaction(
  line: string,
  statementYear: number,
  currentSection: 'debit' | 'credit' | 'none'
): ParsedTransaction | null {
  // Parse transaction line: MM/DD[/YY] Amount Description
  const transactionMatch = line.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(-?[()$\d.,]+)\s+(.+)$/);

  if (!transactionMatch || currentSection === 'none') {
    return null;
  }

  const [, month, day, year, amountStr, description] = transactionMatch;
  const amount = parseAmount(amountStr, currentSection === 'debit');

  if (!amount) return null;

  return {
    date: normalizeDate(month, day, year, statementYear),
    amount: amount.amount,
    description,
    isDebit: amount.isDebit
  };
}

/**
 * Convert transactions to CSV format
 */
export function transactionsToCSV(
  transactions: Transaction[],
  options: CsvExportOptions = {}
): string {
  const { includeBom = false } = options;
  const headers = ["Date", "Transaction Type", "Payee / Payor", "Amount"];
  const rows = transactions.map(t => [
    t.date,
    t.type,
    t.payee,
    normalizeAmountForCSV(t.amount)
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(cell => {
      if (cell == null) return '';
      // Escape cells containing commas or quotes
      if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(","))
  ].join("\n");

  return includeBom ? `\uFEFF${csvContent}` : csvContent;
}

/**
 * Normalize amount string for CSV/QuickBooks import
 * - Removes currency symbols and commas
 * - Ensures two decimal places
 */
function normalizeAmountForCSV(amount: string): string {
  // Keep digits, decimal point, and sign
  const sanitized = amount.replace(/[^0-9.-]/g, "");
  const parsed = parseFloat(sanitized);

  if (Number.isNaN(parsed)) {
    return "";
  }

  return parsed.toFixed(2);
}

/**
 * Download CSV file
 */
export function downloadCSV(csvContent: string, filename: string = 'transactions.csv'): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

/**
 * Convert legacy Transaction[] to CanonicalTransaction[]
 */
export function legacyTransactionsToCanonical(transactions: Transaction[], defaultYear?: string | number): CanonicalTransaction[] {
  return legacyTransactionsToCanonicalShared(transactions, defaultYear);
}

/**
 * Convert CanonicalTransaction to Transaction for display
 */
export function canonicalToDisplayTransaction(canonical: CanonicalTransaction): Transaction {
  const amount = canonical.debit > 0 
    ? `-$${canonical.debit.toFixed(2)}`
    : canonical.credit > 0
    ? `$${canonical.credit.toFixed(2)}`
    : "$0.00";

  return {
    date: canonical.date ?? "",
    type: canonical.metadata?.raw_type as string ?? "Transaction",
    payee: canonical.payee ?? canonical.description,
    amount,
  };
}

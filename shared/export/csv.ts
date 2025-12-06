import { CanonicalTransaction } from "../transactions";

export interface CsvExportOptions {
  includeBom?: boolean;
  delimiter?: string;
}

export function exportCanonicalToCSV(transactions: CanonicalTransaction[], options: CsvExportOptions = {}): string {
  const { includeBom = false, delimiter = "," } = options;
  const headers = [
    "Date",
    "Posted Date",
    "Description",
    "Payee",
    "Debit",
    "Credit",
    "Balance",
    "Memo",
  ];

  const rows = transactions.map(tx => [
    formatDisplayDate(tx.date ?? tx.posted_date),
    formatDisplayDate(tx.posted_date),
    tx.description,
    tx.payee ?? tx.description,
    formatAmount(tx.debit),
    formatAmount(tx.credit),
    tx.balance != null ? formatAmount(tx.balance) : "",
    serializeMetadata(tx.metadata),
  ]);

  const csvContent = [
    headers.join(delimiter),
    ...rows.map(row => row.map(cell => escapeCell(cell, delimiter)).join(delimiter)),
  ].join("\n");

  return includeBom ? `\uFEFF${csvContent}` : csvContent;
}

function escapeCell(cell: string, delimiter: string): string {
  if (cell == null) return "";
  const needsEscaping = cell.includes(delimiter) || cell.includes("\n") || cell.includes("\"");
  if (!needsEscaping) return cell;
  return `"${cell.replace(/\"/g, '""')}"`;
}

function formatAmount(value: number): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2);
}

function formatDisplayDate(value: string | null): string {
  if (!value) return "";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${m}/${d}/${y}`;
}

function serializeMetadata(metadata: Record<string, any>): string {
  if (!metadata || Object.keys(metadata).length === 0) return "";
  try {
    return JSON.stringify(metadata);
  } catch {
    return "";
  }
}

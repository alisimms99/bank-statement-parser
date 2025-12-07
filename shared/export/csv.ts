import type { NormalizedTransaction } from "../types";

export interface CsvExportOptions {
  includeBOM?: boolean;
  delimiter?: string;
}

/**
 * Convert normalized transactions to CSV for QuickBooks-friendly import.
 */
export function toCSV(
  records: NormalizedTransaction[],
  options: CsvExportOptions = {},
): string {
  const { includeBOM = false, delimiter = "," } = options;

  const headers = ["Date", "Description", "Payee", "Debit", "Credit", "Balance", "Memo"];

  const rows = records.map(record => {
    const displayDate = formatDate(record.date ?? record.posted_date);
    const payee = record.payee?.trim()
      ? record.payee
      : record.description ?? "";

    return [
      displayDate,
      record.description ?? "",
      payee,
      formatAmount(record.debit),
      formatAmount(record.credit),
      formatAmount(record.balance),
      serializeMemo(record.metadata),
    ];
  });

  const csvBody = rows
    .map(row => row.map(cell => escapeCell(cell ?? "", delimiter)).join(delimiter))
    .join("\n");

  const csvContent = [headers.join(delimiter), csvBody].filter(Boolean).join("\n");

  return includeBOM ? `\uFEFF${csvContent}` : csvContent;
}

function escapeCell(value: string, delimiter: string): string {
  if (value === "") return "";
  const needsEscaping = value.includes(delimiter) || value.includes("\n") || value.includes("\"");
  if (!needsEscaping) return value;
  return `"${value.replace(/\"/g, '""')}"`;
}

function formatAmount(value: number | null | undefined): string {
  if (value == null) return "";
  const numeric = Math.abs(Number(String(value).replace(/,/g, "")));
  if (!Number.isFinite(numeric)) return "";
  return numeric.toFixed(2);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const isoPart = value.split("T")[0];
  const match = isoPart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${month}/${day}/${year}`;
}

function serializeMemo(metadata: Record<string, any> | undefined): string {
  if (!metadata) return "";

  const cleanedEntries = Object.entries(metadata).filter(([key]) =>
    !["edited", "edited_at", "editedAt"].includes(key),
  );

  if (cleanedEntries.length === 0) return "";

  try {
    return JSON.stringify(Object.fromEntries(cleanedEntries));
  } catch {
    return "";
  }
}

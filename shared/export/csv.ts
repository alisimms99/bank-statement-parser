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

  const headers = [
    "Date",
    "Description",
    "Payee",
    "Debit",
    "Credit",
    "Balance",
    "Ending Balance",
    "Inferred Description",
    "Edited",
    "Edited At",
    "Memo",
  ];

  const rows = records.map(record => {
    const displayDate = formatDate(record.date ?? record.posted_date);
    const inferredDescription = resolveInferredDescription(record);
    const description = resolveDescription(record, inferredDescription);
    const payee = record.payee?.trim() ? record.payee : description;
    const endingBalance = resolveEndingBalance(record);
    const editedAt = record.metadata?.edited_at ?? record.metadata?.editedAt;

    return [
      displayDate,
      description,
      payee,
      formatAmount(record.debit),
      formatAmount(record.credit),
      formatAmount(record.balance),
      formatAmount(endingBalance),
      inferredDescription,
      formatBoolean(record.metadata?.edited === true),
      editedAt ?? "",
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

function formatBoolean(value: boolean): string {
  return value ? "true" : "";
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

function resolveDescription(record: NormalizedTransaction, inferred: string): string {
  if (record.description?.trim()) return record.description;
  if (inferred) return inferred;
  return "";
}

function resolveInferredDescription(record: NormalizedTransaction): string {
  const inferred =
    record.inferred_description ??
    record.metadata?.inferred_description ??
    record.metadata?.inferredDescription;

  if (inferred == null) return "";
  return String(inferred).trim();
}

function resolveEndingBalance(record: NormalizedTransaction): number | null | undefined {
  if (record.ending_balance != null) return record.ending_balance;
  if (record.metadata?.ending_balance != null) return record.metadata.ending_balance;
  if (record.metadata?.endingBalance != null) return record.metadata.endingBalance;
  return null;
}

function serializeMemo(metadata: Record<string, any> | undefined): string {
  if (!metadata) return "";

  const cleanedEntries = Object.entries(metadata).filter(([key]) =>
    !["edited", "edited_at", "editedAt", "ending_balance", "endingBalance", "inferred_description", "inferredDescription"].includes(
      key,
    ),
  );

  if (cleanedEntries.length === 0) return "";

  try {
    return JSON.stringify(Object.fromEntries(cleanedEntries));
  } catch {
    return "";
  }
}

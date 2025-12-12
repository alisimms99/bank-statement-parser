import type { NormalizedTransaction } from "../types";

export interface CsvExportOptions {
  includeBOM?: boolean;
  delimiter?: string;
}

/**
 * Convert normalized transactions to a full-fidelity CSV export.
 */
export function toCSV(
  records: NormalizedTransaction[],
  options: CsvExportOptions = {},
): string {
  const { includeBOM = false, delimiter = "," } = options;

  const headers = [
    "date",
    "description",
    "amount",
    "balance",
    "metadata_edited",
    "metadata_edited_at",
    "ending_balance",
    "inferred_description",
  ];

  const signedAmounts = records.map(getSignedAmount);
  const startingBalance = inferStartingBalance(records, signedAmounts);
  const computedEndingBalance =
    startingBalance == null
      ? null
      : startingBalance + signedAmounts.reduce((sum, v) => sum + v, 0);

  const rows = records.map(record => {
    const metadataEdited = formatBoolean(record.metadata?.edited);
    const metadataEditedAt = formatString(record.metadata?.edited_at);

    const inferredDescription = formatString(
      record.inferred_description ??
        record.metadata?.inferred_description ??
        record.description ??
        "",
    );

    return [
      formatISODate(record.date ?? record.posted_date),
      formatString(record.description),
      formatNumber(getSignedAmount(record)),
      formatNumber(record.balance),
      metadataEdited,
      metadataEditedAt,
      formatEndingBalance(record, computedEndingBalance, records),
      inferredDescription,
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

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "";
  const numeric = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return "";
  return numeric.toFixed(2);
}

function formatISODate(value: string | null | undefined): string {
  if (!value) return "";
  return value.split("T")[0];
}

function formatString(value: unknown): string {
  if (value == null) return "";
  const asString = String(value);
  return asString;
}

function formatBoolean(value: unknown): string {
  if (typeof value !== "boolean") return "";
  return value ? "true" : "false";
}

function getSignedAmount(record: NormalizedTransaction): number {
  const debit = Number(record.debit ?? 0);
  const credit = Number(record.credit ?? 0);
  const signed = credit - debit;
  return Number.isFinite(signed) ? signed : 0;
}

function inferStartingBalance(
  records: NormalizedTransaction[],
  signedAmounts: number[],
): number | null {
  if (records.length === 0) return null;

  const first = records[0];
  const metaStart = toFiniteNumber(first.metadata?.starting_balance);
  if (metaStart != null) return metaStart;

  if (first.balance == null) return null;
  const firstBalance = toFiniteNumber(first.balance);
  if (firstBalance == null) return null;

  const firstAmount = signedAmounts[0] ?? getSignedAmount(first);
  return firstBalance - firstAmount;
}

function formatEndingBalance(
  record: NormalizedTransaction,
  computedEndingBalance: number | null,
  records: NormalizedTransaction[],
): string {
  const explicit = toFiniteNumber(record.ending_balance);
  if (explicit != null) return formatNumber(explicit);

  const isLast = records.length > 0 && records[records.length - 1] === record;
  if (!isLast) return "";
  if (computedEndingBalance == null) return "";

  return formatNumber(computedEndingBalance);
}

function toFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

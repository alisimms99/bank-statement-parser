import { CanonicalDocument, CanonicalTransaction } from "./transactions";

export interface DocumentAiMoneyValue {
  amount?: number;
  currencyCode?: string;
}

export interface DocumentAiEntity {
  type?: string;
  mentionText?: string;
  normalizedValue?: {
    text?: string;
    dateValue?: string;
    moneyValue?: DocumentAiMoneyValue;
  };
  properties?: DocumentAiEntity[];
  confidence?: number;
}

export interface DocumentAiNormalizedDocument {
  entities?: DocumentAiEntity[];
  text?: string;
}

export interface LegacyTransactionLike {
  date: string;
  description: string;
  amount: string;
  type?: string;
  directionHint?: "debit" | "credit";
  payee?: string;
  balance?: string | number | null;
  account_id?: string | null;
  source_bank?: string | null;
  statement_period?: { start?: string | null; end?: string | null };
}

export function normalizeLegacyTransactions(legacy: LegacyTransactionLike[]): CanonicalTransaction[] {
  return legacy
    .map(item => {
      const description = collapseWhitespace(item.description);
      const payee = collapseWhitespace(item.payee ?? "") || description;
      const amountParts = normalizeAmount(item.amount, item.directionHint);
      const posted_date = normalizeDateString(item.date);

      if (!amountParts || (!amountParts.debit && !amountParts.credit)) return null;

      return {
        date: posted_date,
        posted_date,
        description,
        payee: payee || null,
        debit: amountParts.debit,
        credit: amountParts.credit,
        balance: normalizeNumber(item.balance),
        account_id: item.account_id ?? null,
        source_bank: item.source_bank ?? null,
        statement_period: {
          start: normalizeDateString(item.statement_period?.start ?? null),
          end: normalizeDateString(item.statement_period?.end ?? null)
        },
        metadata: { raw_type: item.type ?? null }
      };
    })
    .filter((t) => t !== null) as CanonicalTransaction[];
}

export function normalizeDocumentAITransactions(
  doc: DocumentAiNormalizedDocument,
  documentType: CanonicalDocument["documentType"] = "bank_statement"
): CanonicalTransaction[] {
  const transactions: CanonicalTransaction[] = [];
  const entities = doc.entities ?? [];

  for (const entity of entities) {
    if (!isTransactionEntity(entity, documentType)) continue;

    const amountEntity = pickEntity(entity, ["amount", "total", "net_amount"]);
    const dateEntity = pickEntity(entity, ["posting_date", "transaction_date", "date"]);
    const balanceEntity = pickEntity(entity, ["balance"]);
    const counterpartyEntity = pickEntity(entity, ["merchant_name", "counterparty", "vendor", "payee"]);

    const { debit, credit } = normalizeAmount(
      amountEntity?.mentionText ?? entity.mentionText ?? "",
      inferDirectionFromEntity(entity, amountEntity)
    ) ?? { debit: 0, credit: 0 };

    if (!debit && !credit) continue;

    const date = normalizeDateString(dateEntity?.normalizedValue?.text ?? dateEntity?.mentionText ?? null);

    transactions.push({
      date,
      posted_date: date,
      description: collapseWhitespace(entity.mentionText || counterpartyEntity?.mentionText || "Transaction"),
      payee: collapseWhitespace(counterpartyEntity?.mentionText || entity.mentionText || "Transaction"),
      debit,
      credit,
      balance: normalizeNumber(balanceEntity?.mentionText),
      account_id: null,
      source_bank: null,
      statement_period: { start: null, end: null },
      metadata: {
        documentai: {
          type: entity.type,
          confidence: entity.confidence,
        },
      },
    });
  }

  return transactions;
}

export function normalizeAmount(
  rawAmount: string | number,
  directionHint?: "debit" | "credit"
): { debit: number; credit: number } | null {
  const asString = String(rawAmount ?? "");
  const cleaned = asString.replace(/[^0-9.,()\-]/g, "").replace(/,/g, "");
  const negative = /-/.test(cleaned) || /\(.*\)/.test(cleaned);
  const parsed = parseFloat(cleaned.replace(/[()]/g, ""));

  if (Number.isNaN(parsed)) return null;

  const value = Math.abs(parsed);
  const isDebit = directionHint === "debit" || (!directionHint && negative);
  const debit = isDebit ? value : 0;
  const credit = isDebit ? 0 : value;

  return { debit, credit };
}

export function collapseWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeDateString(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return trimmed;

  const mdYMatch = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (!mdYMatch) return null;

  const [, m, d, y] = mdYMatch;
  const year = y ? (y.length === 2 ? `20${y}` : y.padStart(4, "0")) : new Date().getFullYear().toString();
  return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function pickEntity(entity: DocumentAiEntity, types: string[]): DocumentAiEntity | undefined {
  if (!entity.properties) return undefined;
  const lower = types.map(t => t.toLowerCase());
  return entity.properties.find(prop => prop.type && lower.includes(prop.type.toLowerCase()));
}

function isTransactionEntity(entity: DocumentAiEntity, docType: CanonicalDocument["documentType"]): boolean {
  const type = (entity.type || "").toLowerCase();
  if (type.includes("transaction")) return true;
  if (docType === "invoice" && (type.includes("line_item") || type.includes("lineitem"))) return true;
  if (docType === "bank_statement" && type.includes("bank")) return true;
  if (docType === "receipt" && type.includes("purchase")) return true;
  return false;
}

function inferDirectionFromEntity(
  entity: DocumentAiEntity,
  amountEntity?: DocumentAiEntity
): "debit" | "credit" | undefined {
  const type = (entity.type || "").toLowerCase();
  if (type.includes("credit")) return "credit";
  if (type.includes("debit")) return "debit";

  const amountText = amountEntity?.mentionText ?? entity.mentionText ?? "";
  if (/-|\(/.test(amountText)) return "debit";
  return undefined;
}

function normalizeNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : parseFloat(value.toString().replace(/[^0-9.-]/g, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

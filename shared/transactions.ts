export interface CanonicalTransaction {
  /** Customer-visible transaction date (e.g., activity date) */
  date: string | null;
  /** Posting/settlement date when available */
  posted_date: string | null;
  /** Raw description from the source document */
  description: string;
  /** Normalized counterparty/payee; falls back to description */
  payee: string | null;
  /** Positive debit amount; zero when credit is populated */
  debit: number;
  /** Positive credit amount; zero when debit is populated */
  credit: number;
  /** Running balance if present in the source */
  balance: number | null;
  /** Account identifier or masked number */
  account_id: string | null;
  /** Source bank or issuer name */
  source_bank: string | null;
  /** Statement period details */
  statement_period: {
    start: string | null;
    end: string | null;
  };
  /** Arbitrary metadata for debugging or downstream enrichment */
  metadata: Record<string, any>;
}

export interface CanonicalDocument {
  documentType: "bank_statement" | "invoice" | "receipt";
  transactions: CanonicalTransaction[];
  warnings?: string[];
  rawText?: string;
}

import type { NormalizedTransaction } from "./types";

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
  statement_period?: {
    start: string | null;
    end: string | null;
  };
  /** Arbitrary metadata for debugging or downstream enrichment */
  metadata?: Record<string, any>;
}

export interface CanonicalDocument {
  documentType: "bank_statement" | "invoice" | "receipt";
  transactions: CanonicalTransaction[];
  warnings?: string[];
  rawText?: string;
}

/**
 * Transaction normalization helpers
 * 
 * Provides utility functions for working with NormalizedTransaction objects,
 * including tracking edit state and detecting modifications.
 */

/**
 * Mark a transaction as edited by setting the edited flag in metadata.
 * 
 * This function ensures the edited flag is preserved even if metadata
 * is merged or updated elsewhere in the codebase.
 * 
 * @param tx - The transaction to mark as edited
 * @returns A new transaction object with edited flag set in metadata
 * 
 * @example
 * ```ts
 * const editedTx = markEdited(transaction);
 * // editedTx.metadata.edited === true
 * ```
 */
export function markEdited(tx: NormalizedTransaction): NormalizedTransaction {
  return {
    ...tx,
    metadata: {
      ...tx.metadata,
      edited: true,
      edited_at: new Date().toISOString(),
    },
  };
}

/**
 * Check if a transaction has been edited.
 * 
 * Detects edit state by checking the metadata.edited flag.
 * Returns true if the flag is explicitly set to true, false otherwise.
 * 
 * @param tx - The transaction to check
 * @returns true if the transaction has been edited, false otherwise
 * 
 * @example
 * ```ts
 * if (isEdited(transaction)) {
 *   // Show edit indicator in UI
 * }
 * ```
 */
export function isEdited(tx: NormalizedTransaction): boolean {
  return tx.metadata?.edited === true;
}


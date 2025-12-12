/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

/**
 * Normalized transaction type for consistent representation across parsing,
 * CSV export, DocAI ingestion, and UI components.
 * 
 * This type provides a stable domain model that all parts of the application
 * can rely on for transaction data.
 */
export interface NormalizedTransaction {
  /** Transaction date (ISO format or null if not available) */
  date: string | null;
  
  /** Posted date (ISO format or null if not available) */
  posted_date: string | null;
  
  /** Full transaction description */
  description: string;
  
  /** Extracted payee name (null if not available) */
  payee: string | null;
  
  /** Debit amount (positive number, 0 if not a debit) */
  debit: number;
  
  /** Credit amount (positive number, 0 if not a credit) */
  credit: number;
  
  /** Account balance after this transaction (null if not available) */
  balance: number | null;
  
  /** Account identifier (null if not available) */
  account_id: string | null;
  
  /** Source bank name (null if not available) */
  source_bank: string | null;
  
  /** Statement period information (optional) */
  statement_period?: {
    start: string | null;
    end: string | null;
  };
  
  /** Optional extracted/enriched description (can differ from raw description) */
  inferred_description?: string | null;

  /** Optional ending balance for the document (or transaction-level if provided) */
  ending_balance?: number | null;

  /** Additional metadata (e.g., edited flag, parsing source, etc.) */
  metadata?: TransactionMetadata;
}

export interface TransactionMetadata {
  edited?: boolean;
  edited_at?: string | null;
  inferred_description?: string | null;

  // Allow additional metadata keys without losing type-safety for known fields.
  [key: string]: any;
}

export interface DocumentAiTelemetry {
  enabled: boolean;
  processor: string | null;
  latencyMs: number | null;
  entityCount: number;
}

export interface IngestionFailure {
  phase: "upload" | "docai" | "normalize" | "export" | "unknown";
  message: string;
  ts: number;
  hint?: string;
}

export * from "./transactions";

/**
 * Structured error telemetry for ingestion pipeline failures.
 * 
 * This module provides types and utilities for tracking and logging
 * ingestion failures across the upload, Document AI, and normalization phases.
 */

/**
 * Ingestion phase where a failure occurred.
 */
export type IngestionPhase = "upload" | "docai" | "normalization" | "export";

/**
 * Structured ingestion failure event.
 * 
 * Captures all relevant information about a failure in the ingestion pipeline,
 * including when it occurred, what phase failed, and actionable hints for resolution.
 */
export interface IngestionFailure {
  /** Phase of the ingestion pipeline where the failure occurred */
  phase: IngestionPhase;
  
  /** Human-readable error message */
  message: string;
  
  /** ISO timestamp when the failure occurred */
  ts: string;
  
  /** Optional hint or suggestion for resolving the error */
  hint?: string;
  
  /** Optional filename associated with the failure */
  fileName?: string;
  
  /** Optional error code for programmatic handling */
  code?: string;
}

/**
 * Create a new IngestionFailure object with current timestamp.
 * 
 * @param phase - The ingestion phase where the failure occurred
 * @param message - Human-readable error message
 * @param hint - Optional hint for resolving the error
 * @param fileName - Optional filename associated with the failure
 * @param code - Optional error code
 * @returns A new IngestionFailure object
 */
export function createIngestionFailure(
  phase: IngestionPhase,
  message: string,
  hint?: string,
  fileName?: string,
  code?: string
): IngestionFailure {
  return {
    phase,
    message,
    ts: new Date().toISOString(),
    hint,
    fileName,
    code,
  };
}

/**
 * Format an IngestionFailure for display in logs or UI.
 * 
 * @param failure - The failure to format
 * @returns A formatted string representation
 */
export function formatIngestionFailure(failure: IngestionFailure): string {
  const time = new Date(failure.ts).toLocaleTimeString();
  const file = failure.fileName ? ` [${failure.fileName}]` : "";
  const hint = failure.hint ? ` → ${failure.hint}` : "";
  return `[${time}] ${failure.phase.toUpperCase()}${file}: ${failure.message}${hint}`;
}

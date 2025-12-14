export type LogLevel = "info" | "warn" | "error";

/**
 * Maps internal log levels to GCP severity levels expected by Error Reporting.
 * See: https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
 */
function mapToGcpSeverity(level: LogLevel): string {
  switch (level) {
    case "error":
      return "ERROR";
    case "warn":
      return "WARNING";
    case "info":
    default:
      return "INFO";
  }
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Error) {
        return {
          name: v.name,
          message: v.message,
          stack: v.stack,
        };
      }
      return v;
    });
  } catch {
    // Never allow logging to crash the process.
    return JSON.stringify({ event: "log_serialize_failure", ts: new Date().toISOString() });
  }
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: typeof error === "string" ? error : "Unknown error", raw: error };
}

/**
 * Structured log emitter.
 * Emits a single JSON line, compatible with Cloud Run log ingestion and GCP Error Reporting.
 * 
 * When level is "error", the log will appear in GCP Error Reporting if it includes:
 * - severity: "ERROR" (automatically added for error-level logs)
 * - message: A human-readable error message
 * - stack: Stack trace (if error object is provided)
 * - Additional metadata for filtering (e.g., exportId, event)
 */
export function logEvent(event: string, fields: Record<string, unknown> = {}, level: LogLevel = "info"): void {
  const timestamp = new Date().toISOString();
  const payload = {
    // GCP Error Reporting expects "severity" field with uppercase values
    severity: mapToGcpSeverity(level),
    level,
    event,
    timestamp,
    ts: timestamp,
    ...fields,
  };

  const line = safeJsonStringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Interface for ingestion error metadata.
 * Contains all fields required by GCP Error Reporting for proper filtering and tracking.
 */
export interface IngestionErrorMetadata {
  /** Export ID for tracking the failed ingestion */
  exportId?: string | null;
  /** Phase where the error occurred */
  phase?: string;
  /** Original error object (will be serialized) */
  error?: unknown;
  /** File name being processed */
  fileName?: string;
  /** Document type being processed */
  documentType?: string;
  /** Additional context fields */
  [key: string]: unknown;
}

/**
 * Logs an ingestion error with structured metadata for GCP Error Reporting.
 * 
 * This function ensures errors appear in GCP Error Reporting with:
 * - severity: "ERROR" for proper categorization
 * - event: "ingestion_error" for easy filtering
 * - exportId: For tracking specific ingestion attempts
 * - stack: Stack trace from the error object
 * - Additional context (phase, fileName, documentType, etc.)
 * 
 * @param message - Human-readable error message
 * @param metadata - Additional context about the error
 */
export function logIngestionError(message: string, metadata: IngestionErrorMetadata = {}): void {
  const { error, exportId, ...otherFields } = metadata;
  
  // Serialize error and extract stack/name separately to preserve message parameter
  const serializedError = serializeError(error);
  const { message: errorMessage, ...errorFields } = serializedError;
  // We omit errorMessage and use the message parameter instead
  
  logEvent("ingestion_error", {
    message,
    exportId: exportId ?? null,
    ...errorFields,
    ...otherFields,
  }, "error");
}


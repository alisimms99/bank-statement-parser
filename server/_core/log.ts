export type LogLevel = "info" | "warn" | "error";

/**
 * Map our log levels to Cloud Logging severity levels
 * https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#LogSeverity
 */
function getCloudLoggingSeverity(level: LogLevel): string {
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
    return JSON.stringify({ event: "log_serialize_failure", timestamp: new Date().toISOString() });
  }
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: typeof error === "string" ? error : "Unknown error", raw: error };
}

/**
 * Structured log emitter optimized for Cloud Logging.
 * 
 * Emits JSON logs compatible with Cloud Run log ingestion and Cloud Logging.
 * Uses Cloud Logging severity levels and structured fields for better querying.
 * 
 * Event types for metrics:
 * - ingestion_start: Start of document ingestion
 * - ingestion_complete: Successful completion of ingestion
 * - ingestion_error: Failed ingestion
 * - export_csv: CSV export event
 * - export_pdf: PDF export event
 * - cold_start: Cold start detected
 */
export function logEvent(event: string, fields: Record<string, unknown> = {}, level: LogLevel = "info"): void {
  const payload = {
    severity: getCloudLoggingSeverity(level),
    message: event,
    event,
    timestamp: new Date().toISOString(),
    // Include trace context if available (for Cloud Trace integration)
    ...(fields["trace"] ? { "logging.googleapis.com/trace": fields["trace"] } : {}),
    ...fields,
  };

  const line = safeJsonStringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}


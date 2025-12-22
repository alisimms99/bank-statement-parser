export type LogLevel = "info" | "warn" | "error";

type LogSeverity = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

interface StructuredLog {
  severity: LogSeverity;
  message: string;
  timestamp: string;
  // Google Cloud Error Reporting fields
  "@type"?: string;
  serviceContext?: {
    service: string;
    version: string;
  };
  context?: {
    httpRequest?: {
      method: string;
      url: string;
      userAgent?: string;
      responseStatusCode?: number;
    };
    reportLocation?: {
      filePath: string;
      lineNumber: number;
      functionName: string;
    };
  };
  // Custom metadata
  exportId?: string;
  event?: string;
  stack?: string;
  metadata?: Record<string, unknown>;
}

const SERVICE_NAME = "bank-statement-parser";
const SERVICE_VERSION = process.env.K_REVISION || process.env.npm_package_version || "local";

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
 * Emits a single JSON line, compatible with Cloud Run log ingestion.
 */
export function logEvent(event: string, fields: Record<string, unknown> = {}, level: LogLevel = "info"): void {
  const payload = {
    level,
    event,
    ts: new Date().toISOString(),
    ...fields,
  };

  const line = safeJsonStringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function formatLog(log: StructuredLog): string {
  return safeJsonStringify(log);
}

function mapLogLevelToSeverity(level: LogLevel): LogSeverity {
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

/**
 * Log info message with structured format
 */
export function logInfo(message: string, metadata?: Record<string, unknown>): void {
  const log: StructuredLog = {
    severity: "INFO",
    message,
    timestamp: new Date().toISOString(),
    metadata,
  };
  console.log(formatLog(log));
}

/**
 * Log warning message with structured format
 */
export function logWarning(message: string, metadata?: Record<string, unknown>): void {
  const log: StructuredLog = {
    severity: "WARNING",
    message,
    timestamp: new Date().toISOString(),
    metadata,
  };
  console.warn(formatLog(log));
}

/**
 * Log error message with structured format compatible with Google Cloud Error Reporting
 */
export function logError(
  message: string,
  error?: Error,
  metadata?: Record<string, unknown> & { exportId?: string; event?: string }
): void {
  const log: StructuredLog = {
    severity: "ERROR",
    message,
    timestamp: new Date().toISOString(),
    "@type": "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent",
    serviceContext: {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
    },
    exportId: metadata?.exportId,
    event: metadata?.event || "ingestion_error",
    stack: error?.stack,
    metadata: {
      ...metadata,
      errorName: error?.name,
      errorMessage: error?.message,
    },
  };
  console.error(formatLog(log));
}

/**
 * Log ingestion error with context for Google Cloud Error Reporting
 */
export function logIngestionError(
  exportId: string,
  fileName: string,
  error: Error,
  stage: "upload" | "extraction" | "normalization" | "export"
): void {
  logError(`Ingestion failed at ${stage} stage`, error, {
    exportId,
    event: "ingestion_error",
    fileName,
    stage,
  });
}

/**
 * Log ingestion success with metrics
 */
export function logIngestionSuccess(
  exportId: string,
  fileName: string,
  transactionCount: number,
  source: "documentai" | "legacy",
  durationMs: number
): void {
  logInfo("Ingestion completed successfully", {
    exportId,
    event: "ingestion_complete",
    fileName,
    transactionCount,
    source,
    durationMs,
  });
}


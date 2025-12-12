export type LogLevel = "info" | "warn" | "error";

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


// Logging utilities
export function logEvent(event: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${event}`, JSON.stringify(data));
  } else {
    console.log(`[${timestamp}] ${event}`);
  }
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { error: String(error) };
}

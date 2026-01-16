// Export metrics tracking stub
export type ExportFormat = "csv" | "sheets" | "pdf";

export interface ExportEvent {
  format: ExportFormat;
  transactionCount: number;
  userId?: string;
  timestamp: Date;
}

const events: ExportEvent[] = [];

export function recordExportEvent(event: Omit<ExportEvent, "timestamp">): void {
  events.push({
    ...event,
    timestamp: new Date(),
  });
  console.log(`[Metrics] Export event recorded: ${event.format}, ${event.transactionCount} transactions`);
}

export function getExportEvents(): ExportEvent[] {
  return [...events];
}

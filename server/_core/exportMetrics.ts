export type ExportFormat = "csv" | "pdf" | "sheets";

export interface ExportEvent {
  exportId: string;
  format: ExportFormat;
  transactionCount: number;
  timestamp: number;
  success: boolean;
  error?: string;
}

const exportMetrics: ExportEvent[] = [];

/**
 * Record an export event for metrics tracking
 */
export function recordExportEvent(event: ExportEvent): void {
  exportMetrics.push(event);
  // Keep only last 500 events
  if (exportMetrics.length > 500) {
    exportMetrics.shift();
  }
}

/**
 * Get export metrics summary
 */
export function getExportMetricsSummary() {
  const counts = exportMetrics.reduce(
    (acc, m) => {
      acc[m.format] = (acc[m.format] || 0) + 1;
      return acc;
    },
    {} as Record<ExportFormat, number>
  );

  const successCount = exportMetrics.filter(m => m.success).length;
  const failureCount = exportMetrics.filter(m => !m.success).length;
  const totalTransactions = exportMetrics.reduce((sum, m) => sum + m.transactionCount, 0);

  return {
    counts,
    successCount,
    failureCount,
    totalExports: exportMetrics.length,
    totalTransactions,
    recent: exportMetrics.slice(-20),
  };
}


import type { IngestionFailure } from "@shared/types";

export type IngestSource = "documentai" | "legacy" | "error";

interface IngestMetric {
  source: IngestSource;
  durationMs: number;
  documentType: string;
  timestamp: number;
  fallbackReason?: string | null;
}

const metrics: IngestMetric[] = [];
const ingestFailureLog: IngestionFailure[] = [];

export function recordIngestMetric(entry: IngestMetric) {
  metrics.push(entry);
  if (metrics.length > 500) {
    metrics.shift();
  }
}

export function recordIngestFailure(failure: IngestionFailure): void {
  ingestFailureLog.push(failure);
  if (ingestFailureLog.length > 500) {
    ingestFailureLog.shift();
  }
}

export function getIngestMetricsSummary() {
  const counts = metrics.reduce(
    (acc, m) => {
      acc[m.source] += 1;
      return acc;
    },
    { documentai: 0, legacy: 0, error: 0 } as Record<IngestSource, number>
  );

  const durations = metrics.map(m => m.durationMs);
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  return {
    counts,
    averageDurationMs: Math.round(avgDuration),
    recent: metrics.slice(-20),
  };
}

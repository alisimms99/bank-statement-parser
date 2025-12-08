import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DocumentAiTelemetry, IngestionSource, NormalizedTransaction } from "@shared/types";
import { RefreshCw } from "lucide-react";

export interface IngestionDebugData {
  source: IngestionSource;
  normalizedTransactions: NormalizedTransaction[];
  docAiTelemetry?: DocumentAiTelemetry;
  fallbackReason?: string;
}

export interface DebugPanelProps {
  ingestionData: IngestionDebugData;
  onRetry: () => void;
}

/**
 * Debug panel component for inspecting ingestion results and normalized transactions.
 * 
 * Displays:
 * - Source badge (DOC AI PATH / FALLBACK PATH)
 * - Preview table of first 10 normalized transactions
 * - Retry button to reset the pipeline
 * 
 * Only shown when DEBUG_VIEW=true in environment variables.
 */
export default function DebugPanel({ ingestionData, onRetry }: DebugPanelProps) {
  const { source, normalizedTransactions, docAiTelemetry, fallbackReason } = ingestionData;
  
  // Show first 10 transactions
  const previewTransactions = normalizedTransactions.slice(0, 10);
  const hasMore = normalizedTransactions.length > 10;

  // Determine source badge label and variant
  const sourceLabel = source === "documentai" 
    ? "DOC AI PATH" 
    : source === "legacy" 
    ? "FALLBACK PATH" 
    : "ERROR";
  
  const sourceVariant = source === "documentai"
    ? "default"
    : source === "legacy"
    ? "secondary"
    : "destructive";

  const telemetryItems = docAiTelemetry
    ? [
        { label: "Enabled", value: docAiTelemetry.enabled ? "Yes" : "No" },
        { label: "Processor", value: docAiTelemetry.processor ?? "—" },
        { label: "Latency", value: docAiTelemetry.latencyMs != null ? `${docAiTelemetry.latencyMs} ms` : "—" },
        { label: "Entities", value: docAiTelemetry.entityCount },
      ]
    : [];

  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-card/50 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Ingestion Debug Panel</div>
              <p className="text-xs text-muted-foreground mt-1">
                Raw normalized transactions and ingestion source for troubleshooting.
              </p>
            </div>
            <Badge variant={sourceVariant} className="uppercase tracking-wide">
              {sourceLabel}
            </Badge>
          </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onRetry}
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </Button>
      </div>

      {(docAiTelemetry || fallbackReason) && (
        <div className="rounded-lg border border-border/60 bg-background/70 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-foreground">DocAI Execution Telemetry</div>
            {fallbackReason && (
              <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                Fallback: {fallbackReason}
              </Badge>
            )}
          </div>

          {telemetryItems.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {telemetryItems.map(item => (
                <div key={item.label} className="rounded-md border border-border/50 bg-card/70 p-3">
                  <div className="text-[11px] uppercase text-muted-foreground tracking-wide">{item.label}</div>
                  <div className="text-sm font-semibold text-foreground mt-1">{item.value}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No DocAI telemetry available.</div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border/60 bg-background/70 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/60 bg-background/80">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-foreground">
              Normalized Transactions Preview
            </div>
            <div className="text-xs text-muted-foreground">
              Showing {previewTransactions.length} of {normalizedTransactions.length}
            </div>
          </div>
        </div>
        
        {previewTransactions.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-semibold">Date</TableHead>
                  <TableHead className="text-xs font-semibold">Posted Date</TableHead>
                  <TableHead className="text-xs font-semibold">Description</TableHead>
                  <TableHead className="text-xs font-semibold">Payee</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Debit</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Credit</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewTransactions.map((tx, index) => (
                  <TableRow key={index} className="hover:bg-accent/30">
                    <TableCell className="text-xs font-mono">
                      {tx.date ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {tx.posted_date ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs max-w-xs truncate" title={tx.description}>
                      {tx.description}
                    </TableCell>
                    <TableCell className="text-xs max-w-xs truncate" title={tx.payee ?? ""}>
                      {tx.payee ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-right tabular-nums">
                      {tx.debit > 0 ? `$${tx.debit.toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-right tabular-nums">
                      {tx.credit > 0 ? `$${tx.credit.toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-right tabular-nums">
                      {tx.balance !== null ? `$${tx.balance.toFixed(2)}` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No normalized transactions available
          </div>
        )}

        {hasMore && (
          <div className="px-4 py-2 border-t border-border/60 bg-background/80 text-xs text-muted-foreground text-center">
            ... and {normalizedTransactions.length - 10} more transaction(s)
          </div>
        )}
      </div>
    </div>
  );
}


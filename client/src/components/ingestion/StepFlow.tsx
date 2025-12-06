import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle, Loader2, TriangleAlert } from "lucide-react";

export type IngestionPhase = "upload" | "extraction" | "normalization" | "export" | "error";

export interface FileStatus {
  phase: IngestionPhase;
  message: string;
  source: "documentai" | "legacy" | "error";
  fallback?: string | null;
  errors?: string[];
  retryable?: boolean;
  durationMs?: number;
  meta?: Record<string, any>;
}

const phaseOrder: IngestionPhase[] = ["upload", "extraction", "normalization", "export"];

export function StepFlow({
  statuses,
  onRetry,
}: {
  statuses: Record<string, FileStatus>;
  onRetry?: (fileName: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-4 space-y-3">
      <div className="text-sm font-semibold text-foreground">Ingestion status</div>
      <div className="space-y-3 text-sm">
        {Object.entries(statuses).map(([fileName, status]) => (
          <div
            key={fileName}
            className="flex flex-col gap-2 rounded-lg border border-border/50 bg-background/60 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col">
                <span className="font-medium text-foreground">{fileName}</span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 capitalize">
                    {status.source === "documentai" ? "Document AI" : status.source === "legacy" ? "Legacy parser" : "Error"}
                  </span>
                  {status.fallback && (
                    <Badge variant="outline" className="h-6 text-[11px]">
                      Fallback: {status.fallback}
                    </Badge>
                  )}
                  {typeof status.durationMs === "number" && (
                    <Badge variant="secondary" className="h-6 text-[11px]">
                      {Math.round(status.durationMs)} ms
                    </Badge>
                  )}
                </div>
              </div>
              <Badge variant={status.source === "legacy" ? "secondary" : "default"} className="capitalize">
                {status.phase === "error" ? "Error" : status.phase}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {phaseOrder.map(phase => (
                <PhasePill
                  key={phase}
                  active={isPhaseActive(phase, status.phase)}
                  errored={status.phase === "error"}
                >
                  {phase}
                </PhasePill>
              ))}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              {status.phase === "error" ? <TriangleAlert className="h-3 w-3 text-destructive" /> : null}
              <span>
                {status.message}
                {status.fallback ? ` (fallback: ${status.fallback})` : ""}
              </span>
            </div>
            {status.errors && status.errors.length > 0 && (
              <ul className="text-xs text-destructive list-disc list-inside">
                {status.errors.map(err => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}
            {status.phase === "error" && onRetry && status.retryable !== false && (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={() => onRetry(fileName)}
                >
                  Retry ingestion
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
function PhasePill({ children, active, errored }: { children: string; active: boolean; errored?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-1",
        active ? "bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground",
        errored ? "border border-destructive/40" : undefined
      )}
    >
      {active ? <CheckCircle className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {children}
    </span>
  );
}

function isPhaseActive(phase: IngestionPhase, current: IngestionPhase) {
  if (current === "error") return true;
  const currentIndex = phaseOrder.indexOf(current);
  const phaseIndex = phaseOrder.indexOf(phase);
  if (currentIndex === -1 || phaseIndex === -1) return false;
  return phaseIndex <= currentIndex;
}

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { downloadCSV } from "@/lib/pdfParser";
import { toCSV } from "@shared/export/csv";
import type { CanonicalTransaction } from "@shared/transactions";
import { Download, FileText, Info, Sparkles, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export interface ResultPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactions: CanonicalTransaction[];
  source: "documentai" | "legacy" | "error";
  processedFiles: string[];
  exportId?: string; // UUID for backend CSV export
  statementMetadata?: {
    period?: { start: string | null; end: string | null };
    accountId?: string | null;
    sourceBank?: string | null;
  };
}

interface CleanupResult {
  cleaned: CanonicalTransaction[];
  removed: CanonicalTransaction[];
  flagged: CanonicalTransaction[];
}

/**
 * Modal component for previewing parse results after successful ingestion.
 * 
 * Features:
 * - Displays canonical transaction table with all fields
 * - Shows confidence badges for DocAI mode
 * - Displays statement metadata (period, account, bank)
 * - Export to CSV button
 * - AI Cleanup integration to remove garbage rows and standardize merchants
 */
export default function ResultPreviewModal({
  open,
  onOpenChange,
  transactions: initialTransactions,
  source,
  processedFiles,
  exportId,
  statementMetadata,
}: ResultPreviewModalProps) {
  const [transactions, setTransactions] = useState<CanonicalTransaction[]>(initialTransactions);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupStats, setCleanupStats] = useState<{
    removed: number;
    flagged: number;
  } | null>(null);

  // Reset state when modal opens with new transactions
  useEffect(() => {
    if (open) {
      setTransactions(initialTransactions);
      setCleanupStats(null);
    }
  }, [open]);

  const handleExportCSV = async () => {
    if (transactions.length === 0) {
      toast.error("No transactions to export");
      return;
    }

    // Use backend export endpoint if exportId is available AND we haven't modified the transactions locally
    // If we've cleaned the transactions, we MUST use client-side export to reflect changes
    if (exportId && !cleanupStats) {
      try {
        const url = `/api/export/${exportId}/csv?bom=true`;
        window.location.href = url;
        toast.success("CSV file download started");
      } catch (error) {
        console.error("Error downloading CSV from backend", error);
        toast.error("Failed to download CSV from backend, falling back to client-side export");
        const csv = toCSV(transactions, { includeBOM: true });
        const timestamp = new Date().toISOString().split("T")[0];
        const filename = `bank-transactions-${timestamp}.csv`;
        downloadCSV(csv, filename);
      }
    } else {
      const csv = toCSV(transactions, { includeBOM: true });
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `bank-transactions-${timestamp}.csv`;
      downloadCSV(csv, filename);
      toast.success("CSV file downloaded successfully");
    }
  };

  const handleAICleanup = async () => {
    setIsCleaning(true);
    try {
      const response = await fetch("/api/cleanup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ transactions }),
      });

      if (!response.ok) {
        throw new Error("Cleanup request failed");
      }

      const result: CleanupResult = await response.json();
      
      // Update transactions with cleaned ones
      // We merge cleaned and flagged, as flagged are kept but need review
      const updatedTransactions = [...result.cleaned, ...result.flagged];
      
      // Sort by date if possible
      updatedTransactions.sort((a, b) => {
        const dateA = a.date || a.posted_date || "";
        const dateB = b.date || b.posted_date || "";
        return dateA.localeCompare(dateB);
      });

      setTransactions(updatedTransactions);
      setCleanupStats({
        removed: result.removed.length,
        flagged: result.flagged.length,
      });

      toast.success(`AI Cleanup complete: ${result.removed.length} rows removed, ${result.flagged.length} flagged.`);
    } catch (error) {
      console.error("AI Cleanup failed", error);
      toast.error("AI Cleanup failed. Please try again.");
    } finally {
      setIsCleaning(false);
    }
  };

  // Determine source badge
  const sourceLabel =
    source === "documentai"
      ? "Document AI"
      : source === "legacy"
        ? "Legacy Parser"
        : "Error";

  const sourceVariant =
    source === "documentai"
      ? "default"
      : source === "legacy"
        ? "secondary"
        : "destructive";

  // Extract confidence from metadata if available (DocAI mode)
  const getConfidence = (tx: CanonicalTransaction): number | null => {
    if (source !== "documentai") return null;
    return tx.metadata?.confidence ?? null;
  };

  // Format confidence badge
  const ConfidenceBadge = ({ confidence }: { confidence: number | null }) => {
    if (confidence === null) return null;

    const percentage = Math.round(confidence * 100);
    const variant =
      percentage >= 90 ? "default" : percentage >= 70 ? "secondary" : "destructive";

    return (
      <Badge variant={variant} className="text-xs">
        {percentage}%
      </Badge>
    );
  };

  // Extract statement metadata from first transaction
  const firstTx = transactions[0];
  const period = firstTx?.statement_period || statementMetadata?.period;
  const accountId = firstTx?.account_id || statementMetadata?.accountId;
  const sourceBank = firstTx?.source_bank || statementMetadata?.sourceBank;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle>Parse Results Preview</DialogTitle>
                <DialogDescription>
                  {transactions.length} transaction{transactions.length !== 1 ? "s" : ""} from{" "}
                  {processedFiles.length} file{processedFiles.length !== 1 ? "s" : ""}
                </DialogDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {cleanupStats && (
                <div className="flex items-center gap-2 mr-2">
                  <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
                    <Trash2 className="w-3 h-3" /> {cleanupStats.removed} removed
                  </Badge>
                  <Badge variant="outline" className="text-xs gap-1 text-amber-600 border-amber-200 bg-amber-50">
                    <AlertCircle className="w-3 h-3" /> {cleanupStats.flagged} flagged
                  </Badge>
                </div>
              )}
              <Badge variant={sourceVariant} className="uppercase tracking-wide">
                {sourceLabel}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        {/* Statement Metadata */}
        {(period || accountId || sourceBank) && (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Info className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Statement Metadata</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              {period?.start && period?.end && (
                <div>
                  <div className="text-xs text-muted-foreground">Statement Period</div>
                  <div className="font-medium text-foreground">
                    {period.start} to {period.end}
                  </div>
                </div>
              )}
              {accountId && (
                <div>
                  <div className="text-xs text-muted-foreground">Account ID</div>
                  <div className="font-medium text-foreground">{accountId}</div>
                </div>
              )}
              {sourceBank && (
                <div>
                  <div className="text-xs text-muted-foreground">Source Bank</div>
                  <div className="font-medium text-foreground">{sourceBank}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Transaction Table */}
        <div className="flex-1 overflow-auto rounded-lg border border-border">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="font-semibold">Date</TableHead>
                <TableHead className="font-semibold">Description</TableHead>
                <TableHead className="font-semibold">Payee</TableHead>
                <TableHead className="font-semibold text-right">Debit</TableHead>
                <TableHead className="font-semibold text-right">Credit</TableHead>
                <TableHead className="font-semibold text-right">Balance</TableHead>
                {source === "documentai" && (
                  <TableHead className="font-semibold text-center">Confidence</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((tx, index) => {
                const isFlagged = !tx.date;
                return (
                  <TableRow 
                    key={index} 
                    className={`hover:bg-accent/30 ${isFlagged ? "bg-amber-50/50 dark:bg-amber-900/10" : ""}`}
                  >
                    <TableCell className="font-medium tabular-nums">
                      <div className="flex items-center gap-2">
                        {isFlagged && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertCircle className="w-3 h-3 text-amber-600" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Missing date - flagged for review</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {tx.date ?? tx.posted_date ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs truncate" title={tx.description}>
                      {tx.description}
                    </TableCell>
                    <TableCell className="max-w-xs truncate" title={tx.payee ?? ""}>
                      {tx.payee ?? "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${
                        tx.debit > 0 ? "text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {tx.debit > 0 ? `$${tx.debit.toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${
                        tx.credit > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                      }`}
                    >
                      {tx.credit > 0 ? `$${tx.credit.toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {tx.balance !== null && tx.balance !== undefined
                        ? `$${tx.balance.toFixed(2)}`
                        : "—"}
                    </TableCell>
                    {source === "documentai" && (
                      <TableCell className="text-center">
                        <ConfidenceBadge confidence={getConfidence(tx)} />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="flex-row justify-between items-center gap-3">
          <div className="text-xs text-muted-foreground">
            Files: {processedFiles.join(", ")}
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              onClick={handleAICleanup} 
              disabled={isCleaning || transactions.length === 0}
              className="gap-2 border-primary/20 hover:bg-primary/5"
            >
              {isCleaning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 text-primary" />
              )}
              {isCleaning ? "Cleaning..." : "Clean with AI"}
            </Button>
            <Button onClick={handleExportCSV} className="gap-2">
              <Download className="w-4 h-4" />
              Export to CSV
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

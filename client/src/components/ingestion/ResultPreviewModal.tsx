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
import { downloadCSV } from "@/lib/pdfParser";
import { toCSV } from "@shared/export/csv";
import type { CanonicalTransaction } from "@shared/transactions";
import { Download, FileText, Info } from "lucide-react";
import { toast } from "sonner";

export interface ResultPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactions: CanonicalTransaction[];
  source: "documentai" | "unavailable" | "error";
  processedFiles: string[];
  statementMetadata?: {
    period?: { start: string | null; end: string | null };
    accountId?: string | null;
    sourceBank?: string | null;
  };
}

/**
 * Modal component for previewing parse results after successful ingestion.
 * 
 * Features:
 * - Displays canonical transaction table with all fields
 * - Shows confidence badges for DocAI mode
 * - Displays statement metadata (period, account, bank)
 * - Export to CSV button
 * - Handles both DocAI and fallback modes consistently
 */
export default function ResultPreviewModal({
  open,
  onOpenChange,
  transactions,
  source,
  processedFiles,
  statementMetadata,
}: ResultPreviewModalProps) {
  const handleExportCSV = () => {
    if (transactions.length === 0) {
      toast.error("No transactions to export");
      return;
    }

    const csv = toCSV(transactions, { includeBOM: true });
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `bank-transactions-${timestamp}.csv`;

    downloadCSV(csv, filename);
    toast.success("CSV file downloaded successfully");
  };

  // Determine source badge
  const sourceLabel =
    source === "documentai"
      ? "Document AI"
      : source === "unavailable"
        ? "Legacy Parser"
        : "Error";

  const sourceVariant =
    source === "documentai"
      ? "default"
      : source === "unavailable"
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
            <Badge variant={sourceVariant} className="uppercase tracking-wide">
              {sourceLabel}
            </Badge>
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
              {transactions.map((tx, index) => (
                <TableRow key={index} className="hover:bg-accent/30">
                  <TableCell className="font-medium tabular-nums">
                    {tx.date ?? tx.posted_date ?? "—"}
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
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="flex-row justify-between items-center gap-3">
          <div className="text-xs text-muted-foreground">
            Files: {processedFiles.join(", ")}
          </div>
          <Button onClick={handleExportCSV} className="gap-2">
            <Download className="w-4 h-4" />
            Export to CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

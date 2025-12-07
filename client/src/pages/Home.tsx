import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import FileUpload from "@/components/FileUpload";
import TransactionTable from "@/components/TransactionTable";
import {
  canonicalToDisplayTransaction,
  downloadCSV,
  extractTextFromPDF,
  legacyTransactionsToCanonical,
  parseStatementText,
  Transaction
} from "@/lib/pdfParser";
import { ingestWithDocumentAI } from "@/lib/ingestionClient";
import type { NormalizedTransaction } from "@shared/types";
import { toCSV } from "@shared/export/csv";
import { Download, FileText, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

export default function Home() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [normalizedTransactions, setNormalizedTransactions] = useState<NormalizedTransaction[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedFiles, setProcessedFiles] = useState<string[]>([]);
  const [includeBom, setIncludeBom] = useState(true);

  const handleFilesSelected = async (files: File[]) => {
    setIsProcessing(true);
    const allTransactions: Transaction[] = [];
    const allCanonical: NormalizedTransaction[] = [];
    const fileNames: string[] = [];

    try {
      let processedCount = 0;
      for (const file of files) {
        toast.info(`Processing ${file.name}...`);
        setStatus(file.name, "upload", "File received", "documentai");

        try {
          const result = await ingestWithDocumentAI(file, "bank_statement");

          if (result.source === "error") {
            const message = result.error ?? "Invalid upload";
            toast.error(message);
            setStatus(file.name, "error", message, "error");
            continue;
          }

          if (result.document && result.document.transactions.length > 0) {
            setStatus(file.name, "extraction", "Document AI extraction complete", "documentai");
            const canonical = result.document.transactions;
            allCanonical.push(...canonical);
            allTransactions.push(...canonical.map(canonicalToDisplayTransaction));
            fileNames.push(file.name);
            setStatus(file.name, "normalization", "Normalized to canonical schema", "documentai");
            setStatus(file.name, "export", "Ready for export", "documentai");
            toast.success(`Document AI extracted ${canonical.length} transactions from ${file.name}`);
            continue;
          }

          setStatus(file.name, "extraction", "Document AI unavailable, using legacy parser", "legacy");
          const text = await extractTextFromPDF(file);
          const parsedTransactions = parseStatementText(text);
          const canonical = legacyTransactionsToCanonical(parsedTransactions);

          allTransactions.push(...canonical.map(canonicalToDisplayTransaction));
          allCanonical.push(...canonical);
          fileNames.push(file.name);

          setStatus(file.name, "normalization", "Legacy normalization complete", "legacy");
          setStatus(file.name, "export", "Ready for export", "legacy");
          toast.success(`Extracted ${parsedTransactions.length} transactions from ${file.name}`);
        } catch (error) {
          console.error(`Error processing ${file.name}:`, error);
          toast.error(`Failed to process ${file.name}`);
          setStatus(file.name, "error", "Failed to process file", "error");
        }
      }

      setTransactions(allTransactions);
      setNormalizedTransactions(allCanonical);
      setProcessedFiles(fileNames);
      
      if (allTransactions.length > 0) {
        toast.success(`Total: ${allTransactions.length} transactions from ${fileNames.length} file(s)`);
      }
    } catch (error) {
      console.error("Error processing files:", error);
      toast.error("An error occurred while processing files");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetry = async (fileName: string) => {
    const cached = fileCache.current.get(fileName);
    if (!cached) {
      toast.error("Original file is not available to retry. Please re-upload.");
      return;
    }
    setIsProcessing(true);
    await processFile(cached);
    setIsProcessing(false);
  };

  const handleExportCSV = () => {
    if (normalizedTransactions.length === 0) {
      toast.error('No transactions to export');
      return;
    }

    const csv = toCSV(normalizedTransactions, { includeBOM: includeBom });
    const timestamp = new Date().toISOString().split('T')[0];
    downloadCSV(csv, `bank-transactions-${timestamp}.csv`);
    toast.success('CSV file downloaded successfully');
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Animated background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-blue-900/20 dark:to-purple-900/20" />
      
      {/* Floating orbs for depth */}
      <div className="fixed top-20 left-10 w-72 h-72 bg-blue-400/20 rounded-full blur-3xl animate-pulse" />
      <div className="fixed bottom-20 right-10 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      
      <div className="relative z-10">
        {/* Header */}
        <header className="border-b border-border/50 backdrop-blur-md bg-background/30">
          <div className="container mx-auto px-6 py-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <FileText className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  Bank Statement Parser
                </h1>
                <p className="text-sm text-muted-foreground">
                  Extract transactions from PDF statements for QuickBooks reconciliation
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="container mx-auto px-6 py-12">
          <div className="max-w-5xl mx-auto space-y-8">
            {/* Upload section */}
            <div className="space-y-4">
              <FileUpload onFilesSelected={handleFilesSelected} />

              {Object.keys(fileStatuses).length > 0 && (
                <div className="rounded-xl border border-border/60 bg-card/50 p-4 space-y-3">
                  <div className="text-sm font-semibold text-foreground">Ingestion status</div>
                  <div className="space-y-2 text-sm">
                    {Object.entries(fileStatuses).map(([fileName, status]) => (
                      <div
                        key={fileName}
                        className="flex flex-col gap-1 rounded-lg border border-border/50 bg-background/60 px-3 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">{fileName}</span>
                          <span className="text-xs text-muted-foreground uppercase tracking-wide">
                            {status.source === 'documentai' ? 'Document AI' : status.source === 'legacy' ? 'Legacy' : 'Error'}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {status.phase} — {status.message}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isProcessing && (
                <div className="flex items-center justify-center gap-3 py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground font-medium">
                    Processing PDF files...
                  </span>
                </div>
              )}

              {(docAiFiles > 0 || legacyFiles > 0) && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border/60 bg-card/60 p-3 text-sm">
                    <div className="text-xs text-muted-foreground">Document AI path</div>
                    <div className="text-lg font-semibold text-foreground">{docAiFiles} file(s)</div>
                    <p className="text-xs text-muted-foreground">Requires ENABLE_DOC_AI and valid credentials.</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card/60 p-3 text-sm">
                    <div className="text-xs text-muted-foreground">Legacy fallback</div>
                    <div className="text-lg font-semibold text-foreground">{legacyFiles} file(s)</div>
                    <p className="text-xs text-muted-foreground">Used when Document AI is unavailable or errors.</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card/60 p-3 text-sm">
                    <div className="text-xs text-muted-foreground">Normalization ready</div>
                    <div className="text-lg font-semibold text-foreground">{exportReadyCount} transaction(s)</div>
                    <p className="text-xs text-muted-foreground">Ready to export to CSV once processing finishes.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Results section */}
            {showDebug && (
              <div className="rounded-xl border border-dashed border-border/70 bg-card/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Developer debug view</div>
                    <p className="text-xs text-muted-foreground">
                      Raw normalized transactions and ingestion metadata for troubleshooting.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setShowDebug(false)}>
                    Hide debug
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Normalized transactions</div>
                    <pre className="text-[11px] whitespace-pre-wrap break-words max-h-64 overflow-auto">
                      {JSON.stringify(normalizedTransactions, null, 2)}
                    </pre>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Ingestion statuses</div>
                    <pre className="text-[11px] whitespace-pre-wrap break-words max-h-64 overflow-auto">
                      {JSON.stringify(fileStatuses, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            )}

            {transactions.length > 0 && !isProcessing && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Action bar */}
                <div className="flex flex-col gap-3 p-4 rounded-xl border border-border bg-card/50 backdrop-blur-md">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">
                        Files Processed
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {processedFiles.join(', ')}
                      </span>
                    </div>

                    <Button
                      onClick={handleExportCSV}
                      className="gap-2 shadow-lg hover:shadow-xl transition-shadow"
                    >
                      <Download className="w-4 h-4" />
                      Export to CSV
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border/60 px-3 py-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">UTF-8 BOM for Excel</span>
                      <span className="text-xs text-muted-foreground">Enable for QuickBooks/Excel imports that expect a BOM marker.</span>
                    </div>
                    <Switch
                      id="include-bom"
                      checked={includeBom}
                      onCheckedChange={setIncludeBom}
                    />
                  </div>
                </div>

                {/* Transaction table */}
                <TransactionTable transactions={transactions} />
              </div>
            )}

            {/* Empty state */}
            {transactions.length === 0 && !isProcessing && (
              <div className="text-center py-16 space-y-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted/50">
                  <FileText className="w-8 h-8 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    No statements uploaded yet
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Upload your bank statement PDFs to extract transaction data. 
                    The app supports batch processing of multiple files.
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-border/50 backdrop-blur-md bg-background/30 mt-20">
          <div className="container mx-auto px-6 py-6">
            <p className="text-center text-sm text-muted-foreground">
              Supports Citizens Bank statement format. CSV output compatible with QuickBooks.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

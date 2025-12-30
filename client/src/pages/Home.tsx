import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import FileUpload from "@/components/FileUpload";
import TransactionTable from "@/components/TransactionTable";
import DebugPanel, { type IngestionDebugData } from "@/components/ingestion/DebugPanel";
import ResultPreviewModal from "@/components/ingestion/ResultPreviewModal";
import type { FileStatus } from "@/components/ingestion/StepFlow";
import {
  canonicalToDisplayTransaction,
  downloadCSV,
  extractTextFromPDF,
  legacyTransactionsToCanonical,
  parseStatementText,
  Transaction
} from "@/lib/pdfParser";
import { ingestWithDocumentAI, type IngestionSource } from "@/lib/ingestionClient";
import { parseBankStatementClient, type ParserSource } from "@/lib/clientParser";
import { toCSV } from "@shared/export/csv";
import type { CanonicalTransaction } from "@shared/transactions";
import type { DocumentAiTelemetry, IngestionFailure } from "@shared/types";
import { Download, Eye, FileText, Loader2, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AdminStatusPanel } from "@/components/AdminStatusPanel";
import { UserMenu } from "@/components/UserMenu";
import { useAuth } from "@/hooks/useAuth";

// Check if debug view is enabled via environment variable
// Supports both VITE_DEBUG_VIEW (Vite convention) and DEBUG_VIEW (as specified in requirements)
const DEBUG_VIEW = import.meta.env.VITE_DEBUG_VIEW === "true";

export default function Home() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [normalizedTransactions, setNormalizedTransactions] = useState<CanonicalTransaction[]>([]);
  const [ingestLog, setIngestLog] = useState<IngestionFailure[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedFiles, setProcessedFiles] = useState<string[]>([]);
  const [includeBom, setIncludeBom] = useState(true);
  const [fileStatuses, setFileStatuses] = useState<Record<string, FileStatus>>({});
  const [showDebug, setShowDebug] = useState(DEBUG_VIEW);
  const [ingestionSource, setIngestionSource] = useState<IngestionSource>("legacy");
  const [docAiTelemetry, setDocAiTelemetry] = useState<DocumentAiTelemetry | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | undefined>(undefined);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [exportId, setExportId] = useState<string | undefined>();
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  
  // Cache files for retry functionality
  const fileCache = useRef<Map<string, File>>(new Map());
  const hasHydratedFromStorageRef = useRef(false);
  const hasHydratedIngestLogRef = useRef(false);

  useEffect(() => {
    // Hydrate once on initial load. Do NOT re-hydrate when state is cleared (e.g. Retry).
    if (hasHydratedFromStorageRef.current) return;
    if (normalizedTransactions.length !== 0) return;
    const saved = localStorage.getItem("normalizedTransactions");
    hasHydratedFromStorageRef.current = true;
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as CanonicalTransaction[];
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      setNormalizedTransactions(parsed);
      setTransactions(parsed.map(canonicalToDisplayTransaction));
    } catch (error) {
      console.warn("Failed to hydrate normalized transactions from localStorage", error);
    }
  }, [normalizedTransactions.length]);

  useEffect(() => {
    // Hydrate ingest log once on initial load
    if (hasHydratedIngestLogRef.current) return;
    hasHydratedIngestLogRef.current = true;
    const saved = localStorage.getItem("ingestLog");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as IngestionFailure[];
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      setIngestLog(parsed);
    } catch (error) {
      console.warn("Failed to hydrate ingest log from localStorage", error);
    }
  }, []);

  // Helper function to update file status
  const setStatus = (fileName: string, phase: FileStatus["phase"], message: string, source: FileStatus["source"]) => {
    setFileStatuses(prev => ({
      ...prev,
      [fileName]: { phase, message, source },
    }));
  };

  const appendIngestFailure = (failure: IngestionFailure) => {
    setIngestLog(prev => {
      const next = [...prev, failure];
      localStorage.setItem("ingestLog", JSON.stringify(next));
      return next;
    });
  };

  const clearIngestLog = () => {
    localStorage.removeItem("ingestLog");
    setIngestLog([]);
  };

  const handleFilesSelected = async (files: File[]) => {
    setIsProcessing(true);
    // Start with existing transactions to accumulate across multiple uploads
    const allTransactions: Transaction[] = [...transactions];
    const allCanonical: CanonicalTransaction[] = [...normalizedTransactions];
    const fileNames: string[] = [...processedFiles];
    let latestSource: IngestionSource = ingestionSource;

    setDocAiTelemetry(null);
    setFallbackReason(undefined);

    // Cache files for retry
    files.forEach(file => {
      fileCache.current.set(file.name, file);
    });

    try {
      for (const file of files) {
        toast.info(`Processing ${file.name}...`);
        setStatus(file.name, "upload", "File received", "documentai");

        try {
          // NEW FLOW: Parse client-side first using custom parsers
          setStatus(file.name, "extraction", "Extracting text and detecting bank...", "legacy");
          
          const parseResult = await parseBankStatementClient(file, "bank_statement");
          
          // Map parser source to ingestion source for compatibility
          if (parseResult.source === "custom") {
            latestSource = "legacy"; // Custom parser uses legacy format
          } else if (parseResult.source === "documentai") {
            latestSource = "documentai";
          } else {
            latestSource = "error";
          }
          
          setDocAiTelemetry(parseResult.docAiTelemetry ?? null);
          
          if (parseResult.source === "error") {
            const message = parseResult.error ?? "Invalid upload";
            toast.error(message);
            setStatus(file.name, "error", message, "error");
            appendIngestFailure({
              phase: "unknown",
              message,
              ts: Date.now(),
              hint: `file=${file.name}, bank=${parseResult.bankType}`,
            });
            continue;
          }

          if (parseResult.document && parseResult.document.transactions.length > 0) {
            const canonical = parseResult.document.transactions;
            const isCustomParser = parseResult.source === "custom";
            const statusSource: FileStatus["source"] = isCustomParser ? "legacy" : "documentai";
            
            const parserName = isCustomParser 
              ? `${parseResult.bankType} parser`
              : "Document AI";

            setStatus(
              file.name,
              "extraction",
              isCustomParser 
                ? `Custom ${parseResult.bankType} parser extraction complete`
                : "Document AI extraction complete",
              statusSource
            );

            allCanonical.push(...canonical);
            allTransactions.push(...canonical.map(canonicalToDisplayTransaction));
            fileNames.push(file.name);

            // Store export ID if available (from Document AI fallback)
            if (parseResult.exportId) {
              setExportId(parseResult.exportId);
            }

            setStatus(
              file.name,
              "normalization",
              isCustomParser ? "Normalized to canonical schema" : "Normalized to canonical schema",
              statusSource
            );
            setStatus(file.name, "export", "Ready for export", statusSource);

            toast.success(
              `${parserName} extracted ${canonical.length} transactions from ${file.name}`
            );
            continue;
          }

          // No transactions found - try Document AI fallback if not already tried
          if (parseResult.source !== "documentai") {
            setStatus(file.name, "extraction", "Custom parser found 0 transactions, trying Document AI...", "documentai");
            
            const docAIResult = await ingestWithDocumentAI(file, "bank_statement");
            latestSource = docAIResult.source;
            setDocAiTelemetry(docAIResult.docAiTelemetry ?? null);
            
            if (docAIResult.document && docAIResult.document.transactions.length > 0) {
              const canonical = docAIResult.document.transactions;
              allCanonical.push(...canonical);
              allTransactions.push(...canonical.map(canonicalToDisplayTransaction));
              fileNames.push(file.name);
              
              if (docAIResult.exportId) {
                setExportId(docAIResult.exportId);
              }
              
              setStatus(file.name, "extraction", "Document AI extraction complete", "documentai");
              setStatus(file.name, "normalization", "Normalized to canonical schema", "documentai");
              setStatus(file.name, "export", "Ready for export", "documentai");
              
              toast.success(`Document AI extracted ${canonical.length} transactions from ${file.name}`);
              continue;
            }
          }
          
          // Still no transactions
          toast.warning(`No transactions found in ${file.name}`);
          setStatus(file.name, "extraction", "No transactions found", "error");
          continue;
        } catch (error) {
          console.error(`Error processing ${file.name}:`, error);
          toast.error(`Failed to process ${file.name}`);
          setStatus(file.name, "error", "Failed to process file", "error");
          appendIngestFailure({
            phase: "unknown",
            message: error instanceof Error ? error.message : "Failed to process file",
            ts: Date.now(),
            hint: `file=${file.name}`,
          });
        }
      }

      setTransactions(allTransactions);
      setNormalizedTransactions(allCanonical);
      if (allCanonical.length > 0) {
        localStorage.setItem("normalizedTransactions", JSON.stringify(allCanonical));
      }
      setProcessedFiles(fileNames);
      setIngestionSource(latestSource);
      
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

  const handleRetry = () => {
    // Reset all state and clear cache
    localStorage.removeItem("normalizedTransactions");
    setTransactions([]);
    setNormalizedTransactions([]);
    setProcessedFiles([]);
    setFileStatuses({});
    setIngestionSource("legacy");
    setDocAiTelemetry(null);
    setFallbackReason(undefined);
    setExportId(undefined);
    fileCache.current.clear();
    toast.info("Pipeline reset. Please upload files again.");
  };

  const handleClearAll = () => {
    // Clear only transaction-related persisted state (do NOT wipe unrelated app prefs/auth cache)
    localStorage.removeItem("normalizedTransactions");
    localStorage.removeItem("ingestLog");
    setTransactions([]);
    setNormalizedTransactions([]);
    setProcessedFiles([]);
    setFileStatuses({});
    setIngestLog([]);
    setIngestionSource("legacy");
    setDocAiTelemetry(null);
    setFallbackReason(undefined);
    setExportId(undefined);
    fileCache.current.clear();
    toast.success("All data cleared. Ready for new batch.");
  };

  const handleExportCSV = async () => {
    if (!normalizedTransactions.length) {
      toast.warning("No transactions to export yet");
      return;
    }

    try {
      // Always use client-side export to include ALL accumulated transactions
      // Backend exportId only contains the last file's transactions, not all files
      const csv = toCSV(normalizedTransactions, { includeBOM: includeBom });
      if (!csv || csv.trim().length === 0) {
        toast.error("Nothing to export");
        return;
      }

      const timestamp = new Date().toISOString().split("T")[0];
      downloadCSV(csv, `bank-transactions-${timestamp}.csv`);
      toast.success(`CSV exported successfully (${normalizedTransactions.length} transactions)`);
    } catch (error) {
      console.error("Error exporting CSV", error);
      toast.error("Nothing to export");
    }
  };

  const handleExportPDF = async () => {
    if (normalizedTransactions.length === 0) {
      toast.error('No transactions to export');
      return;
    }

    try {
      // Send all accumulated transactions to backend for PDF generation
      const response = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ transactions: normalizedTransactions }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to generate PDF');
      }

      // Get PDF blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().split("T")[0];
      a.download = `bank-transactions-${timestamp}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast.success(`PDF exported successfully (${normalizedTransactions.length} transactions)`);
    } catch (error) {
      console.error("Error exporting PDF", error);
      toast.error(error instanceof Error ? error.message : 'Failed to export PDF');
    }
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
            <div className="flex items-center justify-between gap-3">
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
              <div className="flex items-center gap-2">
                {normalizedTransactions.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearAll}
                    className="text-red-600 hover:text-red-800 hover:bg-red-50"
                  >
                    Clear All
                  </Button>
                )}
                {user && <UserMenu user={user} />}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAdminPanel(!showAdminPanel)}
                  title="Deployment Status"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="container mx-auto px-6 py-12">
          <div className="max-w-5xl mx-auto space-y-8">
            {/* Upload section */}
            <div className="space-y-4">
              {normalizedTransactions.length === 0 && (
                <div className="text-center">
                  <div className="mx-auto max-w-2xl rounded-xl border border-border/50 bg-background/30 backdrop-blur-md px-6 py-5">
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground">Upload a bank statement PDF.</span>
                      <br />
                      The app will extract transactions, normalize them, and prepare them for CSV/PDF export.
                      <br />
                      If DoCAI is available, the AI-powered mode will activate automatically.
                    </p>
                  </div>
                </div>
              )}

              <FileUpload
                onFilesSelected={handleFilesSelected}
                isLoading={isProcessing}
                hasTransactions={normalizedTransactions.length > 0}
              />

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

              {Object.keys(fileStatuses).length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border/60 bg-card/60 p-3 text-sm">
                    <div className="text-xs text-muted-foreground">Document AI path</div>
                    <div className="text-lg font-semibold text-foreground">
                      {Object.values(fileStatuses).filter(s => s.source === "documentai").length} file(s)
                    </div>
                    <p className="text-xs text-muted-foreground">Requires ENABLE_DOC_AI and valid credentials.</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card/60 p-3 text-sm">
                    <div className="text-xs text-muted-foreground">Legacy fallback</div>
                    <div className="text-lg font-semibold text-foreground">
                      {Object.values(fileStatuses).filter(s => s.source === "legacy").length} file(s)
                    </div>
                    <p className="text-xs text-muted-foreground">Used when Document AI is unavailable or errors.</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card/60 p-3 text-sm">
                    <div className="text-xs text-muted-foreground">Normalization ready</div>
                    <div className="text-lg font-semibold text-foreground">{normalizedTransactions.length} transaction(s)</div>
                    <p className="text-xs text-muted-foreground">Ready to export to CSV once processing finishes.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Debug Panel */}
            {showDebug && (normalizedTransactions.length > 0 || ingestLog.length > 0) && (
              <DebugPanel
                ingestionData={{
                  source: ingestionSource,
                  normalizedTransactions,
                  docAiTelemetry: docAiTelemetry ?? undefined,
                  fallbackReason,
                }}
                ingestLog={ingestLog}
                onClearIngestLog={() => {
                  clearIngestLog();
                  toast.info("Ingestion log cleared.");
                }}
                onRetry={handleRetry}
                onClearStoredData={handleRetry}
              />
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

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setShowPreviewModal(true)}
                        className="gap-2"
                        disabled={normalizedTransactions.length === 0}
                      >
                        <Eye className="w-4 h-4" />
                        Preview Parse Results
                      </Button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex relative">
                            {normalizedTransactions.length === 0 && (
                              <button
                                type="button"
                                className="absolute inset-0 cursor-not-allowed"
                                onClick={() => toast.warning("No transactions to export yet")}
                                aria-label="No transactions to export yet"
                              />
                            )}
                            <Button
                              onClick={handleExportCSV}
                              className="gap-2 shadow-lg hover:shadow-xl transition-shadow"
                              disabled={normalizedTransactions.length === 0}
                            >
                              <Download className="w-4 h-4" />
                              Export to CSV
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Export normalized transactions as CSV</TooltipContent>
                      </Tooltip>
                      <Button
                        onClick={handleExportPDF}
                        variant="outline"
                        className="gap-2"
                        disabled={normalizedTransactions.length === 0 || !exportId}
                        title={!exportId ? "PDF export requires backend processing" : undefined}
                      >
                        <Download className="w-4 h-4" />
                        Export to PDF
                      </Button>
                    </div>
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

      {/* Result Preview Modal */}
      <ResultPreviewModal
        open={showPreviewModal}
        onOpenChange={setShowPreviewModal}
        transactions={normalizedTransactions}
        exportId={exportId}
        source={ingestionSource}
        processedFiles={processedFiles}
      />

      {/* Admin Status Panel */}
      {showAdminPanel && (
        <div className="fixed bottom-4 right-4 z-50">
          <AdminStatusPanel />
        </div>
      )}
    </div>
  );
}

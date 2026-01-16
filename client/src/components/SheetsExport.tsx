import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import type { NormalizedTransaction } from "@shared/types";
import { toast } from "sonner";
import { Sheet, Loader2 } from "lucide-react";

interface SheetsExportProps {
  transactions: NormalizedTransaction[];
  disabled?: boolean;
}

export default function SheetsExport({ transactions, disabled }: SheetsExportProps) {
  const { user, isAuthenticated, login } = useAuth();
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (!spreadsheetId.trim()) {
      toast.error("Please enter a Google Sheets ID");
      return;
    }

    if (transactions.length === 0) {
      toast.error("No transactions to export");
      return;
    }

    setIsExporting(true);
    try {
      const response = await fetch("/api/export/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: spreadsheetId.trim(),
          transactions,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Export failed");
      }

      const result = await response.json();
      toast.success(`Exported ${result.count} transactions to Google Sheets`);
    } catch (error) {
      console.error("Export error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to export to Sheets");
    } finally {
      setIsExporting(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-muted/30">
        <Sheet className="w-5 h-5 text-muted-foreground" />
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">
            Sign in with Google to export to Sheets
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={login}>
          Sign In
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-card/50">
      <div className="flex items-center gap-2">
        <Sheet className="w-5 h-5 text-green-600" />
        <span className="text-sm font-medium">Export to Google Sheets</span>
      </div>

      <div className="flex items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="spreadsheet-id" className="text-xs text-muted-foreground">
            Spreadsheet ID (from URL)
          </Label>
          <Input
            id="spreadsheet-id"
            placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
            value={spreadsheetId}
            onChange={(e) => setSpreadsheetId(e.target.value)}
            className="font-mono text-xs"
          />
        </div>

        <Button
          onClick={handleExport}
          disabled={disabled || isExporting || !spreadsheetId.trim()}
          className="gap-2"
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Sheet className="w-4 h-4" />
              Export to Sheets
            </>
          )}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Signed in as {user?.email || user?.name || "User"}
      </p>
    </div>
  );
}

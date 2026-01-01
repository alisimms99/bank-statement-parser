import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import type { CanonicalTransaction } from "@shared/transactions";
import {
  CheckCircle2,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface SheetsExportProps {
  transactions: CanonicalTransaction[];
}

interface SelectedFolder {
  id: string;
  name: string;
}

type ExportState = "idle" | "selecting" | "exporting" | "success" | "error";

export default function SheetsExport({ transactions }: SheetsExportProps) {
  const { user } = useAuth();
  const [selectedFolder, setSelectedFolder] = useState<SelectedFolder | null>(
    null,
  );
  const [sheetName, setSheetName] = useState<string>("");
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [exportedSheetUrl, setExportedSheetUrl] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [pickerApiLoaded, setPickerApiLoaded] = useState(false);
  const [pickerApiError, setPickerApiError] = useState<string | null>(null);

  useEffect(() => {
    // Set default sheet name based on current date
    const today = new Date().toISOString().split("T")[0];
    setSheetName(`Bank Transactions ${today}`);
  }, []);

  useEffect(() => {
    // Load the Google Picker API.
    //
    // Important: avoid an infinite retry loop if `gapi` never loads
    // (network issues, ad blocker, firewall), and ensure timers are cleaned up
    // so we don't keep running after unmount.
    let isMounted = true;
    let timeoutId: number | undefined;

    const startedAt = Date.now();
    const pollMs = 100;
    const maxWaitMs = 10_000;

    const tryLoadPickerApi = () => {
      if (!isMounted) return;

      if (typeof gapi !== "undefined") {
        try {
          gapi.load("picker", () => {
            if (!isMounted) return;
            setPickerApiLoaded(true);
          });
        } catch (err) {
          if (!isMounted) return;
          console.error("Failed to initialize Google Picker API:", err);
          setPickerApiError(
            "Failed to initialize Google Picker. Please disable blockers and retry.",
          );
        }
        return;
      }

      if (Date.now() - startedAt >= maxWaitMs) {
        setPickerApiError(
          "Google API failed to load. Check your network / ad blocker and refresh.",
        );
        return;
      }

      timeoutId = window.setTimeout(tryLoadPickerApi, pollMs);
    };

    tryLoadPickerApi();

    return () => {
      isMounted = false;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const handleOpenPicker = async () => {
    if (pickerApiError) {
      toast.error(pickerApiError);
      return;
    }

    if (!pickerApiLoaded) {
      toast.error(
        "Google Picker is still loading. Please try again in a moment.",
      );
      return;
    }

    if (!user) {
      toast.error("You must be logged in to select a folder.");
      return;
    }

    setExportState("selecting");

    try {
      // Get the access token from the session
      const response = await fetch("/api/auth/token", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to get access token. Please log in again.");
      }

      const { accessToken } = await response.json();

      // Create and show the picker
      const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true);

      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken)
        .setCallback(handlePickerCallback)
        .setTitle("Select a Google Drive Folder")
        .build();

      picker.setVisible(true);
    } catch (error) {
      console.error("Error opening picker:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to open folder picker",
      );
      setExportState("idle");
    }
  };

  const handlePickerCallback = (data: google.picker.ResponseObject) => {
    if (
      data.action === google.picker.Action.PICKED &&
      data.docs &&
      data.docs.length > 0
    ) {
      const folder = data.docs[0];
      setSelectedFolder({
        id: folder.id,
        name: folder.name,
      });
      setExportState("idle");
      toast.success(`Selected folder: ${folder.name}`);
    } else if (data.action === google.picker.Action.CANCEL) {
      setExportState("idle");
    }
  };

  const handleExport = async () => {
    if (!selectedFolder) {
      toast.error("Please select a folder first");
      return;
    }

    if (!sheetName.trim()) {
      toast.error("Please enter a sheet name");
      return;
    }

    if (transactions.length === 0) {
      toast.error("No transactions to export");
      return;
    }

    setExportState("exporting");
    setErrorMessage("");

    try {
      const response = await fetch("/api/export/sheets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          transactions,
          folderId: selectedFolder.id,
          sheetName: sheetName.trim(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to export to Google Sheets");
      }

      const result = await response.json();
      setExportedSheetUrl(result.sheetUrl);
      setExportState("success");
      toast.success("Successfully exported to Google Sheets!");
    } catch (error) {
      console.error("Error exporting to Sheets:", error);
      const message =
        error instanceof Error ? error.message : "Failed to export to Google Sheets";
      setErrorMessage(message);
      setExportState("error");
      toast.error(message);
    }
  };

  const handleReset = () => {
    setExportState("idle");
    setExportedSheetUrl("");
    setErrorMessage("");
  };

  if (!user) {
    return (
      <div className="rounded-xl border border-border/60 bg-card/50 p-6">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted/50">
            <FileSpreadsheet className="w-8 h-8 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Google Sheets Export
            </h3>
            <p className="text-sm text-muted-foreground">
              Sign in with Google to export transactions directly to Google
              Sheets
            </p>
          </div>
          <Button onClick={() => (window.location.href = "/api/auth/google")}>
            Sign in with Google
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <FileSpreadsheet className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Export to Google Sheets
          </h3>
          <p className="text-sm text-muted-foreground">
            Save transactions directly to your Google Drive
          </p>
        </div>
      </div>

      {/* Folder Selection */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Destination Folder
        </label>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleOpenPicker}
            disabled={
              exportState === "selecting" ||
              exportState === "exporting" ||
              !pickerApiLoaded
            }
            className="gap-2"
          >
            {exportState === "selecting" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FolderOpen className="w-4 h-4" />
            )}
            {selectedFolder ? "Change Folder" : "Select Folder"}
          </Button>
          {selectedFolder && (
            <div className="flex-1 flex items-center px-3 py-2 rounded-md border border-border bg-background/60">
              <span className="text-sm text-foreground truncate">
                {selectedFolder.name}
              </span>
            </div>
          )}
        </div>
        {pickerApiError ? (
          <p className="text-xs text-destructive">{pickerApiError}</p>
        ) : !selectedFolder ? (
          <p className="text-xs text-muted-foreground">
            Choose where to save the spreadsheet in your Google Drive
          </p>
        ) : null}
      </div>

      {/* Sheet Name Input */}
      <div className="space-y-2">
        <label
          htmlFor="sheet-name"
          className="text-sm font-medium text-foreground"
        >
          Sheet Name
        </label>
        <Input
          id="sheet-name"
          type="text"
          value={sheetName}
          onChange={(e) => setSheetName(e.target.value)}
          placeholder="Enter sheet name"
          disabled={exportState === "exporting"}
        />
        <p className="text-xs text-muted-foreground">
          A new Google Sheet will be created with this name
        </p>
      </div>

      {/* Export Button */}
      {(exportState === "idle" || exportState === "selecting") && (
        <Button
          onClick={handleExport}
          disabled={
            !selectedFolder ||
            !sheetName.trim() ||
            transactions.length === 0 ||
            exportState === "selecting"
          }
          className="w-full gap-2"
        >
          <FileSpreadsheet className="w-4 h-4" />
          Export {transactions.length} Transaction
          {transactions.length !== 1 ? "s" : ""} to Google Sheets
        </Button>
      )}

      {/* Loading State */}
      {exportState === "exporting" && (
        <div className="flex items-center justify-center gap-3 py-4 rounded-lg bg-primary/5 border border-primary/20">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span className="text-sm font-medium text-foreground">
            Creating Google Sheet...
          </span>
        </div>
      )}

      {/* Success State */}
      {exportState === "success" && exportedSheetUrl && (
        <div className="space-y-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            <span className="text-sm font-medium text-green-900 dark:text-green-100">
              Successfully exported to Google Sheets!
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(exportedSheetUrl, "_blank")}
              className="flex-1"
            >
              Open Sheet
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              Export Another
            </Button>
          </div>
        </div>
      )}

      {/* Error State */}
      {exportState === "error" && errorMessage && (
        <div className="space-y-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <div className="flex items-start gap-2">
            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
            <div className="flex-1">
              <span className="text-sm font-medium text-red-900 dark:text-red-100 block mb-1">
                Export Failed
              </span>
              <span className="text-xs text-red-700 dark:text-red-300">
                {errorMessage}
              </span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleReset}>
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}


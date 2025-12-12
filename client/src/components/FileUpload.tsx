import { Button } from "@/components/ui/button";
import { Loader2, Upload } from "lucide-react";
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;
const PDF_MIME_TYPE = 'application/pdf';

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  isLoading?: boolean;
  hasTransactions?: boolean;
}

export default function FileUpload({ 
  onFilesSelected, 
  accept = PDF_MIME_TYPE,
  multiple = true,
  isLoading = false,
  hasTransactions = false,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleValidatedFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      const validFiles: File[] = [];
      let shouldToastNonPdf = false;
      let shouldToastTooLarge = false;

      files.forEach(file => {
        const looksLikePdfByName = file.name.toLowerCase().endsWith('.pdf');
        const isPdf = file.type === PDF_MIME_TYPE || looksLikePdfByName;

        if (!isPdf) {
          shouldToastNonPdf = true;
          return;
        }

        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
          shouldToastTooLarge = true;
          return;
        }

        validFiles.push(file);
      });

      if (shouldToastNonPdf) {
        toast.error("Only PDFs allowed");
      }
      if (shouldToastTooLarge) {
        toast.error("File exceeds maximum size (25MB)");
      }

      if (validFiles.length > 0) {
        onFilesSelected(validFiles);
      }
    },
    [onFilesSelected]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    // Drag-and-drop can still fire while the input is disabled; ignore drops while loading
    // to prevent concurrent uploads/processing and related race conditions.
    if (isLoading) {
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    handleValidatedFiles(files);
  }, [handleValidatedFiles, isLoading]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleValidatedFiles(Array.from(files));
    }
  }, [handleValidatedFiles]);

  // Once the user has transactions, we switch to a compact "upload more" control
  // so the big onboarding dropzone disappears (per Issue #18).
  if (hasTransactions) {
    return (
      <div className="flex items-center justify-center">
        <div className="relative">
          <input
            type="file"
            accept={accept}
            multiple={multiple}
            onChange={handleFileInput}
            disabled={isLoading}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            aria-label="Upload additional PDF statements"
          />
          <Button variant="outline" className="gap-2" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isLoading ? "Processing…" : "Upload more PDFs"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative overflow-hidden
        border-2 border-dashed rounded-xl
        transition-all duration-300 ease-out
        ${isLoading ? "animate-pulse" : ""}
        ${isDragging 
          ? 'border-primary bg-primary/5 scale-[1.02]' 
          : isLoading
            ? 'border-border bg-gray-100 hover:bg-gray-200/80'
            : 'border-border bg-gray-100 hover:bg-gray-200/80 hover:border-border/80'
        }
        backdrop-blur-sm
        ${isLoading ? "cursor-not-allowed" : "cursor-pointer"}
        group
      `}
      style={{
        boxShadow: isDragging 
          ? '0 20px 60px -10px rgba(59, 130, 246, 0.3)' 
          : '0 10px 40px -10px rgba(0, 0, 0, 0.08)'
      }}
    >
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleFileInput}
        disabled={isLoading}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
      />
      
      <div className="relative z-0 px-8 py-16 text-center">
        <div className={`
          inline-flex items-center justify-center
          w-20 h-20 rounded-full mb-6
          transition-all duration-300
          ${isLoading
            ? "bg-muted/40"
            : isDragging 
              ? 'bg-primary/20 scale-110' 
              : 'bg-primary/10 group-hover:bg-primary/15 group-hover:scale-105'
          }
        `}>
          {isLoading ? (
            <Loader2 className="w-10 h-10 text-muted-foreground animate-spin" />
          ) : (
            <Upload className={`
              w-10 h-10 transition-colors
              ${isDragging ? 'text-primary' : 'text-primary/70 group-hover:text-primary'}
            `} />
          )}
        </div>
        
        <h3 className="text-xl font-semibold text-foreground mb-2">
          {isLoading ? "Processing PDF files…" : isDragging ? 'Drop files here' : 'Upload Bank Statements'}
        </h3>
        
        <p className="text-sm text-muted-foreground mb-4">
          {isLoading ? "Hang tight — extracting and normalizing transactions." : "Drag and drop PDF files here, or click to browse"}
        </p>
        
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <div className={`w-2 h-2 rounded-full ${isLoading ? "bg-muted-foreground/60" : "bg-primary/50"}`} />
          <span>{isLoading ? "This may take a few seconds" : "Supports multiple PDF files"}</span>
        </div>
      </div>

      {/* Glassmorphism effect overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
    </div>
  );
}

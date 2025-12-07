import { Upload } from 'lucide-react';
import { useCallback, useState } from 'react';

const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
}

export default function FileUpload({ 
  onFilesSelected, 
  accept = '.pdf',
  multiple = true 
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleValidatedFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      const validFiles: File[] = [];
      const errors: string[] = [];

      files.forEach(file => {
        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
          errors.push(`${file.name} exceeds the 25MB upload limit.`);
          return;
        }

        const isPdfMime = file.type === 'application/pdf';
        const isPdfExtension = file.name.toLowerCase().endsWith('.pdf');

        if (!isPdfMime && !isPdfExtension) {
          errors.push(`${file.name} is not a PDF file.`);
          return;
        }

        validFiles.push(file);
      });

      if (validFiles.length > 0) {
        onFilesSelected(validFiles);
      }

      setErrorMessage(errors.length > 0 ? errors.join(' ') : null);
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
    
    const files = Array.from(e.dataTransfer.files);
    handleValidatedFiles(files);
  }, [handleValidatedFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleValidatedFiles(Array.from(files));
    }
  }, [handleValidatedFiles]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative overflow-hidden
        border-2 border-dashed rounded-xl
        transition-all duration-300 ease-out
        ${isDragging 
          ? 'border-primary bg-primary/5 scale-[1.02]' 
          : 'border-border bg-card/50 hover:border-primary/50 hover:bg-card/70'
        }
        backdrop-blur-md
        cursor-pointer
        group
      `}
      style={{
        boxShadow: isDragging 
          ? '0 20px 60px -10px rgba(59, 130, 246, 0.3)' 
          : '0 10px 40px -10px rgba(0, 0, 0, 0.1)'
      }}
    >
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
      />
      
      <div className="relative z-0 px-8 py-16 text-center">
        <div className={`
          inline-flex items-center justify-center
          w-20 h-20 rounded-full mb-6
          transition-all duration-300
          ${isDragging 
            ? 'bg-primary/20 scale-110' 
            : 'bg-primary/10 group-hover:bg-primary/15 group-hover:scale-105'
          }
        `}>
          <Upload className={`
            w-10 h-10 transition-colors
            ${isDragging ? 'text-primary' : 'text-primary/70 group-hover:text-primary'}
          `} />
        </div>
        
        <h3 className="text-xl font-semibold text-foreground mb-2">
          {isDragging ? 'Drop files here' : 'Upload Bank Statements'}
        </h3>
        
        <p className="text-sm text-muted-foreground mb-4">
          Drag and drop PDF files here, or click to browse
        </p>
        
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-primary/50" />
          <span>Supports multiple PDF files</span>
        </div>
      </div>
      
      {errorMessage && (
        <p
          role="alert"
          aria-live="polite"
          className="text-xs text-destructive px-6 pb-3 pt-1"
        >
          {errorMessage}
        </p>
      )}

      {/* Glassmorphism effect overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
    </div>
  );
}

# API Documentation

## Ingestion Endpoints

### Single PDF Ingestion

**POST** `/api/ingest`

Upload and process a single PDF document (bank statement, invoice, or receipt).

#### Request

**Multipart Form Data:**
- `file` (required): PDF file to process
- `documentType` (optional): Document type, one of `bank_statement`, `invoice`, or `receipt` (default: `bank_statement`)

**JSON Request:**
```json
{
  "fileName": "statement.pdf",
  "contentBase64": "JVBERi0xLjQK...",
  "documentType": "bank_statement"
}
```

#### Response

**Success (200):**
```json
{
  "source": "documentai" | "legacy",
  "document": {
    "documentType": "bank_statement",
    "transactions": [
      {
        "date": "2024-01-15",
        "description": "Payment received",
        "debit": 0,
        "credit": 150.00,
        "balance": 1500.00,
        "statement_period": {
          "start": "2024-01-01",
          "end": "2024-01-31"
        }
      }
    ],
    "warnings": []
  },
  "exportId": "uuid-string",
  "docAiTelemetry": {
    "enabled": true,
    "processor": "processor-id",
    "latencyMs": 150,
    "entityCount": 10
  }
}
```

**Error (400/500):**
```json
{
  "error": "Error message",
  "source": "error",
  "failure": {
    "phase": "upload" | "docai" | "normalize" | "unknown",
    "message": "Detailed error message",
    "ts": 1234567890,
    "hint": "Additional context"
  }
}
```

#### Limits
- Maximum file size: 25MB
- Supported format: PDF only

---

### Bulk PDF Ingestion

**POST** `/api/ingest/bulk`

Upload and process multiple PDF documents at once (12-60 files). Useful for uploading several months of bank statements in one request.

#### Request

**Multipart Form Data:**
- `files` (required): Array of PDF files to process (min: 12, max: 60)
- `documentType` (optional): Document type for all files, one of `bank_statement`, `invoice`, or `receipt` (default: `bank_statement`)

#### Response

**Success (200):**
```json
{
  "success": true,
  "results": [
    {
      "month": "01",
      "year": "2024",
      "exportId": "uuid-1",
      "transactions": [...],
      "fileName": "statement-jan.pdf",
      "success": true
    },
    {
      "month": "02",
      "year": "2024",
      "exportId": "uuid-2",
      "transactions": [...],
      "fileName": "statement-feb.pdf",
      "success": true
    }
  ],
  "summary": {
    "total": 12,
    "successful": 12,
    "failed": 0,
    "durationMs": 5432
  }
}
```

**Error (400):**
```json
{
  "error": "Insufficient files",
  "message": "Bulk ingestion requires at least 12 files"
}
```

**Error (429):**
```json
{
  "error": "Rate limit exceeded",
  "message": "Server is currently processing other bulk uploads. Please try again in a moment."
}
```

#### Rate Limiting
- Maximum 5 concurrent bulk ingestion requests
- Files are processed in batches of 5 to prevent memory issues
- Export IDs are isolated per statement

#### Limits
- Minimum files: 12
- Maximum files: 60
- Maximum file size per file: 25MB
- Supported format: PDF only

---

## Export Endpoints

### CSV Export

**GET** `/api/export/:id/csv`

Download processed transactions as a CSV file.

#### Parameters
- `id` (path): Export ID returned from ingestion endpoint
- `bom` (query, optional): Include UTF-8 BOM for Excel compatibility (`true` or `1`)

#### Response

**Success (200):**
Returns a CSV file with headers and transaction data.

**Error (404):**
```json
{
  "error": "Export not found",
  "message": "The requested export is not available."
}
```

**Error (410):**
```json
{
  "error": "Export expired",
  "message": "The requested export has expired. Please regenerate the export."
}
```

#### Notes
- Export data expires after 1 hour
- CSV format is compatible with QuickBooks

---

### PDF Export

**GET** `/api/export/:id/pdf`

Download processed transactions as a PDF file.

#### Parameters
- `id` (path): Export ID returned from ingestion endpoint

#### Response

**Success (200):**
Returns a PDF file with transaction data.

**Error (404):**
```json
{
  "error": "Export not found",
  "message": "The requested export is not available."
}
```

**Error (410):**
```json
{
  "error": "Export expired",
  "message": "The requested export has expired. Please regenerate the export."
}
```

#### Notes
- Export data expires after 1 hour
- PDF generation is currently a stub implementation

---

## Health Check

**GET** `/api/health`

Check the health status of the API.

#### Response

**Success (200):**
```json
{
  "ok": true,
  "ts": "2024-01-15T10:30:00.000Z"
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid input or parameters |
| 404 | Not Found - Resource does not exist |
| 410 | Gone - Resource has expired |
| 413 | Payload Too Large - File size exceeds limit |
| 415 | Unsupported Media Type - Invalid file format |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error - Processing failed |

---

## Example Usage

### Single File Upload (cURL)

```bash
curl -X POST http://localhost:3000/api/ingest \
  -F "file=@statement.pdf" \
  -F "documentType=bank_statement"
```

### Bulk Upload (cURL)

```bash
curl -X POST http://localhost:3000/api/ingest/bulk \
  -F "files=@statement-jan.pdf" \
  -F "files=@statement-feb.pdf" \
  -F "files=@statement-mar.pdf" \
  -F "files=@statement-apr.pdf" \
  -F "files=@statement-may.pdf" \
  -F "files=@statement-jun.pdf" \
  -F "files=@statement-jul.pdf" \
  -F "files=@statement-aug.pdf" \
  -F "files=@statement-sep.pdf" \
  -F "files=@statement-oct.pdf" \
  -F "files=@statement-nov.pdf" \
  -F "files=@statement-dec.pdf" \
  -F "documentType=bank_statement"
```

### Export CSV (cURL)

```bash
curl -X GET "http://localhost:3000/api/export/{export-id}/csv?bom=true" \
  -o transactions.csv
```

### JavaScript Example

```javascript
// Single file upload
const formData = new FormData();
formData.append('file', pdfFile);
formData.append('documentType', 'bank_statement');

const response = await fetch('/api/ingest', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log('Export ID:', result.exportId);

// Bulk upload
const bulkFormData = new FormData();
pdfFiles.forEach(file => {
  bulkFormData.append('files', file);
});
bulkFormData.append('documentType', 'bank_statement');

const bulkResponse = await fetch('/api/ingest/bulk', {
  method: 'POST',
  body: bulkFormData
});

const bulkResult = await bulkResponse.json();
console.log('Processed:', bulkResult.summary.successful, 'files');

// Download CSV
const exportId = result.exportId;
window.location.href = `/api/export/${exportId}/csv?bom=true`;
```

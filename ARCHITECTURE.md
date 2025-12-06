# Universal Ingestion Architecture Proposal

This document captures the proposed architecture shift to a Document AI–first ingestion pipeline with a canonical normalization layer and QuickBooks-ready export path.

## High-Level Flow
1. **Upload**: Client streams PDFs/images to the server via `/api/ingest`.
2. **Document AI**: Server routes to Google Cloud Document AI processors:
   - Bank statements (structured transactions)
   - Invoices (line items and totals)
   - OCR fallback (generic text extraction)
3. **Normalization**: All outputs map into a shared canonical transaction schema that captures direction, amount, currency, dates, payee/payor, and source metadata.
4. **Fallback**: When Document AI is unavailable or returns no transactions, the client performs legacy PDF.js + Citizens parser extraction and then normalizes into the same schema.
5. **Export**: CSV exporter operates on canonical transactions, emitting QuickBooks-safe numeric amounts and optional UTF-8 BOM.

## Components
- **Config layer**: Env-driven configuration for `GCP_PROJECT_ID`, `GCP_LOCATION`, processor IDs per document type, and credentials JSON/base64. Safe defaults disable Document AI while preserving the legacy path.
- **Server ingestion service**: Thin Express/TRPC handler that accepts base64 documents, calls Document AI, and normalizes results.
- **Normalization library (shared)**: Type-safe mapping utilities for Document AI entities and legacy Citizens parsing into `CanonicalTransaction` objects.
- **Client ingestion orchestrator**: Attempts server-side Document AI first; on failure, falls back to legacy parsing and normalization locally. Surfaces per-file status and combines batch results.
- **Export layer**: CSV/QuickBooks exporter that accepts canonical transactions, applies signed numeric amounts, and includes a BOM toggle for spreadsheet compatibility.

## Testing Strategy
- Unit tests for normalization mappers across: dual-column bank layouts, credit-card style debits/credits, invoice line items, and OCR-only outputs.
- Snapshot/fixture coverage for CSV exports from canonical data (with and without BOM).
- Integration smoke tests for the ingestion endpoint to assert Document AI disabled-path behavior when credentials are missing.

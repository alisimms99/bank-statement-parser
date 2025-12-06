# Development Roadmap

## Current Assessment (Universal Ingestion)
- The existing pipeline is optimized for Citizens Bank PDFs and runs entirely in the client.
- There is no support for Google Cloud Document AI, invoice parsing, or OCR fallbacks.
- CSV export exists but assumes legacy string amounts instead of normalized values.
- Environment/config management for processor IDs and credentials is absent.
- Batch UX and deployment workflows remain minimal.

## Target Architecture
- **Document AI–first ingestion**: Server-side Document AI processors for bank statements, invoices, and OCR fallback; client falls back to legacy parsing when processors are unavailable.
- **Canonical normalization layer**: Shared schemas and mappers to normalize amounts, directions, dates, and parties across banks/cards before export.
- **Pluggable exporters**: CSV/QuickBooks exports that operate on normalized records with BOM toggle and spreadsheet-safe formatting.
- **Configurable environment**: Processor IDs, project/location, and credentials provided via env vars with safe defaults and validation.
- **Observability & UX**: Per-file status, clear loading/error states, and structured logs for ingestion failures.

## Prioritized Milestones
1. **Document AI integration**
   - Add server-side connectors for bank statement, invoice, and OCR processors.
   - Provide env-driven configuration and graceful fallback when credentials are missing.
2. **Canonical normalization**
   - Define shared transaction/document schemas and normalize outputs from Document AI and legacy parsers.
   - Extend CSV exporter to operate on normalized data for QuickBooks.
3. **Pipeline routing & UI**
   - Route ingestion through Document AI first, with Citizens/legacy parsing as a secondary path.
   - Surface per-file status, batch progress, and retriable errors in the UI.
4. **Testing matrix**
   - Add fixtures for multiple banks/cards and verify normalization + CSV output across cases.
   - Add smoke tests for BOM inclusion and schema validation.
5. **Deployment & CI**
   - Add Vercel/Fly workflow, env templates, and CI checks for lint/test/build.
6. **Documentation & onboarding**
   - Update README with Document AI setup, env var examples, and QuickBooks export guidance.

## First Task (Completed in this iteration)
- Normalize CSV amounts for QuickBooks compatibility (numeric values, correct debit/credit signs) and add unit coverage for escaping and formatting.

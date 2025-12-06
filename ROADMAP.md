# Development Roadmap

## Current Assessment
- PDF upload, parsing, and CSV export are wired up end-to-end, but parsing logic is tailored to a single Citizens Bank layout.
- UI provides the core flow (upload → parse → table → CSV), with minimal error/loading feedback beyond toast notifications.
- Batch mode processes multiple files sequentially without shared normalization or per-file error surfacing.
- Deployment, environment configuration, and developer onboarding documentation are missing.

## Prioritized Milestones
1. **Parsing robustness**
   - Add bank-aware parsing strategies and shared normalization rules (date formats, amount signs, payee cleanup).
   - Guard against malformed PDFs and partial parses with clear UI + log messages.
2. **CSV export validation**
   - Conform CSV output to QuickBooks/Sheets requirements (plain numeric amounts, proper quoting, UTF-8 BOM optional toggle).
   - Add automated tests for CSV formatting and escaping.
3. **Batch processing & UX polish**
   - Surface per-file success/failure, with retry/remove controls.
   - Provide inline loaders/placeholders in the table and disable actions during work.
4. **Server/trpc hardening**
   - Finish TRPC endpoints for server-side parsing when client JS/worker fails.
   - Add schema validation (zod) and input size limits.
5. **Deployment & CI**
   - Add Vercel/Fly workflow, env var templates, and basic smoke tests (pnpm test/check).
6. **Documentation**
   - Expand README with setup, development commands, and bank-format notes.

## First Task (Completed in this iteration)
- Normalize CSV amounts for QuickBooks compatibility (numeric values, correct debit/credit signs) and add unit coverage for escaping and formatting.

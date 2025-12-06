# Testing Document AI ingestion locally

This project supports a Document AI–first ingestion path with a legacy fallback. Use this guide to configure your environment and run live PDF uploads during development.

## 1) Configure environment

Create a `.env.local` (or export environment variables) with the following variables:

```
ENABLE_DOC_AI=false
GCP_PROJECT_ID=your-project-id
GCP_LOCATION=us
DOC_AI_BANK_PROCESSOR_ID=processor-id
DOC_AI_INVOICE_PROCESSOR_ID=processor-id
DOC_AI_OCR_PROCESSOR_ID=processor-id
DOC_AI_FORM_PROCESSOR_ID=processor-id
# Provide either the JSON contents or a file path (do not commit this file)
GCP_SERVICE_ACCOUNT_JSON=base64-or-plain-json
GCP_SERVICE_ACCOUNT_PATH=/absolute/path/to/service-account.json
```

Notes:
- Set `ENABLE_DOC_AI=true` only when credentials and processor IDs are present.
- You can pass `GCP_SERVICE_ACCOUNT_JSON` as raw JSON or base64; `GCP_SERVICE_ACCOUNT_PATH` will be read from disk if provided.
- Missing or invalid credentials automatically fall back to the legacy Citizens parser.

## 2) Start the app

Install dependencies and start the dev server:

```
pnpm install
pnpm dev
```

The frontend will attempt Document AI first. If disabled or misconfigured, it will display that the legacy parser handled the file.

## 3) Upload real PDFs

1. Open the app in your browser (default: http://localhost:5173).
2. Drag-and-drop or browse to select local PDF statements/invoices.
3. Watch the ingestion stepper for the active phase and source (Document AI vs Legacy).
4. When normalization completes, use the CSV export button to download QuickBooks-friendly output.

## 4) Observe fallback behavior

- If Document AI is disabled or errors, the UI will show a fallback badge and the server will process the document with the legacy parser.
- Retry any failed file directly from the ingestion stepper once configuration is fixed.

## 5) Logging and troubleshooting

- Server logs surface Document AI mode (online vs batched) and mask credential details.
- Confirm processor IDs and service accounts in Google Cloud Console if requests fail.
- Ensure PDFs stay under ~25 MB to fit the current upload limits.

## 6) Debug panel

- Set `VITE_INGESTION_DEBUG=true` in `.env.local` to show the in-app developer debug panel.
- The panel reveals raw normalized transaction payloads and ingestion metadata; use it while testing PDFs.
- Toggle the panel on/off from the UI action bar without restarting the dev server.

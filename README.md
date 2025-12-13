# Bank Statement Parser

This application automates the extraction of transaction data from bank statements and other financial documents. It uses Google Cloud Document AI for intelligent parsing and normalizes the extracted data into a consistent, canonical format, ready for export to accounting software like QuickBooks.

## Features

- **Intelligent Document Processing**: Leverages Google Cloud Document AI to parse various financial documents, including bank statements, invoices, and receipts.
- **Legacy Fallback**: Includes a robust client-side PDF parser as a fallback for when Document AI is unavailable or disabled.
- **Canonical Data Model**: Normalizes extracted data into a consistent `CanonicalTransaction` schema, ensuring data uniformity regardless of the source.
- **QuickBooks-Ready Export**: Exports normalized transactions to a CSV format compatible with QuickBooks, including options for UTF-8 BOM for spreadsheet compatibility.
- **Developer-Friendly**: Provides a streamlined setup and a debug panel for inspecting raw transaction data and ingestion metadata.

## Setup and Installation

Follow these steps to get the application running locally for development.

### 1. Clone the Repository

```bash
gh repo clone alisimms99/bank-statement-parser
cd bank-statement-parser
```

### 2. Install Dependencies

This project uses `pnpm` for package management. Install it if you haven't already, then install the project dependencies.

```bash
pnpm install
```

### 3. Configure Environment Variables

Create a `.env.local` file in the root of the project by copying the example file:

```bash
cp .env.example .env.local
```

Update `.env.local` with your Google Cloud project details. To enable Document AI, set `ENABLE_DOC_AI=true` and provide your service account credentials.

**Google Cloud Credentials**

You can provide your Google Cloud service account credentials in one of two ways:

- **`GCP_SERVICE_ACCOUNT_JSON`**: Paste the raw JSON content of your service account key directly into the `.env.local` file.
- **`GCP_SERVICE_ACCOUNT_PATH`**: Provide the absolute path to your service account JSON file.

> **Note**: Do not commit your `.env.local` file or your service account key to version control.

### 4. Start the Development Server

Once your environment is configured, start the development server:

```bash
pnpm dev
```

The application will be available at `http://localhost:5173`.

## Cloud Run Deployment (GCP)

This repo supports deploying the server (and static UI) to Google Cloud Run using Artifact Registry + Cloud Build.

### Prerequisites (one-time GCP setup)

- **Enable APIs** (project: `ojpm-bank-parser`):
  - Cloud Run (`run.googleapis.com`)
  - Artifact Registry (`artifactregistry.googleapis.com`)
  - Cloud Build (`cloudbuild.googleapis.com`)
  - Secret Manager (`secretmanager.googleapis.com`)
  - Document AI (`documentai.googleapis.com`) (only if using Document AI ingestion)

- **Create Artifact Registry Docker repo** (region: `us-central1`, repo: `bank-parser`):
  - Image pushed as: `us-central1-docker.pkg.dev/ojpm-bank-parser/bank-parser/bank-parser:latest`

- **IAM**
  - **Runtime service account**: `docai-runner@ojpm-bank-parser.iam.gserviceaccount.com`
    - Needs access to any APIs/resources it uses at runtime, typically:
      - `roles/documentai.apiUser` (if `ENABLE_DOC_AI=true`)
      - `roles/secretmanager.secretAccessor` (if reading secrets from Secret Manager)
      - Any additional roles required by your configured integrations (DB, storage, etc.)
  - **Deployer (Cloud Build)** must be able to:
    - Push images to Artifact Registry (e.g. `roles/artifactregistry.writer`)
    - Deploy Cloud Run services (e.g. `roles/run.admin`)
    - Impersonate the runtime service account (e.g. `roles/iam.serviceAccountUser` on `docai-runner@...`)

### Required secrets / env

This app reads config from environment variables. On Cloud Run, you should provide sensitive values via Secret Manager.

- **JWT / cookie signing**
  - `JWT_SECRET` (or mount a secret file and set `JWT_SECRET_FILE=/path/to/file`)
- **Database**
  - `DATABASE_URL` (or `DATABASE_URL_FILE=/path/to/file`)
- **Document AI (optional)**
  - `ENABLE_DOC_AI=true|false`
  - `GOOGLE_PROJECT_ID`
  - `DOCAI_LOCATION` (default `us`)
  - One of:
    - `DOCAI_PROCESSOR_ID` (fallback)
    - or specific processor IDs: `DOC_AI_BANK_PROCESSOR_ID`, `DOC_AI_INVOICE_PROCESSOR_ID`, `DOC_AI_OCR_PROCESSOR_ID`, `DOC_AI_FORM_PROCESSOR_ID`
  - Credentials (choose one):
    - Use Cloud Run's attached service account (recommended), OR
    - Provide key JSON via Secret Manager and set `GCP_SERVICE_ACCOUNT_JSON` / `GCP_SERVICE_ACCOUNT_JSON_FILE`, OR
    - Provide key file path via `GCP_SERVICE_ACCOUNT_PATH` / `GCP_SERVICE_ACCOUNT_PATH_FILE`

### Deploy

- **Via Cloud Build** (recommended):

```bash
gcloud builds submit --config cloudbuild.yaml .
```

- **Via local script**:

```bash
./scripts/deploy-cloudrun.sh
```

## How to Use

### Uploading a Statement

1.  Navigate to the application in your browser.
2.  Drag and drop one or more PDF bank statements onto the file upload area, or click to browse and select files.
3.  The application will process the files, first attempting to use Document AI if enabled. You can monitor the progress in the ingestion stepper.
4.  Once processing is complete, the extracted transactions will appear in the table.

### Exporting to QuickBooks

1.  After transactions have been extracted, click the **"Download CSV"** button.
2.  You can toggle the **"Include BOM"** switch to add a UTF-8 Byte Order Mark to the CSV file, which improves compatibility with some spreadsheet software like Microsoft Excel.
3.  The downloaded CSV file is formatted for direct import into QuickBooks.

## Known Limitations

- The legacy (non-Document AI) parser is currently optimized for a specific Citizens Bank statement layout. It may not work correctly with other bank statement formats.
- The application currently has a file size limit of ~25 MB per upload.
- Batch processing handles files sequentially. Errors in one file do not stop the entire batch, but there is no shared normalization across files in a single batch.

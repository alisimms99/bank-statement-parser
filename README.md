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

## Production Deployment

### Deploying to Google Cloud Run

This application is designed for deployment to Google Cloud Run with **Secret Manager** for secure credential management. All sensitive configuration is stored in Secret Manager and mounted as environment variables or files.

#### Prerequisites

1. A Google Cloud Project with billing enabled
2. [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated
3. [Docker](https://docs.docker.com/get-docker/) installed for building container images
4. Document AI API enabled in your project
5. A Document AI processor created (bank statement or invoice processor)

#### Quick Start Deployment

**Step 1: Create Secrets in Secret Manager**

Run the interactive script to create all required secrets:

```bash
GCP_PROJECT_ID=your-project-id ./scripts/create-secrets.sh
```

This script will guide you through creating:
- JWT secret for session signing
- Google Project ID
- Document AI location and processor ID
- Service account credentials
- Optional CORS and database configuration

**Step 2: Deploy to Cloud Run**

Deploy the application with all secrets properly configured:

```bash
GCP_PROJECT_ID=your-project-id ./scripts/deploy-cloud-run.sh
```

The deployment script will:
1. Build the Docker image
2. Push to Google Container Registry
3. Deploy to Cloud Run with all secrets mounted
4. Configure resource limits and scaling

#### Manual Deployment

If you prefer manual control, see the [Secret Manager Integration Guide](docs/SECRET_MANAGER.md) for:
- Detailed secret creation commands
- Cloud Run YAML configuration
- IAM permission setup
- Troubleshooting guidance

#### Environment Variables vs Secrets

**Store in Secret Manager** (production):
- `JWT_SECRET` - Session cookie signing key
- `GOOGLE_PROJECT_ID` - GCP project ID
- `DOCAI_LOCATION` - Document AI region
- `DOCAI_PROCESSOR_ID` - Processor ID
- `GCP_SERVICE_ACCOUNT_JSON` - Service account credentials (mounted as file)
- `CORS_ALLOW_ORIGIN` - Allowed CORS origins (optional)
- `DATABASE_URL` - Database connection string (optional)

**Set as environment variables** (not secrets):
- `ENABLE_DOC_AI=true` - Enable Document AI processing
- `NODE_ENV=production` - Production mode
- `PORT=8080` - Cloud Run sets this automatically

#### Local Development with Production Secrets

You can test with local `.env.local` files or use the file-based secret convention:

```bash
# .env.local for local development
GOOGLE_PROJECT_ID=my-dev-project
DOCAI_LOCATION=us
DOCAI_PROCESSOR_ID=abc123
GCP_SERVICE_ACCOUNT_PATH=/path/to/service-account.json
JWT_SECRET=local-dev-secret
ENABLE_DOC_AI=true
```

> **Security Note**: Never commit `.env.local` or service account keys to version control. The `.gitignore` file is configured to exclude these files.

#### Additional Resources

- [Secret Manager Integration Guide](docs/SECRET_MANAGER.md) - Complete deployment documentation
- [Architecture Overview](ARCHITECTURE.md) - System design and data flow
- [Testing Guide](docs/TESTING.md) - Running tests locally

## Known Limitations

- The legacy (non-Document AI) parser is currently optimized for a specific Citizens Bank statement layout. It may not work correctly with other bank statement formats.
- The application currently has a file size limit of ~25 MB per upload.
- Batch processing handles files sequentially. Errors in one file do not stop the entire batch, but there is no shared normalization across files in a single batch.

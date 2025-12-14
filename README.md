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

## Deployment

This application is designed to run on Google Cloud Run with OAuth2 authentication and IAM-based access control.

### Production Deployment

**Quick Start:** Follow the **[Quick Start Deployment Guide](docs/QUICK-START-DEPLOYMENT.md)** for a streamlined 5-step deployment process.

**Complete Guide:** For detailed instructions, troubleshooting, and advanced configuration, see the **[Complete Deployment Guide](docs/DEPLOYMENT.md)**.

**Verification:** After deployment, use the **[IAM Verification Guide](docs/IAM-VERIFICATION.md)** to confirm proper security configuration.

Key security features:
- **IAM-based access control**: Lock down Cloud Run service to your Google Workspace domain only
- **OAuth2 authentication**: Application-level authentication for all users
- **No public URLs**: Remove `allUsers` IAM binding for private access
- **Secret management**: Secure credential storage using Google Secret Manager

### Quick Deploy

```bash
# Build and push container
docker build -t gcr.io/YOUR_PROJECT_ID/bank-statement-parser:latest .
docker push gcr.io/YOUR_PROJECT_ID/bank-statement-parser:latest

# Deploy to Cloud Run
gcloud run deploy bank-statement-parser \
  --image gcr.io/YOUR_PROJECT_ID/bank-statement-parser:latest \
  --platform managed \
  --region us-central1

# Lock down IAM (remove public access)
gcloud run services remove-iam-policy-binding bank-statement-parser \
  --region us-central1 \
  --member="allUsers" \
  --role="roles/run.invoker"

# Grant access to your Workspace
gcloud run services add-iam-policy-binding bank-statement-parser \
  --region us-central1 \
  --member="domain:yourdomain.com" \
  --role="roles/run.invoker"
```

For detailed instructions including environment configuration, secret management, and troubleshooting, refer to the [complete deployment guide](docs/DEPLOYMENT.md).

## Authentication

The application uses OAuth2 for user authentication. Users must log in through an OAuth provider before accessing the application features. Access is controlled at two levels:

1. **Infrastructure Level**: Cloud Run IAM restricts service invocation to authorized Workspace identities
2. **Application Level**: OAuth2 session tokens authenticate individual user requests

This dual-layer security ensures only authorized users from your organization can access the application.

## Known Limitations

- The legacy (non-Document AI) parser is currently optimized for a specific Citizens Bank statement layout. It may not work correctly with other bank statement formats.
- The application currently has a file size limit of ~25 MB per upload.
- Batch processing handles files sequentially. Errors in one file do not stop the entire batch, but there is no shared normalization across files in a single batch.

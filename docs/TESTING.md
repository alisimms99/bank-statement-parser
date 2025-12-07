> This document has been updated to reflect the requirements of Issue #5.

# Testing & Debugging Handbook

This guide provides instructions for testing the ingestion pipeline, debugging common issues, and verifying the correctness of the output. It is intended for engineers and QA testers working on the project.

## End-to-End Testing Workflow

This workflow describes how to test the full ingestion pipeline, from uploading a PDF to exporting a CSV file.

### 1. Configure Your Environment

Before you begin, ensure you have a `.env.local` file with the necessary environment variables. See the main `README.md` for setup instructions. For testing, you can toggle `ENABLE_DOC_AI` to test both the Document AI and legacy fallback paths.

### 2. Start the Application

```bash
pnpm dev
```

### 3. Sample PDF Test Workflow

1.  **Obtain a Sample PDF**: For testing, use a sample bank statement PDF. Since the repository does not contain sample files, you will need to provide your own.
2.  **Upload the PDF**: Drag and drop the PDF file onto the upload area in the application.
3.  **Monitor Ingestion**: Observe the ingestion stepper in the UI. It will show the current stage of processing (e.g., "Uploading", "Extracting", "Normalizing"). The source of the extraction ("Document AI" or "Legacy") will also be indicated.
4.  **Inspect Transactions**: Once processing is complete, the extracted transactions will be displayed in the table. Review them for accuracy.

## Debugging and Inspection

### Using the Debug Panel

The in-app debug panel is an essential tool for inspecting the raw output of the ingestion and normalization process.

1.  **Enable the Debug Panel**: Set `VITE_INGESTION_DEBUG=true` in your `.env.local` file to enable the debug panel.
2.  **Toggle Visibility**: You can show or hide the panel by clicking the bug icon in the UI action bar. No server restart is needed.
3.  **Normalization Inspection**: The debug panel displays the raw `CanonicalTransaction` objects that are the output of the normalization process. When inspecting the normalized data, verify the following:
    - **`date` and `posted_date`**: Dates should be in ISO format (`YYYY-MM-DD`).
    - **`description` and `payee`**: The description should be complete, and the payee should be correctly extracted where possible.
    - **`debit` and `credit`**: Amounts should be positive numbers, with debits and credits correctly assigned.
    - **`balance`**: The running balance should be correct, if available in the source document.

### Expected CSV Layout

When you export the transactions to a CSV file, the output should conform to the following structure, which is designed for compatibility with QuickBooks.

**CSV Headers:**

```
Date,Posted Date,Description,Payee,Debit,Credit,Balance,Memo
```

**Data Format:**

| Header        | Description                                                                 |
|---------------|-----------------------------------------------------------------------------|
| `Date`          | The transaction date, formatted as `MM/DD/YYYY`.                            |
| `Posted Date`   | The date the transaction was posted, formatted as `MM/DD/YYYY`.             |
| `Description`   | The full transaction description from the statement.                        |
| `Payee`         | The extracted payee name. Defaults to the description if not available.     |
| `Debit`         | The debit amount as a positive number with two decimal places.                |
| `Credit`        | The credit amount as a positive number with two decimal places.               |
| `Balance`       | The running balance after the transaction, if available.                    |
| `Memo`          | A JSON string containing any additional metadata from the ingestion process. |

By following this guide, you can effectively test the application's functionality and ensure the quality of the data it produces.

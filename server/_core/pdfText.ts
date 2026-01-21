/**
 * Server-side PDF text extraction (INTENTIONALLY DISABLED)
 *
 * ## Design Decision
 * Server-side PDF parsing is disabled because:
 * 1. Document AI is the primary extraction method (Google Cloud)
 * 2. Client-side pdfjs-dist provides fallback parsing in the browser
 * 3. This reduces server-side dependencies and processing load
 *
 * ## Fallback Flow
 * When Document AI fails or is disabled:
 * 1. Server's processLegacyFallback() calls this function
 * 2. This function returns '' (empty string)
 * 3. parseStatementText('') returns [] (no transactions)
 * 4. Server responds with source: "legacy" and 0 transactions
 * 5. Client detects 0 transactions and parses PDF locally using pdfjs-dist
 * 6. Client submits parsed transactions to POST /api/ingest/parsed
 *
 * ## To Enable Server-Side Parsing
 * If you need to enable server-side PDF parsing:
 * 1. Install pdf-parse or pdfjs-dist for Node.js
 * 2. Implement actual text extraction in this function
 * 3. Update processLegacyFallback() to handle the extracted text
 *
 * @param buffer - PDF file buffer (currently unused)
 * @returns Empty string (always) - triggers client-side fallback
 */
export async function extractTextFromPDFBuffer(buffer: Buffer): Promise<string> {
  // Server-side PDF text extraction is intentionally disabled
  // Client handles fallback parsing via pdfjs-dist
  console.log('[Legacy Parser] Server-side PDF parsing disabled, using client fallback');
  return '';
}

/**
 * Server-side PDF text extraction.
 * 
 * Note: Server-side PDF parsing is disabled. Document AI is the primary extraction method.
 * If Document AI fails or returns 0 transactions, the client-side legacy parser (pdfjs-dist)
 * will handle the fallback parsing in the browser.
 */
export async function extractTextFromPDFBuffer(buffer: Buffer): Promise<string> {
  // Server-side PDF text extraction is handled by Document AI
  // Legacy parsing happens on the client side with pdfjs-dist
  // Return empty string to trigger client-side fallback
  console.log('[Legacy Parser] Server-side PDF parsing disabled, using client fallback');
  return '';
}

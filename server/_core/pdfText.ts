/**
 * Server-side PDF text extraction using pdf-parse.
 * 
 * pdf-parse is simpler and more reliable than pdfjs-dist for Node.js environments.
 */
export async function extractTextFromPDFBuffer(buffer: Buffer): Promise<string> {
  // Dynamic import for CommonJS module in ESM context
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buffer);
  return data.text;
}


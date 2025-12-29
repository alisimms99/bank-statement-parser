/**
 * Server-side PDF text extraction using pdf-parse.
 * 
 * pdf-parse is simpler and more reliable than pdfjs-dist for Node.js environments.
 */
export async function extractTextFromPDFBuffer(buffer: Buffer): Promise<string> {
  // Dynamic import for CommonJS module in ESM context
  // pdf-parse exports PDFParse as a named export (class)
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text;
}

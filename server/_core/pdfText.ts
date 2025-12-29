/**
 * Server-side PDF text extraction using pdf-parse.
 * 
 * pdf-parse is simpler and more reliable than pdfjs-dist for Node.js environments.
 */
export async function extractTextFromPDFBuffer(buffer: Buffer): Promise<string> {
  // Dynamic import for CommonJS module in ESM context
  // pdf-parse exports PDFParse as a named export, but the module itself is callable
  const pdfParseModule = await import('pdf-parse');
  // Try default export first, then PDFParse class, then the module itself
  const pdfParse = (pdfParseModule as any).default || pdfParseModule.PDFParse || pdfParseModule;
  const data = await pdfParse(buffer);
  return data.text;
}


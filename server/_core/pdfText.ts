/**
 * Server-side PDF text extraction using pdf-parse.
 * 
 * pdf-parse is simpler and more reliable than pdfjs-dist for Node.js environments.
 */
// Use require for pdf-parse as it's a CommonJS module that works better with dynamic imports
const pdfParse = require('pdf-parse');

export async function extractTextFromPDFBuffer(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;
}


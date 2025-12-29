/**
 * Server-side PDF text extraction using pdf-parse.
 * 
 * pdf-parse is simpler and more reliable than pdfjs-dist for Node.js environments.
 */
import { PDFParse } from 'pdf-parse';

export async function extractTextFromPDFBuffer(buffer: Buffer): Promise<string> {
  const data = await PDFParse(buffer);
  return data.text;
}


/**
 * Server-side PDF text extraction.
 *
 * NOTE: We intentionally use the pdfjs-dist *legacy* build for Node compatibility.
 */
export async function extractTextFromPDFBuffer(buffer: Buffer): Promise<string> {
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const getDocument = pdfjsLib?.getDocument ?? pdfjsLib?.default?.getDocument;
  if (typeof getDocument !== "function") {
    throw new Error("pdfjs-dist legacy build did not expose getDocument()");
  }

  // Convert Buffer to Uint8Array for pdfjs-dist compatibility
  // Buffer.from() ensures we have a Buffer, then .buffer gives us the underlying ArrayBuffer
  const uint8Array = new Uint8Array(Buffer.from(buffer).buffer);
  
  // Configure pdfjs-dist for Node.js environment
  // For text extraction only, we can use an empty data URL for fonts
  // This satisfies the API requirement without loading actual font data
  const loadingTask = getDocument({
    data: uint8Array,
    verbosity: 0, // Suppress warnings
    standardFontDataUrl: "data:application/octet-stream;base64,", // Empty data URL
  });
  const pdf = await (loadingTask?.promise ?? loadingTask);

  let fullText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(" ");
    fullText += pageText + "\n";
  }

  return fullText;
}


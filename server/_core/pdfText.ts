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
  const uint8Array = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const loadingTask = getDocument({ data: uint8Array });
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


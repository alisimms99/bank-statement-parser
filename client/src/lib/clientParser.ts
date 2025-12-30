/**
 * Client-side parser orchestrator.
 * Parses PDFs client-side using custom parsers, falls back to Document AI for unknown banks.
 */
import { extractTextFromPDF, legacyTransactionsToCanonical } from "./pdfParser";
import { detectBank, type BankType } from "./bankDetection";
import { parseBankText } from "./bankParsers";
import { ingestWithDocumentAI } from "./ingestionClient";
import { apiUrl as getApiUrl } from "./apiBaseUrl";
import type { CanonicalDocument, CanonicalTransaction } from "@shared/transactions";
import type { IngestionResult } from "./ingestionClient";

export type ParserSource = "custom" | "documentai" | "error";

export interface ClientParseResult {
  document: CanonicalDocument | null;
  source: ParserSource;
  bankType: BankType;
  error?: string;
  docAiTelemetry?: IngestionResult["docAiTelemetry"];
  exportId?: string;
}

/**
 * Parse bank statement client-side using custom parsers.
 * Falls back to Document AI only for unknown banks or if parsing fails.
 */
export async function parseBankStatementClient(
  file: File,
  documentType: CanonicalDocument["documentType"] = "bank_statement"
): Promise<ClientParseResult> {
  try {
    // 1. Extract text from PDF client-side
    console.log(`[Client Parser] Extracting text from ${file.name}...`);
    const text = await extractTextFromPDF(file);
    
    if (!text || text.trim().length === 0) {
      console.warn(`[Client Parser] No text extracted from ${file.name}, falling back to Document AI`);
      return await fallbackToDocumentAI(file, documentType);
    }
    
    // 2. Detect bank
    const bankType = detectBank(text, file.name);
    console.log(`[Client Parser] Detected bank: ${bankType}`, {
      fileName: file.name,
      textLength: text.length,
      textPreview: text.substring(0, 200),
    });
    
    // 3. Use custom parser for known banks
    if (bankType !== 'unknown') {
      console.log(`[Client Parser] ✅ Bank detected: ${bankType} - using custom parser (NOT Document AI)`);
      try {
        console.log(`[Client Parser] Using custom ${bankType} parser`);
        const legacyTransactions = parseStatementText(text);
        
        // Extract year from filename if available
        const yearMatch = file.name.match(/(20\d{2})/);
        const defaultYear = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
        
        // Convert to canonical format
        const canonicalTransactions = legacyTransactionsToCanonical(legacyTransactions, defaultYear);
        
        // Set source_bank for all transactions
        const transactionsWithBank = canonicalTransactions.map(tx => ({
          ...tx,
          source_bank: bankType,
        }));
        
        console.log(`[Client Parser] ✅ Extracted ${transactionsWithBank.length} transactions using custom ${bankType} parser`);
        console.log(`[Client Parser] Sample transactions:`, transactionsWithBank.slice(0, 3).map(tx => ({
          date: tx.date,
          description: tx.description.substring(0, 50),
          debit: tx.debit,
          credit: tx.credit,
        })));
        
        // Send parsed transactions to server for storage
        const exportId = await sendParsedTransactionsToServer(transactionsWithBank, file.name);
        
        console.log(`[Client Parser] ✅ Successfully parsed and stored ${transactionsWithBank.length} transactions - NOT using Document AI`);
        
        return {
          document: {
            documentType,
            transactions: transactionsWithBank,
            rawText: text,
            warnings: transactionsWithBank.length === 0 ? ["No transactions found in statement"] : undefined,
          },
          source: "custom",
          bankType,
          exportId,
        };
      } catch (error) {
        console.error(`[Client Parser] ❌ Custom parser failed for ${bankType}:`, error);
        console.error(`[Client Parser] Error details:`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        // Fall through to Document AI fallback
      }
    }
    
    // 4. Fallback to Document AI for unknown banks or if parsing failed
    console.warn(`[Client Parser] ⚠️ Falling back to Document AI (bank: ${bankType})`);
    console.warn(`[Client Parser] This should only happen for unknown banks or if custom parser failed`);
    return await fallbackToDocumentAI(file, documentType);
    
  } catch (error) {
    console.error(`[Client Parser] Error parsing ${file.name}:`, error);
    return {
      document: null,
      source: "error",
      bankType: "unknown",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Send pre-parsed transactions to server for storage
 */
async function sendParsedTransactionsToServer(
  transactions: CanonicalTransaction[],
  fileName: string
): Promise<string | undefined> {
  try {
    const response = await fetch(getApiUrl("/api/ingest/parsed"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        fileName,
        transactions,
      }),
    });
    
    if (response.ok) {
      const payload = await response.json();
      return payload.exportId;
    }
    
    console.warn(`[Client Parser] Failed to send transactions to server: ${response.statusText}`);
    return undefined;
  } catch (error) {
    console.error(`[Client Parser] Error sending transactions to server:`, error);
    return undefined;
  }
}


/**
 * Fallback to Document AI for unknown banks or parsing failures
 */
async function fallbackToDocumentAI(
  file: File,
  documentType: CanonicalDocument["documentType"]
): Promise<ClientParseResult> {
  console.log(`[Client Parser] Using Document AI fallback for ${file.name}`);
  const result = await ingestWithDocumentAI(file, documentType);
  
  return {
    document: result.document,
    source: result.source === "documentai" ? "documentai" : "error",
    bankType: "unknown",
    error: result.error,
    docAiTelemetry: result.docAiTelemetry,
    exportId: result.exportId,
  };
}


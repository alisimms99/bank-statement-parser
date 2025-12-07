import type { CanonicalTransaction } from "@shared/transactions";
import type { DocumentAiNormalizedDocument } from "@shared/normalization";
import { normalizeDocumentAITransactions } from "@shared/normalization";

/**
 * Normalize Document AI response into canonical transaction format.
 * 
 * This function takes the raw output from Document AI (or mock output in development)
 * and applies the shared normalization helpers to produce a consistent array of
 * CanonicalTransaction objects.
 * 
 * The normalization process handles:
 * - Date parsing and formatting to ISO format
 * - Amount extraction with proper debit/credit assignment
 * - Payee/merchant extraction
 * - Whitespace cleanup and text normalization
 * 
 * @param mockDocAIOutput - The Document AI response containing entities and text
 * @returns Array of normalized canonical transactions
 */
export function normalizeDocAIResponse(
  mockDocAIOutput: DocumentAiNormalizedDocument
): CanonicalTransaction[] {
  // Use the existing normalization helper from shared/normalization.ts
  // This ensures consistency across all parsing paths (DocAI, legacy, etc.)
  return normalizeDocumentAITransactions(mockDocAIOutput, "bank_statement");
}

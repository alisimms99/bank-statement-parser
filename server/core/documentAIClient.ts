import type { NormalizedTransaction } from "@shared/types";
import { docAiBankFixture } from "../../fixtures/transactions";

/**
 * Result from Document AI processing attempt.
 * Contains either successful transactions or indicates fallback is needed.
 */
export interface ParsedResult {
  /** Array of normalized transactions from Document AI */
  transactions: NormalizedTransaction[];
  /** Source of the parsing result */
  source: "docai" | "fallback";
}

/**
 * Stub implementation of Document AI client for testing and development.
 * 
 * This function simulates Document AI behavior by randomly succeeding or failing.
 * When it succeeds (30-50% of the time), it returns mock transaction data.
 * When it fails, it returns an empty result indicating fallback is needed.
 * 
 * DO NOT add real Google Cloud calls to this function - this is a stub only.
 * 
 * @param fileBuffer - The PDF file buffer to process (currently unused in stub)
 * @returns Promise resolving to ParsedResult with either mock data or fallback indicator
 */
export async function tryDocumentAI(fileBuffer: Buffer): Promise<ParsedResult> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

  // Random success rate between 30-50%
  const successRate = 0.3 + Math.random() * 0.2;
  const shouldSucceed = Math.random() < successRate;

  if (shouldSucceed) {
    // Simulate successful Document AI extraction using fixture data
    const mockTransactions: NormalizedTransaction[] = [
      {
        date: "2024-01-05",
        posted_date: "2024-01-05",
        description: "Grocery Store Purchase",
        payee: "Grocery Store",
        debit: 45.67,
        credit: 0,
        balance: 1000.25,
        account_id: null,
        source_bank: null,
        statement_period: undefined,
        metadata: { source: "docai_stub", confidence: 0.95 },
      },
      {
        date: "2024-01-06",
        posted_date: "2024-01-06",
        description: "PAYROLL DEPOSIT",
        payee: "PAYROLL INC",
        debit: 0,
        credit: 1200.0,
        balance: 2200.25,
        account_id: null,
        source_bank: null,
        statement_period: undefined,
        metadata: { source: "docai_stub", confidence: 0.98 },
      },
    ];

    return {
      transactions: mockTransactions,
      source: "docai",
    };
  }

  // Simulate Document AI failure or unavailability
  return {
    transactions: [],
    source: "fallback",
  };
}

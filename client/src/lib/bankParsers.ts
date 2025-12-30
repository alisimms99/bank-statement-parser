/**
 * Bank-specific text parsers for client-side PDF parsing.
 * These extract transaction lines from raw PDF text and use the existing parsers.
 */
import type { LegacyTransaction } from "@shared/legacyStatementParser";
import type { BankType } from "./bankDetection";

// Import bank-specific parsers from shared (we'll need to export them)
// For now, we'll implement simplified versions that work on text

/**
 * Parse Amex statement text into transactions
 * Format: "08/21/22 AMERICAN EXPRESS TRAVEL SEATTLE WA $500.19"
 *         "12/26/22 TARGET 013821 09100013821 WESLEY CHAPEL FL -$334.89"
 */
export function parseAmexText(text: string, statementYear?: number): LegacyTransaction[] {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const transactions: LegacyTransaction[] = [];
  
  for (const line of lines) {
    // Skip headers and non-transaction lines
    if (
      line.includes("Date") && line.includes("Description") && line.includes("Amount") ||
      line.includes("Page ") && line.includes(" of ") ||
      line.includes("Account Summary") ||
      line.includes("Payment Information") ||
      line.includes("PO BOX") ||
      line.includes("CAROL STREAM") ||
      line.includes("NEWARK NJ") ||
      /Account Ending/i.test(line)
    ) {
      continue;
    }
    
    // Match Amex transaction format: MM/DD/YY Description Amount
    // Date can be MM/DD/YY or MM/DD/ (truncated)
    const dateMatch = line.match(/^(\d{2})\/(\d{2})(?:\/(\d{2}))?\*?\s+/);
    if (!dateMatch) continue;
    
    const month = parseInt(dateMatch[1], 10);
    const day = parseInt(dateMatch[2], 10);
    const yearStr = dateMatch[3];
    const year = yearStr ? (2000 + parseInt(yearStr, 10)) : (statementYear || new Date().getFullYear());
    const date = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
    
    // Extract amount from end: -$1,000.00 or $500.19
    const amountMatch = line.match(/(-?\$[\d,]+\.\d{2})$/);
    if (!amountMatch) continue;
    
    const amountStr = amountMatch[1].replace(/[$,]/g, '');
    const amount = parseFloat(amountStr);
    if (isNaN(amount)) continue;
    
    // Description is between date and amount
    let description = line
      .replace(/^(\d{2}\/\d{2}\/\d{2}\*?\s+)/, '')
      .replace(/^(\d{2}\/\d{2}\/\s+)/, '')
      .replace(/(-?\$[\d,]+\.\d{2})$/, '')
      .trim();
    
    if (!description || description.length < 3) continue;
    
    // Filter garbage (payment coupon addresses) - same patterns as server-side
    if (
      /PO BOX \d+/i.test(description) ||
      /CAROL STREAM/i.test(description) ||
      /NEWARK NJ/i.test(description) ||
      /EL PASO.*TX/i.test(description) ||
      /P\.O\. BOX/i.test(description) ||
      /60197-6031/.test(description) ||
      /07101-1270/.test(description) ||
      /Account Ending/i.test(description) ||
      /^P\.O\. Box/i.test(line) ||
      /^PO Box/i.test(line)
    ) {
      continue;
    }
    
    transactions.push({
      date,
      type: amount < 0 ? "Purchase" : "Credit",
      payee: description,
      amount: amount < 0 ? `-$${Math.abs(amount).toFixed(2)}` : `$${amount.toFixed(2)}`,
    });
  }
  
  return transactions;
}

/**
 * Parse bank statement text using bank-specific parser
 */
export function parseBankText(text: string, bankType: BankType, fileName?: string): LegacyTransaction[] {
  // Extract year from filename if available
  const yearMatch = fileName?.match(/(20\d{2})/);
  const statementYear = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
  
  switch (bankType) {
    case 'amex':
      return parseAmexText(text, statementYear);
    case 'chase':
    case 'capital_one':
    case 'citi':
    case 'citizens':
    case 'dollar_bank':
    case 'amazon-synchrony':
    case 'lowes':
    case 'synchrony':
      // For now, use generic parser for other banks
      // TODO: Implement bank-specific parsers
      return [];
    default:
      return [];
  }
}


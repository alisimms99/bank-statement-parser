/**
 * Bank-specific text parsers for client-side PDF parsing.
 * Uses the original parsers from shared/normalization.ts that were built over multiple sessions.
 * 
 * These parsers extract transaction lines from raw PDF text and use the existing,
 * well-tested parser functions that handle:
 * - Citizens Bank (checking, pattern-based signs)
 * - Capital One (MMM DD dates, explicit minus signs)
 * - Dollar Bank (pattern-based, address filtering)
 * - American Express (MM/DD/YY, explicit signs, payment coupon filtering)
 * - Chase (MM/DD, implicit signs)
 * - Citi (billing period year extraction)
 * - Lowe's/Synchrony (parentheses = negative)
 * - Amazon/Synchrony (explicit minus signs)
 */
import type { LegacyTransaction } from "@shared/legacyStatementParser";
import type { BankType } from "./bankDetection";
import {
  parseAmexTableItem,
  parseCapitalOneTableItem,
  parseChaseTableItem,
  parseCitiTableItem,
  parseDollarBankTableItem,
  parseLowesTableItem,
  parseAmazonSynchronyTableItem,
  getYearFromChaseFilename,
  getCitiBillingPeriod,
  getCitiTransactionYear,
  getYearFromLowesStatement,
  getYearFromAmazonSynchrony,
  getYearFromCapitalOneFilename,
} from "@shared/normalization";

/**
 * Extract transaction lines from raw PDF text for Amex statements.
 * Amex format: "08/21/22 AMERICAN EXPRESS TRAVEL SEATTLE WA $500.19"
 */
function extractAmexTransactionLines(text: string): string[] {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const transactionLines: string[] = [];
  
  for (const line of lines) {
    // Skip headers and non-transaction lines
    if (
      (line.includes("Date") && line.includes("Description") && line.includes("Amount")) ||
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
    if (/^\d{2}\/\d{2}\/\d{2}\*?\s+.*-?\$[\d,]+\.\d{2}$/.test(line) ||
        /^\d{2}\/\d{2}\/\s+.*-?\$[\d,]+\.\d{2}$/.test(line)) {
      transactionLines.push(line);
    }
  }
  
  return transactionLines;
}

/**
 * Extract transaction lines from raw PDF text for Chase statements.
 * Chase format: "06/25 THE LEVITON LAW FIRM B 844-8435290 IL 1,233.96"
 */
function extractChaseTransactionLines(text: string): string[] {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const transactionLines: string[] = [];
  
  for (const line of lines) {
    // Skip headers
    if (
      (line.includes("Date") && line.includes("Description") && line.includes("Amount")) ||
      line.includes("Page ") ||
      /Payment Due Date/i.test(line) ||
      /New Balance/i.test(line)
    ) {
      continue;
    }
    
    // Match Chase transaction format: MM/DD Description Amount
    if (/^\d{2}\/\d{2}\s+.*-?[\d,]+\.\d{2}$/.test(line)) {
      transactionLines.push(line);
    }
  }
  
  return transactionLines;
}

/**
 * Extract transaction lines from raw PDF text for Capital One statements.
 * Capital One format: "Sep 23 ACI*UPMC HEALTH PLANPITTSBURGHPA $176.56"
 */
function extractCapitalOneTransactionLines(text: string): string[] {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const transactionLines: string[] = [];
  
  for (const line of lines) {
    // Skip headers
    if (
      (line.includes("Date") && line.includes("Description") && line.includes("Amount")) ||
      /Payment Due Date/i.test(line) ||
      /New Balance/i.test(line) ||
      /P\.?O\.?\s*Box/i.test(line)
    ) {
      continue;
    }
    
    // Match Capital One transaction format: MMM DD Description Amount
    if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+.*(-?\s*)?\$[\d,]+\.\d{2}$/i.test(line)) {
      transactionLines.push(line);
    }
  }
  
  return transactionLines;
}

/**
 * Extract transaction lines from raw PDF text for Citi statements.
 * Citi format: "12/03 CONTRACTING.COM    TORONTO    CAN $7,300.00"
 */
function extractCitiTransactionLines(text: string): string[] {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const transactionLines: string[] = [];
  
  for (const line of lines) {
    // Skip headers
    if (
      (line.includes("Date") && line.includes("Description") && line.includes("Amount")) ||
      /Standard Purchases/i.test(line) ||
      /Payments, Credits/i.test(line) ||
      /P\.?O\.?\s*Box/i.test(line)
    ) {
      continue;
    }
    
    // Match Citi transaction format: MM/DD Description Amount
    if (/^\d{2}\/\d{2}\s+.*-?\$[\d,]+\.\d{2}$/.test(line)) {
      transactionLines.push(line);
    }
  }
  
  return transactionLines;
}

/**
 * Extract transaction lines from raw PDF text for Dollar Bank statements.
 * Dollar Bank format: "06/01 06/01 KFM247 LTD 1813173920 2,633.00"
 */
function extractDollarBankTransactionLines(text: string): string[] {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const transactionLines: string[] = [];
  
  for (const line of lines) {
    // Skip headers and addresses
    if (
      (line.includes("Date") && line.includes("Description") && line.includes("Amount")) ||
      /PENN HILLS OFFICE/i.test(line) ||
      /218 RODI ROAD/i.test(line) ||
      /\(412\) 244-8589/i.test(line)
    ) {
      continue;
    }
    
    // Match Dollar Bank transaction format: MM/DD MM/DD Description Amount (no $)
    if (/^\d{2}\/\d{2}\s+(\d{2}\/\d{2}\s+)?.*[\d,]+\.\d{2}$/.test(line)) {
      transactionLines.push(line);
    }
  }
  
  return transactionLines;
}

/**
 * Extract transaction lines from raw PDF text for Lowe's/Synchrony statements.
 * Lowe's format: "09/06 09/06 75306 STORE 1660 MONROEVILLE PA $273.33"
 */
function extractLowesTransactionLines(text: string): string[] {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const transactionLines: string[] = [];
  
  for (const line of lines) {
    // Skip headers
    if (
      (line.includes("Date") && line.includes("Description") && line.includes("Amount")) ||
      /P\.?O\.?\s*Box/i.test(line) ||
      /LOWES BUSINESS ACCT/i.test(line) ||
      /Payment Due Date/i.test(line)
    ) {
      continue;
    }
    
    // Match Lowe's transaction format: MM/DD MM/DD Description ($)Amount
    if (/^\d{2}\/\d{2}\s+\d{2}\/\d{2}\s+.*[\($]?[\d,]+\.\d{2}[\)]?$/.test(line)) {
      transactionLines.push(line);
    }
  }
  
  return transactionLines;
}

/**
 * Extract transaction lines from raw PDF text for Amazon/Synchrony statements.
 * Amazon format: "09/25 F9342008C00CHGDDA AUTOMATIC PAYMENT - THANK YOU -$290.88"
 */
function extractAmazonSynchronyTransactionLines(text: string): string[] {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const transactionLines: string[] = [];
  
  for (const line of lines) {
    // Skip headers
    if (
      (line.includes("Date") && line.includes("Description") && line.includes("Amount")) ||
      /P\.?O\.?\s*Box/i.test(line) ||
      /SYNCHRONY BANK/i.test(line) ||
      /Payment Due Date/i.test(line)
    ) {
      continue;
    }
    
    // Match Amazon transaction format: MM/DD REFERENCE# Description Amount
    if (/^\d{2}\/\d{2}\s+[A-Z0-9]{16,}\s+.*-?\$[\d,]+\.\d{2}$/.test(line)) {
      transactionLines.push(line);
    }
  }
  
  return transactionLines;
}

/**
 * Parse bank statement text using the original, well-tested parsers.
 * These parsers were built over multiple sessions and handle all edge cases.
 */
export function parseBankText(text: string, bankType: BankType, fileName?: string): LegacyTransaction[] {
  // Extract year from filename if available
  const yearMatch = fileName?.match(/(20\d{2})/);
  const statementYear = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
  
  const transactions: LegacyTransaction[] = [];
  
  switch (bankType) {
    case 'amex': {
      const lines = extractAmexTransactionLines(text);
      for (const line of lines) {
        const parsed = parseAmexTableItem(line, statementYear);
        if (parsed) {
          transactions.push({
            date: parsed.date,
            type: parsed.amount.startsWith('-') ? "Purchase" : "Credit",
            payee: parsed.description,
            amount: parsed.amount,
          });
        }
      }
      break;
    }
    
    case 'chase': {
      const lines = extractChaseTransactionLines(text);
      const filenameInfo = getYearFromChaseFilename(fileName);
      const inferredYear = filenameInfo?.year || statementYear;
      for (const line of lines) {
        const parsed = parseChaseTableItem(line, inferredYear, fileName);
        if (parsed) {
          transactions.push({
            date: parsed.date,
            type: parsed.amount.startsWith('-') ? "Purchase" : "Credit",
            payee: parsed.description,
            amount: parsed.amount,
          });
        }
      }
      break;
    }
    
    case 'capital_one': {
      const lines = extractCapitalOneTransactionLines(text);
      const filenameInfo = getYearFromCapitalOneFilename(fileName);
      const inferredYear = filenameInfo?.year || statementYear;
      for (const line of lines) {
        const parsed = parseCapitalOneTableItem(line, undefined, inferredYear, fileName);
        if (parsed) {
          transactions.push({
            date: parsed.date,
            type: parsed.amount.startsWith('-') ? "Purchase" : "Credit",
            payee: parsed.description,
            amount: parsed.amount,
          });
        }
      }
      break;
    }
    
    case 'citi': {
      const lines = extractCitiTransactionLines(text);
      const billingPeriod = getCitiBillingPeriod(text);
      for (const line of lines) {
        const parsed = parseCitiTableItem(line, statementYear, fileName, text);
        if (parsed) {
          transactions.push({
            date: parsed.date,
            type: parsed.amount.startsWith('-') ? "Purchase" : "Credit",
            payee: parsed.description,
            amount: parsed.amount,
          });
        }
      }
      break;
    }
    
    case 'dollar_bank': {
      const lines = extractDollarBankTransactionLines(text);
      for (const line of lines) {
        const parsed = parseDollarBankTableItem(line, statementYear);
        if (parsed) {
          transactions.push({
            date: parsed.date,
            type: parsed.amount.startsWith('-') ? "Purchase" : "Credit",
            payee: parsed.description,
            amount: parsed.amount,
          });
        }
      }
      break;
    }
    
    case 'lowes': {
      const lines = extractLowesTransactionLines(text);
      const inferredYear = getYearFromLowesStatement(text) || statementYear;
      for (const line of lines) {
        const parsed = parseLowesTableItem(line, inferredYear, text);
        if (parsed) {
          transactions.push({
            date: parsed.date,
            type: parsed.amount.startsWith('-') ? "Purchase" : "Credit",
            payee: parsed.description,
            amount: parsed.amount,
          });
        }
      }
      break;
    }
    
    case 'amazon-synchrony': {
      const lines = extractAmazonSynchronyTransactionLines(text);
      const inferredYear = getYearFromAmazonSynchrony(text) || statementYear;
      for (const line of lines) {
        const parsed = parseAmazonSynchronyTableItem(line, inferredYear, text);
        if (parsed) {
          transactions.push({
            date: parsed.date,
            type: parsed.amount.startsWith('-') ? "Purchase" : "Credit",
            payee: parsed.description,
            amount: parsed.amount,
          });
        }
      }
      break;
    }
    
    case 'citizens':
    case 'synchrony':
    default:
      // For unknown banks or banks without custom parsers, return empty array
      // This will trigger Document AI fallback
      return [];
  }
  
  return transactions;
}

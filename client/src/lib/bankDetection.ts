/**
 * Client-side bank detection from PDF text.
 * Used to route to the correct custom parser.
 */
export type BankType = 
  | 'amex'
  | 'chase'
  | 'capital_one'
  | 'citi'
  | 'citizens'
  | 'dollar_bank'
  | 'amazon-synchrony'
  | 'lowes'
  | 'synchrony'
  | 'unknown';

/**
 * Detect bank/card issuer from document text and filename.
 * This is used client-side to route to the correct custom parser.
 */
export function detectBank(text: string, fileName?: string): BankType {
  const combined = `${text || ""} ${fileName || ""}`.toLowerCase();
  
  // Check filename patterns (more reliable than content)
  if (/Statement_\d{6}_\d+\.pdf/i.test(fileName || "")) {
    return 'capital_one';
  }
  if (/STATEMENTS,.*-\d+\.pdf/i.test(fileName || "")) {
    return 'citizens';
  }
  if (/^\d{8}-statements-\d+/i.test(fileName || "")) {
    return 'chase';
  }
  
  // Check document text for bank names (but not transaction descriptions)
  // Look for bank name in headers/first part of document
  const textLower = (text || "").toLowerCase();
  const first500Chars = textLower.substring(0, 500); // Check header area
  
  if (first500Chars.includes('dollar bank') || combined.includes('dollar bank')) {
    return 'dollar_bank';
  }
  // Amex detection - check multiple patterns
  if (
    first500Chars.includes('american express') || 
    first500Chars.includes('amex') ||
    textLower.includes('american express') ||
    textLower.includes('amex') ||
    combined.includes('american express') ||
    combined.includes('amex')
  ) {
    console.log('[Bank Detection] ✅ Detected Amex');
    return 'amex';
  }
  if (first500Chars.includes('citizens bank') || first500Chars.includes('citizens')) {
    return 'citizens';
  }
  if (first500Chars.includes('capital one') && !first500Chars.includes('payment')) {
    // Only match Capital One if it's in header, not just in payment descriptions
    return 'capital_one';
  }
  if (first500Chars.includes('chase') && (first500Chars.includes('sapphire') || first500Chars.includes('chase.com'))) {
    return 'chase';
  }
  if (first500Chars.includes('citi') && (first500Chars.includes('custom cash') || first500Chars.includes('double cash') || first500Chars.includes('citicards.com') || first500Chars.includes('thankyou'))) {
    return 'citi';
  }
  if (first500Chars.includes('citibank') || first500Chars.includes('citi cards')) {
    return 'citi';
  }
  // Distinguish Amazon from Lowe's (both Synchrony but different formats)
  const amazonSynchronyPattern = /amazon[\s\S]*(synchrony|syncb)/i;
  if (
    first500Chars.includes('amazon') &&
    (first500Chars.includes('syf.com') ||
      first500Chars.includes('prime store card') ||
      amazonSynchronyPattern.test(first500Chars))
  ) {
    return 'amazon-synchrony';
  }
  if (first500Chars.includes('lowe') && (first500Chars.includes('pro') || first500Chars.includes('rewards') || first500Chars.includes('lowes.com'))) {
    return 'lowes';
  }
  if (first500Chars.includes('synchrony') || first500Chars.includes('syncb')) {
    return 'synchrony';
  }
  
  return 'unknown';
}


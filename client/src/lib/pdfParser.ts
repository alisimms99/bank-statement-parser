import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface Transaction {
  date: string;
  type: string;
  payee: string;
  amount: string;
}

interface ParsedTransaction {
  date: string;
  amount: number;
  description: string;
  isDebit: boolean;
}

/**
 * Extract text from PDF file
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let fullText = '';
  
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += pageText + '\n';
  }
  
  return fullText;
}

/**
 * Parse Citizens Bank statement text into transactions
 */
export function parseStatementText(text: string): Transaction[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const transactions: ParsedTransaction[] = [];
  
  // Find statement period to determine year
  let statementYear = new Date().getFullYear();
  const periodMatch = text.match(/Beginning\s+(\w+)\s+\d+,\s+(\d{4})/);
  if (periodMatch) {
    statementYear = parseInt(periodMatch[2]);
  }
  
  // Track current section
  let currentSection: 'debit' | 'credit' | 'none' = 'none';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect section headers
    if (line.includes('ATM/Purchases') || line.includes('Other Debits') || line.includes('Debits')) {
      currentSection = 'debit';
      continue;
    }
    if (line.includes('Deposits & Credits')) {
      currentSection = 'credit';
      continue;
    }
    if (line.includes('Daily Balance') || line.includes('Balance Calculation')) {
      currentSection = 'none';
      continue;
    }
    
    // Skip headers and non-transaction lines
    if (line.includes('Date') && line.includes('Amount') && line.includes('Description')) continue;
    if (line.includes('Page ') && line.includes(' of ')) continue;
    if (line.includes('Please See Additional')) continue;
    if (line.includes('Member FDIC')) continue;
    if (line.includes('TRANSACTION DETAILS')) continue;
    if (line.includes('Clearly Better Business')) continue;
    
    // Parse transaction line: MM/DD Amount Description
    const transactionMatch = line.match(/^(\d{2})\/(\d{2})\s+([\d,]+\.\d{2})\s+(.+)$/);
    
    if (transactionMatch && currentSection !== 'none') {
      const month = transactionMatch[1];
      const day = transactionMatch[2];
      const amountStr = transactionMatch[3].replace(/,/g, '');
      const description = transactionMatch[4];
      
      // Construct full date
      const dateStr = `${month}/${day}/${statementYear}`;
      
      transactions.push({
        date: dateStr,
        amount: parseFloat(amountStr),
        description: description,
        isDebit: currentSection === 'debit'
      });
    }
  }
  
  // Convert to final format
  return transactions.map(t => ({
    date: t.date,
    type: determineTransactionType(t.description, t.isDebit),
    payee: cleanPayeeName(t.description),
    amount: formatAmount(t.amount, t.isDebit)
  }));
}

/**
 * Determine transaction type from description
 */
function determineTransactionType(description: string, isDebit: boolean): string {
  const upper = description.toUpperCase();
  
  if (upper.includes('POS DEBIT') || upper.includes('DBT PURCHASE')) {
    return 'Debit Card Purchase';
  }
  if (upper.includes('ATM DEPOSIT')) {
    return 'ATM Deposit';
  }
  if (upper.includes('MOBILE DEPOSIT')) {
    return 'Mobile Deposit';
  }
  if (upper.includes('ACH')) {
    return isDebit ? 'ACH Debit' : 'ACH Credit';
  }
  if (upper.includes('TRANSFER')) {
    return 'Transfer';
  }
  if (upper.includes('PAYMENT')) {
    return 'Payment';
  }
  if (upper.includes('OVERDRAFT FEE')) {
    return 'Fee';
  }
  if (upper.includes('DEPOSIT')) {
    return 'Deposit';
  }
  if (upper.includes('PAYPAL')) {
    return 'PayPal';
  }
  if (upper.includes('CASH APP')) {
    return 'Cash App';
  }
  
  return isDebit ? 'Debit' : 'Credit';
}

/**
 * Clean and extract payee name from description
 */
function cleanPayeeName(description: string): string {
  // Remove transaction codes at the beginning
  let cleaned = description.replace(/^\d{4}\s+(POS DEBIT|DBT PURCHASE|ATM DEPOSIT)\s+-\s+/, '');
  
  // Remove reference numbers
  cleaned = cleaned.replace(/\s+\d{6,}\s*$/, '');
  
  // Truncate at location info (state codes, etc.)
  cleaned = cleaned.replace(/\s+[A-Z]{2}$/, '');
  
  // Clean up multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

/**
 * Format amount with sign
 */
function formatAmount(amount: number, isDebit: boolean): string {
  const sign = isDebit ? '-' : '';
  return `${sign}$${amount.toFixed(2)}`;
}

/**
 * Convert transactions to CSV format
 */
export function transactionsToCSV(transactions: Transaction[]): string {
  const headers = ['Date', 'Transaction Type', 'Payee / Payor', 'Amount'];
  const rows = transactions.map(t => [
    t.date,
    t.type,
    t.payee,
    t.amount
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => {
      // Escape cells containing commas or quotes
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(','))
  ].join('\n');
  
  return csvContent;
}

/**
 * Download CSV file
 */
export function downloadCSV(csvContent: string, filename: string = 'transactions.csv'): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

/**
 * Synthetic PDF Generator for Performance Testing
 * Generates bank statement PDFs with configurable transaction counts
 */

import PDFDocument from "pdfkit";

interface SyntheticTransaction {
  date: string;
  description: string;
  amount: number;
  balance: number;
}

interface PDFGenerationOptions {
  transactionCount: number;
  accountNumber?: string;
  bankName?: string;
  startingBalance?: number;
  statementPeriod?: { start: string; end: string };
}

/**
 * Generates a synthetic transaction with realistic data
 */
function generateTransaction(index: number, runningBalance: number): SyntheticTransaction {
  const merchants = [
    "GROCERY STORE #123",
    "GAS STATION FUEL",
    "RESTAURANT DINING",
    "ONLINE SHOPPING",
    "UTILITY PAYMENT",
    "COFFEE SHOP",
    "PHARMACY",
    "ATM WITHDRAWAL",
    "INSURANCE PREMIUM",
    "MOBILE PAYMENT",
    "SUBSCRIPTION SERVICE",
    "RETAIL STORE",
  ];

  // Random date within the last 30 days
  const daysAgo = Math.floor(Math.random() * 30);
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const dateStr = date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });

  // Random merchant
  const merchant = merchants[index % merchants.length];
  
  // Random amount between -500 and 2000 (with 70% debits, 30% credits)
  const isCredit = Math.random() > 0.7;
  const amount = isCredit
    ? Math.floor(Math.random() * 2000) + 100
    : -(Math.floor(Math.random() * 500) + 5);

  const balance = runningBalance + amount;

  return {
    date: dateStr,
    description: merchant,
    amount,
    balance,
  };
}

/**
 * Generates a synthetic bank statement PDF buffer
 */
export function generateSyntheticPDF(options: PDFGenerationOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const {
      transactionCount,
      accountNumber = "****1234",
      bankName = "Synthetic Bank",
      startingBalance = 5000.0,
      statementPeriod = {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString("en-US"),
        end: new Date().toLocaleDateString("en-US"),
      },
    } = options;

    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fontSize(20).text(bankName, { align: "center" });
    doc.moveDown();
    doc.fontSize(16).text("Bank Statement", { align: "center" });
    doc.moveDown();

    // Account info
    doc.fontSize(10);
    doc.text(`Account Number: ${accountNumber}`);
    doc.text(`Statement Period: ${statementPeriod.start} - ${statementPeriod.end}`);
    doc.text(`Beginning Balance: $${startingBalance.toFixed(2)}`);
    doc.moveDown();

    // Transaction header
    doc.fontSize(9);
    const headerY = doc.y;
    doc.text("Date", 50, headerY, { width: 80 });
    doc.text("Description", 130, headerY, { width: 250 });
    doc.text("Amount", 380, headerY, { width: 80, align: "right" });
    doc.text("Balance", 460, headerY, { width: 80, align: "right" });
    doc.moveDown();

    // Draw separator line
    doc.moveTo(50, doc.y).lineTo(540, doc.y).stroke();
    doc.moveDown(0.5);

    // Generate transactions
    let runningBalance = startingBalance;
    let transactionsOnPage = 0;
    const maxTransactionsPerPage = 45; // Adjust based on page size

    for (let i = 0; i < transactionCount; i++) {
      const txn = generateTransaction(i, runningBalance);
      runningBalance = txn.balance;

      const y = doc.y;

      // Add new page if needed
      if (transactionsOnPage >= maxTransactionsPerPage) {
        doc.addPage();
        transactionsOnPage = 0;
        
        // Repeat header on new page
        doc.fontSize(9);
        const headerY = doc.y;
        doc.text("Date", 50, headerY, { width: 80 });
        doc.text("Description", 130, headerY, { width: 250 });
        doc.text("Amount", 380, headerY, { width: 80, align: "right" });
        doc.text("Balance", 460, headerY, { width: 80, align: "right" });
        doc.moveDown();
        doc.moveTo(50, doc.y).lineTo(540, doc.y).stroke();
        doc.moveDown(0.5);
      }

      // Transaction row
      const rowY = doc.y;
      doc.fontSize(8);
      doc.text(txn.date, 50, rowY, { width: 80 });
      doc.text(txn.description, 130, rowY, { width: 250 });
      doc.text(
        txn.amount >= 0 ? `$${txn.amount.toFixed(2)}` : `($${Math.abs(txn.amount).toFixed(2)})`,
        380,
        rowY,
        { width: 80, align: "right" }
      );
      doc.text(`$${txn.balance.toFixed(2)}`, 460, rowY, { width: 80, align: "right" });

      doc.moveDown(0.8);
      transactionsOnPage++;
    }

    // Footer with ending balance
    doc.moveDown();
    doc.fontSize(10);
    doc.text(`Ending Balance: $${runningBalance.toFixed(2)}`, { align: "right" });
    doc.moveDown();
    doc.fontSize(8);
    doc.text(`Total Transactions: ${transactionCount}`, { align: "right" });

    doc.end();
  });
}

/**
 * Helper to generate and save synthetic PDFs for manual testing
 */
export async function generateSyntheticPDFs(sizes: number[]): Promise<Map<number, Buffer>> {
  const results = new Map<number, Buffer>();

  for (const size of sizes) {
    const buffer = await generateSyntheticPDF({
      transactionCount: size,
      accountNumber: `****${String(size).padStart(4, "0")}`,
    });
    results.set(size, buffer);
  }

  return results;
}

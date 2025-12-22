import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Simple PDF generator (creates valid but minimal PDFs)
function generatePDF(transactionCount: number): Buffer {
  const transactions = Array.from({ length: transactionCount }, (_, i) => {
    const date = new Date(2024, 0, 1 + (i % 28));
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
    const amount = (Math.random() * 1000).toFixed(2);
    const isDebit = Math.random() > 0.5;
    const descriptions = [
      'AMAZON PURCHASE',
      'DIRECT DEPOSIT PAYROLL',
      'CHECK #' + Math.floor(Math.random() * 9999),
      'ATM WITHDRAWAL',
      'UTILITY PAYMENT',
      'RESTAURANT',
      'GAS STATION',
      'GROCERY STORE',
      'ONLINE TRANSFER',
      'SUBSCRIPTION SERVICE'
    ];
    const desc = descriptions[i % descriptions.length];
    return `${dateStr}  ${desc}  ${isDebit ? '-' : ''}$${amount}`;
  });

  const content = `
%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length ${transactions.join('\n').length + 200} >>
stream
BT
/F1 10 Tf
50 750 Td
(Citizens Bank Statement) Tj
0 -20 Td
(Account: *1234) Tj
0 -20 Td
(Statement Period: 01/01/2024 - 01/31/2024) Tj
0 -30 Td
(Date        Description                    Amount) Tj
${transactions.map((t, i) => `0 -12 Td (${t}) Tj`).join('\n')}
ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000214 00000 n
trailer << /Size 5 /Root 1 0 R >>
startxref
${500 + transactions.length * 50}
%%EOF
`;

  return Buffer.from(content);
}

// Generate test files
const outputDir = join(process.cwd(), 'fixtures', 'stress-test');
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

const sizes = [
  { name: 'small-500', count: 500 },
  { name: 'medium-1000', count: 1000 },
  { name: 'large-5000', count: 5000 },
];

console.log('Generating synthetic test PDFs...');

for (const size of sizes) {
  const pdf = generatePDF(size.count);
  const path = join(outputDir, `${size.name}-transactions.pdf`);
  writeFileSync(path, pdf);
  console.log(`  ✓ ${path} (${size.count} transactions, ${(pdf.length / 1024).toFixed(1)} KB)`);
}

console.log('\nDone! Files created in fixtures/stress-test/');

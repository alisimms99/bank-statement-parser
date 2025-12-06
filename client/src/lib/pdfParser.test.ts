import { describe, expect, it } from 'vitest';

import { parseStatementText, transactionsToCSV } from './pdfParser';

describe('transactionsToCSV', () => {
  it('formats debit and credit amounts as plain numbers', () => {
    const csv = transactionsToCSV([
      {
        date: '01/05/2024',
        type: 'Debit Card Purchase',
        payee: 'Coffee Shop',
        amount: '-$12.34'
      },
      {
        date: '01/06/2024',
        type: 'ACH Credit',
        payee: 'PAYROLL INC',
        amount: '$2,500.00'
      }
    ]);

    const [, debitLine, creditLine] = csv.split('\n');
    expect(debitLine.split(',').at(-1)).toBe('-12.34');
    expect(creditLine.split(',').at(-1)).toBe('2500.00');
  });

  it('escapes commas and quotes in payee names', () => {
    const csv = transactionsToCSV([
      {
        date: '02/01/2024',
        type: 'Deposit',
        payee: 'ACME, "International"',
        amount: '$100.00'
      }
    ]);

    const [, line] = csv.split('\n');
    // Payee cell should be quoted and contain doubled quotes
    expect(line).toContain('"ACME, ""International"""');
  });

  it('optionally prefixes a UTF-8 BOM for Excel/QuickBooks', () => {
    const csv = transactionsToCSV([
      {
        date: '03/10/2024',
        type: 'ACH Credit',
        payee: 'PAYROLL INC',
        amount: '$500.00'
      }
    ], { includeBom: true });

    expect(csv.startsWith('\uFEFF')).toBe(true);
    const [, dataLine] = csv.replace('\uFEFF', '').split('\n');
    expect(dataLine.endsWith('500.00')).toBe(true);
  });
});

describe('parseStatementText', () => {
  it('parses debit and credit sections with cleaned payees', () => {
    const currentYear = new Date().getFullYear();
    const text = `
TRANSACTION DETAILS
Deposits & Credits
01/02 1,200.00 MOBILE DEPOSIT REF #12345
ATM/Purchases
01/03 (45.22) POS DEBIT COFFEE SHOP MA
Daily Balance
`;

    const result = parseStatementText(text);

    expect(result).toEqual([
      {
        date: `01/02/${currentYear}`,
        type: 'Mobile Deposit',
        payee: 'MOBILE DEPOSIT REF',
        amount: '$1200.00'
      },
      {
        date: `01/03/${currentYear}`,
        type: 'Debit Card Purchase',
        payee: 'COFFEE SHOP',
        amount: '-$45.22'
      }
    ]);
  });

  it('parses dual debit/credit columns and respects embedded years', () => {
    const text = `
Date Description Debit Credit
02/10/24 CHECK #1234 125.00 -
02/11/24 REFUND - 35.00
`;

    const result = parseStatementText(text);

    expect(result).toEqual([
      {
        date: '02/10/2024',
        type: 'Debit',
        payee: 'CHECK',
        amount: '-$125.00'
      },
      {
        date: '02/11/2024',
        type: 'Credit',
        payee: 'REFUND',
        amount: '$35.00'
      }
    ]);
  });
});


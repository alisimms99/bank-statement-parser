import { describe, expect, it } from 'vitest';

import {
  canonicalToDisplayTransaction,
  legacyTransactionsToCanonical,
  parseStatementText
} from './pdfParser';
import { exportCanonicalToCSV } from '@shared/export/csv';

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

describe('canonical helpers', () => {
  it('normalizes legacy parsed output into canonical records with positive debit/credit', () => {
    const legacy = [
      { date: '03/05/2024', type: 'ACH Credit', payee: 'ACME CORP', amount: '$500.00' },
      { date: '03/06/2024', type: 'Debit Card', payee: 'Store', amount: '-$25.00' }
    ];

    const canonicalized = legacyTransactionsToCanonical(legacy as any);
    expect(canonicalized).toEqual([
      expect.objectContaining({ credit: 500, debit: 0, payee: 'ACME CORP' }),
      expect.objectContaining({ debit: 25, credit: 0, payee: 'Store' })
    ]);
  });

  it('converts canonical transactions to display rows', () => {
    const display = canonicalToDisplayTransaction({
      date: '2024-02-10',
      posted_date: '2024-02-10',
      description: 'Card Purchase',
      payee: 'Coffee Shop',
      debit: 12.5,
      credit: 0,
      balance: null,
      account_id: null,
      source_bank: null,
      statement_period: { start: null, end: null },
      metadata: {}
    });

    expect(display).toEqual({
      date: '02/10/2024',
      type: 'Debit',
      payee: 'Coffee Shop',
      amount: '-$12.50'
    });
  });

  it('exports canonical amounts with separate debit/credit columns for QuickBooks', () => {
    const canonical = [
      {
        date: '2024-02-10',
        posted_date: '2024-02-10',
        description: 'Card Purchase',
        payee: 'Coffee Shop',
        debit: 12.5,
        credit: 0,
        balance: null,
        account_id: null,
        source_bank: null,
        statement_period: { start: null, end: null },
        metadata: {}
      },
      {
        date: '2024-02-11',
        posted_date: '2024-02-11',
        description: 'Payroll',
        payee: 'PAYROLL INC',
        debit: 0,
        credit: 2500,
        balance: null,
        account_id: null,
        source_bank: null,
        statement_period: { start: null, end: null },
        metadata: {}
      }
    ];

    const csv = exportCanonicalToCSV(canonical, { includeBom: true });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const [, debitLine, creditLine] = csv.replace('\uFEFF', '').split('\n');
    expect(debitLine.split(',')[4]).toBe('12.50');
    expect(creditLine.split(',')[5]).toBe('2500.00');
  });
});

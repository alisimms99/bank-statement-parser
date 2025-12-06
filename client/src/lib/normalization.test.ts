import { describe, expect, it } from 'vitest';

import {
  normalizeAmount,
  normalizeDateString,
  normalizeDocumentAITransactions,
  type DocumentAiNormalizedDocument
} from '@shared/normalization';

describe('normalizeDocumentAITransactions', () => {
  it('normalizes debit and credit entities with mixed processors', () => {
    const doc: DocumentAiNormalizedDocument = {
      entities: [
        {
          type: 'bank_transaction',
          mentionText: '01/05 Grocery Store -45.67',
          normalizedValue: { text: '01/05/2024' },
          properties: [
            {
              type: 'amount',
              mentionText: '-45.67',
              normalizedValue: { moneyValue: { amount: -45.67, currencyCode: 'USD' } }
            },
            { type: 'merchant_name', mentionText: 'Grocery Store' }
          ],
        },
        {
          type: 'transaction_credit',
          mentionText: '01/06 Payroll 1200.00',
          normalizedValue: { text: '2024-01-06' },
          properties: [
            {
              type: 'amount',
              mentionText: '1200.00',
              normalizedValue: { moneyValue: { amount: 1200 } }
            },
            { type: 'counterparty', mentionText: 'PAYROLL INC' }
          ],
        }
      ]
    };

    const result = normalizeDocumentAITransactions(doc, 'bank_statement');

    expect(result).toEqual([
      expect.objectContaining({ posted_date: '2024-01-05', payee: 'Grocery Store', debit: 45.67, credit: 0 }),
      expect.objectContaining({ posted_date: '2024-01-06', payee: 'PAYROLL INC', credit: 1200, debit: 0 })
    ]);
  });
});

describe('normalizeAmount', () => {
  it('returns positive debit on negative values', () => {
    expect(normalizeAmount('-100.25')).toEqual({ debit: 100.25, credit: 0 });
    expect(normalizeAmount('(45.10)')).toEqual({ debit: 45.1, credit: 0 });
  });

  it('returns positive credit on positive values', () => {
    expect(normalizeAmount('$250.00')).toEqual({ debit: 0, credit: 250 });
    expect(normalizeAmount('1,200.50', 'credit')).toEqual({ debit: 0, credit: 1200.5 });
  });
});

describe('normalizeDateString', () => {
  it('normalizes MM/DD/YYYY and ISO inputs', () => {
    expect(normalizeDateString('03/10/2024')).toBe('2024-03-10');
    expect(normalizeDateString('2024-04-01')).toBe('2024-04-01');
  });
});

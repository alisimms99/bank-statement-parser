# Implement Custom Parsers as Primary Path (Option C)

## Goal
**Accuracy over speed.** These CSVs will be the source of truth for all historical transactions.

## Why This Approach
1. Custom parsers already work perfectly locally - they were built by analyzing actual statements
2. They correctly handle each bank's unique sign conventions:
   - Amex: explicit `-$500.00`
   - Lowe's/Synchrony: parentheses `($71.45)` 
   - Amazon/Synchrony: explicit `-$290.88`
   - Chase: implicit signs
   - etc.
3. Document AI returns generic bank statement data that loses important details (merchant names become just city/state)
4. pdfjs-dist works fine in browsers - the Node.js issues don't apply client-side

## Architecture Change

```
CURRENT (broken):
[PDF] → [Server: Document AI] → [Generic normalization] → [Wrong data]

NEW (accurate):
[PDF] → [Client: pdfjs-dist] → [Bank Detection] → [Custom Parser] → [Accurate data]
        ↓ (fallback only)
      [Server: Document AI] → [Unknown bank formats only]
```

## Implementation

### 1. Update Client-Side Ingestion Flow

**File: `client/src/lib/ingestionClient.ts` or similar**

Change the flow to:
1. Client extracts text using pdfjs-dist (already works in browser)
2. Client detects bank from text
3. If known bank → use custom parser
4. If unknown bank → send to Document AI as fallback

```typescript
async function processStatement(file: File): Promise<Transaction[]> {
  // 1. Extract text client-side
  const text = await extractTextFromPDF(file);
  
  // 2. Detect bank
  const bank = detectBank(text);
  
  // 3. Use custom parser for known banks
  if (bank !== 'unknown') {
    console.log(`[Parser] Using custom ${bank} parser`);
    return parseByBank(bank, text, file.name);
  }
  
  // 4. Fallback to Document AI for unknown formats
  console.log('[Parser] Unknown bank, using Document AI fallback');
  return await sendToDocumentAI(file);
}
```

### 2. Ensure Custom Parsers Are Used

**File: `server/_core/documentAi.ts` or `client/src/lib/pdfParser.ts`**

The custom parsers for these banks should be PRIMARY, not fallback:
- Citizens Bank ✅
- Capital One ✅
- Dollar Bank ✅
- American Express ✅
- Chase ✅
- Citi ✅
- Lowe's/Synchrony ✅
- Amazon/Synchrony ✅

### 3. Bank Detection Function

**File: `client/src/lib/bankDetection.ts` or similar**

```typescript
export function detectBank(text: string): BankType {
  // Amex
  if (/american express|amex/i.test(text)) return 'amex';
  
  // Chase
  if (/chase|jpmorgan/i.test(text)) return 'chase';
  
  // Capital One
  if (/capital one/i.test(text)) return 'capital-one';
  
  // Citi
  if (/citibank|citi\s/i.test(text)) return 'citi';
  
  // Citizens Bank
  if (/citizens bank/i.test(text)) return 'citizens';
  
  // Dollar Bank
  if (/dollar bank/i.test(text)) return 'dollar-bank';
  
  // Synchrony variants
  if (/amazon\.syf\.com|AMAZON.*SYNCHRONY|Prime Store Card/i.test(text)) return 'amazon-synchrony';
  if (/lowes\.com\/credit|LOWE.*PRO|MyLowe/i.test(text)) return 'lowes-synchrony';
  
  return 'unknown';
}
```

### 4. Remove Document AI as Primary Path

**File: `server/ingestRoutes.ts`**

For the `/api/ingest` endpoint, change logic:
- If client sends parsed transactions → use them directly
- If client sends raw file → return error asking client to parse first
- Document AI endpoint should be separate: `/api/ingest/docai-fallback`

### 5. Update UI to Show Parser Source

**File: `client/src/pages/Home.tsx` or similar**

Show which parser processed each file:
```
✅ 2023-01-25.pdf — Amex parser (87 transactions)
✅ 2023-02-22.pdf — Amex parser (92 transactions)
⚠️ unknown-bank.pdf — Document AI fallback (13 transactions)
```

## Verification Checklist

After implementation, test with these statements:

| Bank | Test File | Expected |
|------|-----------|----------|
| Amex | Any Amex statement | Full merchant names, correct signs |
| Chase | Any Chase statement | Correct date format, signs |
| Lowe's | Lowe's Pro statement | Parentheses = negative |
| Amazon | Amazon Store Card | Minus sign = negative |
| Citizens | Checking statement | Pattern-based detection |

## Success Criteria

1. Amex statement shows:
   - Full merchant names (not just city/state)
   - Correct debit/credit signs
   - All transactions extracted

2. UI shows "Custom Parser" badge, not "Document AI"

3. Document AI only used for banks without custom parsers

## Files to Modify

1. `client/src/lib/ingestionClient.ts` - Change flow to client-first
2. `client/src/lib/pdfParser.ts` - Ensure bank detection + custom parsers
3. `server/ingestRoutes.ts` - Accept pre-parsed transactions
4. `client/src/pages/Home.tsx` - Show parser source in UI

## Deploy & Test

```bash
# After changes
pnpm check
pnpm build:prod
gcloud run deploy bank-statement-parser --source . --region us-central1

# Test
# Upload Amex statement, verify full merchant names appear
```

## Why Document AI Failed

Document AI's Bank Statement Parser returns:
- `table_item/transaction_withdrawal_description` → "LUTZ FL" (just location)
- Missing the actual merchant name like "WALMART" or "TARGET"

Our custom Amex parser extracts the full description line which includes merchant + location.

## Fallback Strategy

Document AI should ONLY be used when:
1. Bank is not recognized by `detectBank()`
2. Custom parser fails/errors
3. User explicitly requests it

This ensures accuracy for 80%+ of transactions (the 8 banks we have parsers for).

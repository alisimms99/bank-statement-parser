# Bank Statement Parser Audit - FINDINGS

## Executive Summary

This audit traces the complete data flow from PDF upload through Google Sheets export, identifying several issues with the current implementation including an unused import, a disabled server-side fallback path, and a TypeScript environment configuration issue.

---

## Phase 1: Data Flow Analysis

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         PDF INGESTION FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. ENTRY POINT                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ POST /api/ingest  (server/ingestRoutes.ts:256)                           │   │
│  │   - Accepts multipart/form-data (file upload) OR JSON (base64 content)   │   │
│  │   - Validates request via parseRequest()                                  │   │
│  │   - Extracts: fileName, buffer, documentType                              │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                     │                                            │
│                                     ▼                                            │
│  2. DOCUMENT AI PROCESSING (Primary Path)                                        │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ processWithDocumentAIStructured()  (server/_core/documentAIClient.ts:55) │   │
│  │   - Checks if ENABLE_DOC_AI=true                                          │   │
│  │   - Selects processor: bank, invoice, ocr, or form                        │   │
│  │   - Calls Google Document AI API                                          │   │
│  │   - Returns: CanonicalDocument with entities                              │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                     │                                            │
│                                     ▼                                            │
│  3. TRANSACTION NORMALIZATION                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ normalizeDocumentAITransactions()  (shared/normalization.ts:163)         │   │
│  │                                                                           │   │
│  │   3a. BANK DETECTION                                                      │   │
│  │       detectBankFromContent() (shared/normalization.ts:72)                │   │
│  │       - Detects: dollar_bank, capital_one, amex, chase, citi, lowes,      │   │
│  │                  synchrony, amazon-synchrony, citizens, unknown           │   │
│  │                                                                           │   │
│  │   3b. CUSTOM PARSERS (bank-specific)                                      │   │
│  │       - parseCapitalOneTableItem()    (line 1298)                         │   │
│  │       - parseAmexTableItem()          (line 1423)                         │   │
│  │       - parseDollarBankTableItem()    (line 1635)                         │   │
│  │       - parseChaseTableItem()         (line 769)                          │   │
│  │       - parseCitiTableItem()          (line 925)                          │   │
│  │       - parseLowesTableItem()         (line 1052)                         │   │
│  │       - parseAmazonSynchronyTableItem() (line 1182)                       │   │
│  │       - parseTableItemMentionText()   (line 1747) - generic fallback      │   │
│  │                                                                           │   │
│  │   3c. GARBAGE FILTERING (pre-parser)                                      │   │
│  │       - isCapitalOneGarbage()     (line 1255)                             │   │
│  │       - isAmexGarbage()           (line 1394)                             │   │
│  │       - isChaseGarbage()          (line 721)                              │   │
│  │       - isCitiGarbage()           (line 830)                              │   │
│  │       - isLowesGarbage()          (line 992)                              │   │
│  │       - isAmazonSynchronyGarbage() (line 1124)                            │   │
│  │                                                                           │   │
│  │   Output: CanonicalTransaction[]                                          │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                     │                                            │
│                                     ▼                                            │
│  4. AI CLEANUP (LLM-based normalization)  ✅ WIRED & WORKING                     │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ cleanTransactions()  (server/aiCleanup.ts:90)                            │   │
│  │   - Fetches QuickBooks history for user (optional categorization)         │   │
│  │   - Pre-processes with heuristicStandardizeMerchant()                     │   │
│  │   - Calls invokeLLM() with structured JSON schema                         │   │
│  │   - Fallback to deterministic cleanup if LLM fails                        │   │
│  │                                                                           │   │
│  │   invokeLLM()  (server/_core/llm.ts:200)                                  │   │
│  │   - Provider: OpenAI (OPENAI_API_KEY) or Forge (BUILT_IN_FORGE_API_KEY)   │   │
│  │   - Model: gpt-4o-mini (OpenAI) or gemini-2.5-flash (Forge)               │   │
│  │   - Returns: { cleaned[], removed[], flagged[] }                          │   │
│  │                                                                           │   │
│  │   Output: CleanupResult { cleaned, removed, flagged }                     │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                     │                                            │
│                                     ▼                                            │
│  5. TRANSACTION STORAGE                                                          │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ storeTransactions()  (server/exportRoutes.ts:189)                        │   │
│  │   - Stores in-memory Map with UUID key                                    │   │
│  │   - TTL: 1 hour auto-cleanup                                              │   │
│  │   - Returns: exportId (UUID)                                              │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                     │                                            │
│                                     ▼                                            │
│  6. RESPONSE                                                                     │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ Returns to client:                                                        │   │
│  │   - source: "documentai" | "legacy"                                       │   │
│  │   - document: { documentType, transactions, rawText, warnings }           │   │
│  │   - exportId: UUID for CSV/Sheets export                                  │   │
│  │   - docAiTelemetry: { enabled, processor, latencyMs, entityCount }        │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│                         EXPORT FLOW                                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  7. CSV EXPORT                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ GET /api/export/:id/csv  (server/exportRoutes.ts:695)                    │   │
│  │   - Retrieves transactions from in-memory store                           │   │
│  │   - Converts to CSV via toCSV() (shared/export/csv.ts)                    │   │
│  │   - Returns: text/csv file download                                       │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  8. GOOGLE SHEETS EXPORT                                                         │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ POST /api/export/sheets  (server/exportRoutes.ts:889)                    │   │
│  │   - Mode: "create" (new spreadsheet) or "append" (existing)               │   │
│  │   - Uses Google Sheets API v4 with OAuth tokens                           │   │
│  │   - Creates/appends to Transactions sheet + hidden Hashes sheet           │   │
│  │   - Deduplication via transaction hash comparison                         │   │
│  │                                                                           │   │
│  │ POST /api/sheets/sync  (server/exportRoutes.ts:375)                      │   │
│  │   - Validates account ownership                                           │   │
│  │   - Creates year-based tabs: AccountName-XXXX-YYYY                        │   │
│  │   - Updates _Account Registry and _Import Log tabs                        │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│                    LEGACY FALLBACK PATH (⚠️ PARTIALLY BROKEN)                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  If Document AI fails or is disabled:                                            │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │ processLegacyFallback()  (server/ingestRoutes.ts:97)                     │   │
│  │   - Calls extractTextFromPDFBuffer()                                      │   │
│  │   - ⚠️ ALWAYS RETURNS EMPTY STRING (disabled!)                            │   │
│  │   - Then calls parseStatementText() which returns [] for empty input      │   │
│  │   - Result: Legacy server-side parsing never extracts transactions        │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  Comment in pdfText.ts:8-14 states:                                              │
│    "Server-side PDF parsing is disabled. Document AI is the primary method.     │
│     Legacy parsing happens on the client side with pdfjs-dist"                   │
│                                                                                  │
│  ⚠️ IMPACT: If Document AI fails, server returns 0 transactions.                 │
│             Client must handle fallback parsing.                                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│                    CUSTOM PARSER PATH (Client-initiated)                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  POST /api/ingest/parsed  (server/ingestRoutes.ts:162)                          │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │   - Accepts pre-parsed transactions from client                           │   │
│  │   - Applies cleanTransactions() AI cleanup                                │   │
│  │   - Stores and returns exportId                                           │   │
│  │   - Used when client does custom parsing (pdfjs-dist)                     │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Identified Issues

### Issue 1: Unused Import (Low Priority)
**File:** `server/ingestRoutes.ts:5`

```typescript
import { processWithDocumentAI, processWithDocumentAIStructured } from "./_core/documentAIClient";
```

- `processWithDocumentAI` is imported but never used
- Only `processWithDocumentAIStructured` is called
- **Impact:** Dead code, no functional impact

### Issue 2: Disabled Server-Side Legacy Parser (Medium Priority)
**File:** `server/_core/pdfText.ts:8-14`

```typescript
export async function extractTextFromPDFBuffer(buffer: Buffer): Promise<string> {
  // Server-side PDF text extraction is handled by Document AI
  // Legacy parsing happens on the client side with pdfjs-dist
  console.log('[Legacy Parser] Server-side PDF parsing disabled, using client fallback');
  return '';  // ⚠️ ALWAYS RETURNS EMPTY STRING
}
```

**Impact:**
- If Document AI fails or is disabled, the server's `processLegacyFallback()` will:
  1. Call `extractTextFromPDFBuffer()` → returns `''`
  2. Call `parseStatementText('')` → returns `[]`
  3. Return 0 transactions to the client
- Client must handle all fallback parsing via pdfjs-dist
- This is by design (per comment), but creates a silent failure path

### Issue 3: TypeScript Environment Configuration (Low Priority)
**Error:** `TS2688: Cannot find type definition file for 'node'`

- Not a code error in `server/db.ts`
- Missing `@types/node` in the TypeScript configuration
- **Fix:** Run `npm install --save-dev @types/node` or ensure it's in devDependencies

### Issue 4: OpenAI/LLM Cleanup IS Wired (Verified Working)
**Status:** ✅ Actually working

The AI cleanup is properly wired:
1. `server/ingestRoutes.ts` imports `cleanTransactions` from `./aiCleanup` (line 11)
2. Called at multiple points:
   - Line 193: After custom parser path (`/api/ingest/parsed`)
   - Line 350: After Document AI success
   - Line 397: After legacy fallback
   - Line 578: In bulk ingestion
3. `cleanTransactions()` calls `invokeLLM()` which:
   - Uses OpenAI API if `OPENAI_API_KEY` is set
   - Falls back to Forge API if `BUILT_IN_FORGE_API_KEY` is set
   - Has deterministic fallback if LLM fails

---

## Recent Garbage Filtering Changes

### Commit `0a8a186` (Jan 14, 2026)
**"Fix: Additional Dollar Bank sign patterns and garbage filter (PR #171)"**

Changes to `shared/normalization.ts`:
- Added PayPal transfers to ALI SIMMS as credits
- Added FSI-ACH-PAYMENT and FSI TRADE PAY as credits
- Added filter for phantom entries like `'Z MARUYOGA WELLNGARBAGE'`

### Garbage Filter Functions (all in `shared/normalization.ts`):

| Function | Bank | Purpose |
|----------|------|---------|
| `isCapitalOneGarbage()` | Capital One | Filters PO Box, payment due dates, interest calculations |
| `isAmexGarbage()` | American Express | Filters payment coupon addresses (source of $603M zip bug) |
| `isChaseGarbage()` | Chase | Filters P.O. Box, payment info, rewards text |
| `isCitiGarbage()` | Citi | Filters section headers, customer service text |
| `isLowesGarbage()` | Lowe's/Synchrony | Filters account info, invoice details, promotional text |
| `isAmazonSynchronyGarbage()` | Amazon/Synchrony | Filters section headers, order IDs |
| Dollar Bank phantom filter | Dollar Bank | Filters entries starting with `Z [UPPERCASE]` |

---

## Data Flow Summary by Component

| Step | File | Function | Input | Output |
|------|------|----------|-------|--------|
| 1 | `ingestRoutes.ts` | `parseRequest()` | HTTP Request | `{fileName, buffer, documentType}` |
| 2 | `documentAIClient.ts` | `processWithDocumentAIStructured()` | Buffer | `DocumentAIResponse` |
| 3 | `normalization.ts` | `detectBankFromContent()` | text, fileName, entities | Bank type string |
| 4 | `normalization.ts` | `is*Garbage()` | mentionText | boolean (filter) |
| 5 | `normalization.ts` | `parse*TableItem()` | mentionText | `{date, amount, description}` |
| 6 | `normalization.ts` | `normalizeDocumentAITransactions()` | DocumentAiNormalizedDocument | `CanonicalTransaction[]` |
| 7 | `aiCleanup.ts` | `cleanTransactions()` | `CanonicalTransaction[]` | `CleanupResult` |
| 8 | `llm.ts` | `invokeLLM()` | messages, schema | LLM response |
| 9 | `exportRoutes.ts` | `storeTransactions()` | `CanonicalTransaction[]` | exportId (UUID) |
| 10 | `exportRoutes.ts` | `/api/export/sheets` | transactions, OAuth | Sheets URL |

---

## Proposed Fixes

### Fix 1: Remove Unused Import
**File:** `server/ingestRoutes.ts:5`
**Action:** Remove `processWithDocumentAI` from import

```typescript
// Before
import { processWithDocumentAI, processWithDocumentAIStructured } from "./_core/documentAIClient";

// After
import { processWithDocumentAIStructured } from "./_core/documentAIClient";
```

**Rationale:** Dead code cleanup

### Fix 2: Add @types/node to Dependencies
**File:** `package.json`
**Action:** Ensure `@types/node` is in devDependencies

```bash
npm install --save-dev @types/node
```

**Rationale:** Fixes TypeScript compilation error

### Fix 3: Document Legacy Parser Design Decision
**File:** `server/_core/pdfText.ts`
**Action:** Add JSDoc explaining the intentional design

```typescript
/**
 * Server-side PDF text extraction (INTENTIONALLY DISABLED)
 *
 * Design Decision: Server-side PDF parsing is disabled because:
 * 1. Document AI is the primary extraction method
 * 2. Client-side pdfjs-dist provides fallback parsing
 * 3. This reduces server-side dependencies and processing load
 *
 * If Document AI fails, the client receives 0 transactions and should:
 * 1. Parse the PDF locally using pdfjs-dist
 * 2. Submit parsed transactions to POST /api/ingest/parsed
 *
 * @returns Empty string (always)
 */
export async function extractTextFromPDFBuffer(buffer: Buffer): Promise<string> {
  console.log('[Legacy Parser] Server-side PDF parsing disabled, using client fallback');
  return '';
}
```

**Rationale:** Makes the intentional design decision explicit for future maintainers

---

## Verification Checklist

- [x] Document AI is properly wired and called
- [x] Bank detection happens in `normalizeDocumentAITransactions()`
- [x] Custom parsers are invoked per detected bank type
- [x] Garbage filtering runs BEFORE bank-specific parsing
- [x] OpenAI/LLM cleanup IS being called (not a dead path)
- [x] Google Sheets export is functional (multiple endpoints)
- [x] No TypeScript errors in `server/db.ts` (it's an env config issue)

---

## Recommendations

1. **Keep current architecture** - The client-side fallback design is reasonable
2. **Apply Fix 1** - Remove unused import (trivial cleanup)
3. **Apply Fix 2** - Add @types/node to fix TS compilation
4. **Consider Fix 3** - Better documentation for the disabled legacy path
5. **No urgent fixes needed** - The system is working as designed

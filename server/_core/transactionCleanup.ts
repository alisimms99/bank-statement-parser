import { invokeLLM, type Message } from "./llm";
import { ENV } from "./env";
import type { CanonicalTransaction } from "@shared/transactions";

const CLEANUP_SYSTEM_PROMPT = `You are a transaction data cleanup assistant. Your job is to:
1. Identify and remove garbage/invalid transactions (headers, footers, page numbers, etc.)
2. Normalize merchant names (e.g., "AMZN*MKTP US" → "Amazon Marketplace")
3. Categorize transactions when possible
4. Fix obvious OCR errors in descriptions

Input: Array of transactions with fields: date, posted_date, description, payee, debit, credit, balance, account_id, source_bank, statement_period, ending_balance, inferred_description, metadata, __row_id
Output: JSON object with a single "transactions" array containing cleaned data.
Remove invalid rows. Keep all valid transactions and preserve all fields for rows you return.

Rules:
- Preserve original amounts exactly (do not modify debit/credit/balance values)
- Preserve original dates exactly (date and posted_date)
- Preserve account_id, source_bank, statement_period, ending_balance, inferred_description, and metadata exactly
- Only clean up description and payee text fields
- Keep __row_id unchanged and include it in every transaction you return
- Do not drop any fields from returned transactions
- Remove rows that are clearly not transactions (headers, totals, page numbers)
- If unsure, keep the transaction

Respond with a JSON object containing only the "transactions" array.`;

export async function cleanTransactionsWithLLM(
  transactions: CanonicalTransaction[]
): Promise<CanonicalTransaction[]> {
  // Check if LLM is configured
  if (!ENV.forgeApiKey) {
    console.log("[LLM] OpenAI key not configured, skipping cleanup");
    return transactions;
  }

  if (transactions.length === 0) {
    console.log("[LLM] No transactions to clean");
    return transactions;
  }

  console.log(`[LLM] Sending ${transactions.length} transactions to AI for cleanup`);

  try {
    const llmTransactions = transactions.map((tx, index) => ({
      ...tx,
      __row_id: index,
    }));

    const messages: Message[] = [
      {
        role: "system",
        content: CLEANUP_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: JSON.stringify(llmTransactions, null, 2),
      },
    ];

    const result = await invokeLLM({
      messages,
      responseFormat: { type: "json_object" },
      maxTokens: 16000,
    });

    const responseContent = result.choices?.[0]?.message?.content;
    if (!responseContent) {
      console.error("[LLM] Empty response from AI");
      return transactions;
    }

    // Parse the response
    const contentStr = typeof responseContent === "string"
      ? responseContent
      : JSON.stringify(responseContent);

    let parsed: unknown;
    try {
      parsed = JSON.parse(contentStr);
    } catch (parseError) {
      console.error("[LLM] Failed to parse AI response as JSON:", parseError);
      return transactions;
    }

    // Handle both array and object-wrapped responses
    let cleanedTransactions: unknown[] | undefined;
    if (Array.isArray(parsed)) {
      cleanedTransactions = parsed;
    } else if (parsed && typeof parsed === "object") {
      const parsedObject = parsed as Record<string, unknown>;
      if ("transactions" in parsedObject) {
        if (Array.isArray(parsedObject.transactions)) {
          cleanedTransactions = parsedObject.transactions;
        } else {
          console.error("[LLM] transactions field was not an array");
        }
      } else {
        const arrayEntries = Object.entries(parsedObject).filter(([, value]) =>
          Array.isArray(value)
        );
        if (arrayEntries.length === 1) {
          const [key, value] = arrayEntries[0];
          console.warn(`[LLM] Using array response from key "${key}"`);
          cleanedTransactions = value as unknown[];
        }
      }
    }

    if (!cleanedTransactions) {
      console.error("[LLM] Unexpected response format from AI");
      return transactions;
    }

    // Validate that we got back valid transactions
    if (!Array.isArray(cleanedTransactions)) {
      console.error("[LLM] AI did not return an array of transactions");
      return transactions;
    }

    console.log(`[LLM] OpenAI returned ${cleanedTransactions.length} valid transactions (from ${transactions.length} input)`);

    const usedRowIds = new Set<number>();
    const hasAlignedLengths = cleanedTransactions.length === transactions.length;

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value);

    const matchesBaseTransaction = (
      cleaned: Record<string, unknown>,
      base: CanonicalTransaction
    ): boolean => {
      const hasMatchField = typeof cleaned.date === "string"
        || typeof cleaned.posted_date === "string"
        || typeof cleaned.debit === "number"
        || typeof cleaned.credit === "number"
        || typeof cleaned.balance === "number";
      if (!hasMatchField) {
        return false;
      }
      if (typeof cleaned.date === "string" && base.date !== cleaned.date) {
        return false;
      }
      if (typeof cleaned.posted_date === "string" && base.posted_date !== cleaned.posted_date) {
        return false;
      }
      if (typeof cleaned.debit === "number" && base.debit !== cleaned.debit) {
        return false;
      }
      if (typeof cleaned.credit === "number" && base.credit !== cleaned.credit) {
        return false;
      }
      if (typeof cleaned.balance === "number" && base.balance !== cleaned.balance) {
        return false;
      }
      return true;
    };

    const findBaseTransaction = (
      cleaned: Record<string, unknown>,
      fallbackIndex: number
    ): CanonicalTransaction | null => {
      const rowId = cleaned.__row_id;
      if (typeof rowId === "number" && Number.isInteger(rowId) && rowId >= 0) {
        const base = transactions[rowId];
        if (base) {
          usedRowIds.add(rowId);
          return base;
        }
      }

      for (let i = 0; i < transactions.length; i += 1) {
        if (usedRowIds.has(i)) {
          continue;
        }
        const base = transactions[i];
        if (matchesBaseTransaction(cleaned, base)) {
          usedRowIds.add(i);
          return base;
        }
      }

      if (hasAlignedLengths && fallbackIndex < transactions.length && !usedRowIds.has(fallbackIndex)) {
        usedRowIds.add(fallbackIndex);
        return transactions[fallbackIndex];
      }

      return null;
    };

    // Map back to CanonicalTransaction format, preserving non-text fields
    return cleanedTransactions.map((rawTx: unknown, index) => {
      const cleaned = isRecord(rawTx) ? rawTx : {};
      const base = findBaseTransaction(cleaned, index);
      const cleanedStatementPeriod = isRecord(cleaned.statement_period)
        ? {
          start: typeof cleaned.statement_period.start === "string" ? cleaned.statement_period.start : null,
          end: typeof cleaned.statement_period.end === "string" ? cleaned.statement_period.end : null,
        }
        : null;
      const baseStatementPeriod = base?.statement_period ?? cleanedStatementPeriod ?? { start: null, end: null };
      const cleanedDescription = typeof cleaned.description === "string" && cleaned.description.trim() !== ""
        ? cleaned.description
        : base?.description ?? "";
      const cleanedPayee = typeof cleaned.payee === "string" && cleaned.payee.trim() !== ""
        ? cleaned.payee
        : base?.payee ?? cleanedDescription ?? base?.description ?? "";
      const cleanedMetadata = isRecord(cleaned.metadata) ? cleaned.metadata : {};

      return {
        ...(base ?? {}),
        date: base?.date ?? (typeof cleaned.date === "string" ? cleaned.date : null),
        posted_date: base?.posted_date ?? (typeof cleaned.posted_date === "string" ? cleaned.posted_date : null),
        description: cleanedDescription,
        payee: cleanedPayee,
        debit: base?.debit ?? (typeof cleaned.debit === "number" ? cleaned.debit : 0),
        credit: base?.credit ?? (typeof cleaned.credit === "number" ? cleaned.credit : 0),
        balance: base?.balance ?? (typeof cleaned.balance === "number" ? cleaned.balance : null),
        account_id: base?.account_id ?? (typeof cleaned.account_id === "string" ? cleaned.account_id : null),
        source_bank: base?.source_bank ?? (typeof cleaned.source_bank === "string" ? cleaned.source_bank : null),
        statement_period: baseStatementPeriod,
        ending_balance: base?.ending_balance ?? (typeof cleaned.ending_balance === "number" ? cleaned.ending_balance : null),
        inferred_description: base?.inferred_description ?? (typeof cleaned.inferred_description === "string" ? cleaned.inferred_description : null),
        metadata: {
          ...(base?.metadata ?? {}),
          ...cleanedMetadata,
          llm_cleaned: true,
        },
      } as CanonicalTransaction;
    });

  } catch (error) {
    console.error("[LLM] OpenAI cleanup failed, using unfiltered transactions:", error);
    return transactions;
  }
}

import { invokeLLM, type Message } from "./llm";
import { ENV } from "./env";
import type { CanonicalTransaction } from "@shared/transactions";

const CLEANUP_SYSTEM_PROMPT = `You are a transaction data cleanup assistant. Your job is to:
1. Identify and remove garbage/invalid transactions (headers, footers, page numbers, etc.)
2. Normalize merchant names (e.g., "AMZN*MKTP US" → "Amazon Marketplace")
3. Categorize transactions when possible
4. Fix obvious OCR errors in descriptions

Input: Array of transactions with fields: date, description, payee, debit, credit, balance
Output: Same array structure with cleaned data. Remove invalid rows. Keep all valid transactions.

Rules:
- Preserve original amounts exactly (do not modify debit/credit/balance values)
- Preserve original dates exactly
- Only clean up description and payee text fields
- Remove rows that are clearly not transactions (headers, totals, page numbers)
- If unsure, keep the transaction

Respond with a JSON object containing a "transactions" key with the array of cleaned transactions.
Example: {"transactions": [...]}`;

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
    const messages: Message[] = [
      {
        role: "system",
        content: CLEANUP_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: JSON.stringify(transactions, null, 2),
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
    // LLMs may use different key names for the array
    let cleanedTransactions: unknown[];
    if (Array.isArray(parsed)) {
      cleanedTransactions = parsed;
    } else if (parsed && typeof parsed === "object") {
      // Try common key names that LLMs might use
      const obj = parsed as Record<string, unknown>;
      const possibleKeys = ["transactions", "data", "result", "results", "items", "records"];
      let foundArray: unknown[] | null = null;

      for (const key of possibleKeys) {
        if (key in obj && Array.isArray(obj[key])) {
          foundArray = obj[key] as unknown[];
          break;
        }
      }

      if (foundArray) {
        cleanedTransactions = foundArray;
      } else {
        // Last resort: check if any value is an array
        const values = Object.values(obj);
        const arrayValue = values.find(v => Array.isArray(v));
        if (arrayValue) {
          cleanedTransactions = arrayValue as unknown[];
        } else {
          console.error("[LLM] Unexpected response format from AI - no array found in response");
          return transactions;
        }
      }
    } else {
      console.error("[LLM] Unexpected response format from AI");
      return transactions;
    }

    // Validate that we got back valid transactions
    if (!Array.isArray(cleanedTransactions)) {
      console.error("[LLM] AI did not return an array of transactions");
      return transactions;
    }

    console.log(`[LLM] OpenAI returned ${cleanedTransactions.length} valid transactions (from ${transactions.length} input)`);

    // Map back to CanonicalTransaction format, preserving required fields
    return cleanedTransactions.map((tx: any) => ({
      date: tx.date ?? null,
      posted_date: tx.posted_date ?? tx.date ?? null,
      description: tx.description ?? "",
      payee: tx.payee ?? tx.description ?? "",
      debit: typeof tx.debit === "number" ? tx.debit : 0,
      credit: typeof tx.credit === "number" ? tx.credit : 0,
      balance: tx.balance ?? null,
      account_id: tx.account_id ?? null,
      source_bank: tx.source_bank ?? null,
      statement_period: tx.statement_period ?? { start: null, end: null },
      metadata: {
        ...tx.metadata,
        llm_cleaned: true,
      },
    })) as CanonicalTransaction[];

  } catch (error) {
    console.error("[LLM] OpenAI cleanup failed, using unfiltered transactions:", error);
    return transactions;
  }
}

import { invokeLLM, type InvokeResult } from "./_core/llm";
import { logEvent } from "./_core/log";
import type { CanonicalTransaction } from "@shared/transactions";
import { getQuickbooksHistory } from "./db";

export type CleanupResult = {
  cleaned: CanonicalTransaction[];
  removed: CanonicalTransaction[];
  flagged: CanonicalTransaction[];
};

function isCleanupResult(value: unknown): value is CleanupResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.cleaned) &&
    Array.isArray(v.removed) &&
    Array.isArray(v.flagged)
  );
}

// Optional environment-configurable pricing (USD per 1K tokens)
const INPUT_PRICE_PER_1K = Number(process.env.AI_PRICE_INPUT_PER_1K || 0);
const OUTPUT_PRICE_PER_1K = Number(process.env.AI_PRICE_OUTPUT_PER_1K || 0);

// Optional provider/model override (used by invokeLLM if supported)
const AI_MODEL = process.env.AI_MODEL || undefined;

function estimateCostUsd(usage?: InvokeResult["usage"]): number | null {
  if (!usage) return null;
  if (!INPUT_PRICE_PER_1K && !OUTPUT_PRICE_PER_1K) return null;
  const inputCost = INPUT_PRICE_PER_1K
    ? (usage.prompt_tokens / 1000) * INPUT_PRICE_PER_1K
    : 0;
  const outputCost = OUTPUT_PRICE_PER_1K
    ? (usage.completion_tokens / 1000) * OUTPUT_PRICE_PER_1K
    : 0;
  return Number((inputCost + outputCost).toFixed(6));
}

// Small deterministic standardization helpers to assist/validate the LLM
function heuristicStandardizeMerchant(description: string): string {
  const normalized = description.toUpperCase();
  if (normalized.includes("SHEETZ")) {
    // Extract store number if present (e.g., "SHEETZ 2468")
    const match = description.match(/SHEETZ[^0-9]*([0-9]{2,5})/i);
    const store = match ? ` #${match[1]}` : "";
    // Extract city/state if present
    const cityStateMatch = description.match(/\b([A-Z][A-Za-z]+)\s+([A-Z]{2})\b/);
    const cityState = cityStateMatch ? `, ${cityStateMatch[1]} ${cityStateMatch[2]}` : "";
    return `Sheetz${store}${cityState}`.trim();
  }
  if (normalized.includes("AMAZON") && normalized.includes("SYF")) {
    return "Amazon (Synchrony Payment)";
  }
  return description;
}

function isLikelyBalanceRow(tx: CanonicalTransaction): boolean {
  // Balance rows often have:
  // - Missing date
  // - Description containing "BALANCE" or "SUMMARY"
  // - Amount equals balance, or large round number without counterpart
  const desc = (tx.description || "").toUpperCase();
  if (!tx.date && (desc.includes("BALANCE") || desc.includes("SUMMARY"))) {
    return true;
  }
  // Heuristic: no description and only balance present
  if (!tx.description && tx.balance !== null && tx.debit === 0 && tx.credit === 0) {
    return true;
  }
  // Check for date pattern followed by amount (e.g., "11/07 4,861.07")
  // This is a daily balance summary row, not a transaction
  const dateAmountPattern = /^\d{1,2}\/\d{1,2}\s+[\d,]+\.\d{2}$/;
  if (dateAmountPattern.test(tx.description || "")) {
    return true;
  }
  // Check for address keywords (statement headers/footers)
  const addressKeywords = [
    "SHOPPING CENTER", "ROAD", "STREET", "AVENUE", "AVE", "BLVD", "BOULEVARD",
    "DRIVE", "DR", "LANE", "LN", "CIRCLE", "CIR", "COURT", "CT", "PLACE", "PL",
    "PENN HILLS", "RODI ROAD", "MCKENZIE", "PITTSBURGH", "PA 15235"
  ];
  if (addressKeywords.some(keyword => desc.includes(keyword))) {
    return true;
  }
  return false;
}

export async function cleanTransactions(
  transactions: CanonicalTransaction[],
  userId?: number
): Promise<CleanupResult> {
  // Fetch QuickBooks history if userId is provided
  let qbHistory: any[] = [];
  if (userId !== undefined) {
    qbHistory = await getQuickbooksHistory(userId);
  }

  // Prepare history context for the LLM
  const historyContext = qbHistory.length > 0 
    ? `\n\nUse the following QuickBooks historical categorization as reference (seed data):\n${JSON.stringify(qbHistory.slice(0, 50), null, 2)}`
    : "";
  // Pre-pass: standardize merchants deterministically (helps reduce LLM work and ensures examples)
  const preprocessed = transactions.map(tx => ({
    ...tx,
    payee: tx.payee
      ? heuristicStandardizeMerchant(tx.payee)
      : heuristicStandardizeMerchant(tx.description || ""),
  }));

  // System prompt to enforce strict JSON output according to schema
  const system = [
    "You are a data-cleaning assistant for bank transaction CSVs.",
    "You MUST return only JSON matching the provided schema.",
    "Do not include any extra commentary or markdown.",
  ].join(" ");

  // User instructions with concrete rules and examples
  const user = [
    "Clean this bank transaction data with the following rules:",
    "",
    "1) REMOVE rows that are clearly balance summaries or garbage:",
    "   - No date AND description indicates statement-level balance/summary",
    "   - Rows with only balance value and no meaningful description",
    "   - Description matches date pattern followed by amount (e.g., '11/07 4,861.07') - these are daily balance summaries",
    "   - Description contains address keywords like 'SHOPPING CENTER', 'ROAD', 'STREET', 'PENN HILLS', 'RODI ROAD'",
    "   - Rows with no date but have description/amount (likely header/footer text)",
    "",
    "2) FLAG rows missing dates for manual review (do NOT remove UNLESS they match other removal criteria).",
    "",
    "3) STANDARDIZE merchant names in `payee` when possible:",
    '   - "8433 DBT PURCHASE - 000210 SHEETZ 2468 PITTSBURGH PA" → "Sheetz #2468, Pittsburgh PA"',
    '   - "AMAZON CORP SYF PAYMNT" → "Amazon (Synchrony Payment)"',
    "   Use concise, human-readable names; retain location/store number.",
    "",
    "4) ADD `category` field when QuickBooks history is provided:",
    "   - Match transactions to QuickBooks history by payee/description similarity",
    "   - Use the category from the best matching historical transaction",
    "   - If no match found, leave category empty or null",
    "",
    "5) KEEP all legitimate transactions unchanged.",
    "",
    "Return JSON object with fields: cleaned[], removed[], flagged[].",
    historyContext,
    "",
    "Transactions:",
    JSON.stringify(preprocessed, null, 2),
  ].join("\n");

  // JSON schema for strong-typed output
  const canonicalTransactionSchema: Record<string, unknown> = {
    type: "object",
    additionalProperties: true,
    properties: {
      date: { anyOf: [{ type: "string" }, { type: "null" }] },
      posted_date: { anyOf: [{ type: "string" }, { type: "null" }] },
      description: { type: "string" },
      payee: { anyOf: [{ type: "string" }, { type: "null" }] },
      debit: { type: "number" },
      credit: { type: "number" },
      balance: { anyOf: [{ type: "number" }, { type: "null" }] },
      account_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      source_bank: { anyOf: [{ type: "string" }, { type: "null" }] },
      statement_period: {
        type: "object",
        additionalProperties: false,
        properties: {
          start: { anyOf: [{ type: "string" }, { type: "null" }] },
          end: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["start", "end"],
      },
      ending_balance: { anyOf: [{ type: "number" }, { type: "null" }] },
      inferred_description: { anyOf: [{ type: "string" }, { type: "null" }] },
      category: { anyOf: [{ type: "string" }, { type: "null" }] },
      metadata: { type: "object" },
    },
    required: [
      "date",
      "posted_date",
      "description",
      "payee",
      "debit",
      "credit",
      "balance",
      "account_id",
      "source_bank",
      "statement_period",
    ],
  };

  let response: any = null;
  let usage: InvokeResult["usage"] | undefined = undefined;
  let llmError: string | null = null;

  try {
    response = await invokeLLM({
      model: AI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "CleanupResult",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              cleaned: { type: "array", items: canonicalTransactionSchema },
              removed: { type: "array", items: canonicalTransactionSchema },
              flagged: { type: "array", items: canonicalTransactionSchema },
            },
            required: ["cleaned", "removed", "flagged"],
          },
        },
      },
      maxTokens: 4096,
    });
    usage = response.usage;
  } catch (error) {
    // API failure (network, rate limit, outage, etc.)
    llmError = error instanceof Error ? error.message : String(error);
    logEvent("ai_cleanup_llm_error", {
      error: llmError,
      inputCount: transactions.length,
    });
  }

  const approxCostUsd = estimateCostUsd(usage);

  let result: CleanupResult | null = null;
  let responseParseOrShapeError: { type: "parse_error" | "shape_error"; message: string } | null =
    null;
  if (response) {
    const content = response.choices?.[0]?.message?.content;
    const raw =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map(p => ("text" in p ? p.text : "")).join("\n")
          : "";

    try {
      const parsed: unknown = JSON.parse(raw);
      if (isCleanupResult(parsed)) {
        result = parsed;
      } else {
        result = null;
        responseParseOrShapeError = {
          type: "shape_error",
          message: "LLM response JSON did not match CleanupResult shape",
        };
      }
    } catch (error) {
      result = null;
      responseParseOrShapeError = {
        type: "parse_error",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (responseParseOrShapeError?.type === "parse_error") {
      logEvent("ai_cleanup_parse_error", {
        error: responseParseOrShapeError.message,
        inputCount: transactions.length,
      });
    } else if (responseParseOrShapeError?.type === "shape_error") {
      logEvent("ai_cleanup_shape_error", {
        error: responseParseOrShapeError.message,
        inputCount: transactions.length,
      });
    }
  }

  // Capture fallback state BEFORE running the fallback block so logging is accurate
  const neededDeterministicFallback = !result;
  let fallbackReason: string | null = null;
  if (neededDeterministicFallback) {
    // If the API threw, it's an API error; otherwise, a parse/shape error
    fallbackReason = llmError
      ? "api_error"
      : responseParseOrShapeError?.type === "shape_error"
        ? "shape_error"
        : response
          ? "parse_error"
          : "api_error";
  }

  // Fallback: lightweight deterministic cleanup if LLM failed
  if (!result) {
    const removed: CanonicalTransaction[] = [];
    const flagged: CanonicalTransaction[] = [];
    const cleaned: CanonicalTransaction[] = [];
    for (const tx of preprocessed) {
      // Remove balance rows and garbage first
      if (isLikelyBalanceRow(tx)) {
        removed.push(tx);
        continue;
      }
      // Remove rows without dates (unless they're flagged for review)
      // But if description contains address keywords, remove them instead of flagging
      const desc = (tx.description || "").toUpperCase();
      const addressKeywords = [
        "SHOPPING CENTER", "ROAD", "STREET", "AVENUE", "AVE", "BLVD", "BOULEVARD",
        "DRIVE", "DR", "LANE", "LN", "CIRCLE", "CIR", "COURT", "CT", "PLACE", "PL",
        "PENN HILLS", "RODI ROAD", "MCKENZIE"
      ];
      if (!tx.date) {
        // If it's an address/header row, remove it
        if (addressKeywords.some(keyword => desc.includes(keyword))) {
          removed.push(tx);
          continue;
        }
        // Otherwise flag for review
        flagged.push(tx);
        continue;
      }
      cleaned.push(tx);
    }
    result = { cleaned, removed, flagged };
  }

  const usedDeterministicFallback = neededDeterministicFallback;

  logEvent("ai_cleanup_complete", {
    inputCount: transactions.length,
    cleaned: result.cleaned.length,
    removed: result.removed.length,
    flagged: result.flagged.length,
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
    approxCostUsd,
    usedFallback: usedDeterministicFallback,
    fallbackReason,
  });

  return result;
}

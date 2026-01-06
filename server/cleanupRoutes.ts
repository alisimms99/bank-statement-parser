import type { Express } from "express";
import { z } from "zod";
import type { CanonicalTransaction } from "@shared/transactions";
import { cleanTransactions } from "./aiCleanup";
import { requireAuth, type AuthenticatedRequest } from "./middleware/auth";
import { logEvent } from "./_core/log";

const cleanupRequestSchema = z.object({
  transactions: z.array(
    z.object({
      date: z.string().nullable().optional(),
      posted_date: z.string().nullable().optional(),
      description: z.string().optional(),
      payee: z.string().nullable().optional(),
      debit: z.number().optional(),
      credit: z.number().optional(),
      balance: z.number().nullable().optional(),
      account_id: z.string().nullable().optional(),
      source_bank: z.string().nullable().optional(),
      statement_period: z
        .object({
          start: z.string().nullable(),
          end: z.string().nullable(),
        })
        .optional(),
      ending_balance: z.number().nullable().optional(),
      inferred_description: z.string().nullable().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    })
  ),
});

export function registerCleanupRoutes(app: Express): void {
  /**
   * POST /api/cleanup
   * Accepts parsed transactions and returns cleaned/removed/flagged
   */
  app.post("/api/cleanup", requireAuth, async (req: AuthenticatedRequest, res) => {
    const parsed = cleanupRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body",
        details: parsed.error?.issues,
      });
    }

    try {
      const rawList = parsed.data.transactions;
      // Coerce to CanonicalTransaction shape with safe defaults
      const transactions: CanonicalTransaction[] = rawList.map((tx: any) => ({
        date: tx.date ?? null,
        posted_date: tx.posted_date ?? tx.date ?? null,
        description: tx.description ?? "",
        payee: tx.payee ?? null,
        debit: typeof tx.debit === "number" ? tx.debit : 0,
        credit: typeof tx.credit === "number" ? tx.credit : 0,
        balance: typeof tx.balance === "number" ? tx.balance : null,
        account_id: tx.account_id ?? null,
        source_bank: tx.source_bank ?? null,
        statement_period:
          tx.statement_period ?? {
            start: null,
            end: null,
          },
        ending_balance:
          typeof tx.ending_balance === "number" ? tx.ending_balance : null,
        inferred_description:
          typeof tx.inferred_description === "string"
            ? tx.inferred_description
            : null,
        metadata: tx.metadata ?? {},
      }));

      logEvent("ai_cleanup_start", { count: transactions.length });
      const userId = (req.user as any)?.id as number | undefined;
      const result = await cleanTransactions(transactions, userId);
      return res.json(result);
    } catch (error) {
      console.error("[/api/cleanup] Failed:", error);
      return res.status(500).json({
        error: "Failed to clean transactions",
      });
    }
  });
}


import { Express } from "express";
import { z } from "zod";
import { requireAuth } from "./middleware/auth";
import { 
  getAccounts, createAccount, updateAccount, 
  getImportLogs, checkImportExists 
} from "./db";
import { logEvent } from "./_core/log";

const accountSchema = z.object({
  accountName: z.string().min(1),
  accountLast4: z.string().length(4).optional(),
  accountType: z.enum(["bank", "credit_card"]),
  issuer: z.string().optional(),
});

export function registerAccountRoutes(app: Express) {
  // List user's accounts
  app.get("/api/accounts", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const accounts = await getAccounts(user.id);
      res.json(accounts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  // Create new account
  app.post("/api/accounts", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const parsed = accountSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid account data", details: parsed.error });
      }

      await createAccount({
        ...parsed.data,
        userId: user.id,
      });

      logEvent("account_created", { userId: user.id, accountName: parsed.data.accountName });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to create account" });
    }
  });

  // Update account
  app.patch("/api/accounts/:id", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const id = parseInt(req.params.id);
      const parsed = accountSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid account data", details: parsed.error });
      }

      await updateAccount(id, user.id, parsed.data);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update account" });
    }
  });

  // Soft delete account
  app.delete("/api/accounts/:id", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const id = parseInt(req.params.id);
      await updateAccount(id, user.id, { isActive: 0 });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  // List import history
  app.get("/api/imports", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const logs = await getImportLogs(user.id);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch import logs" });
    }
  });

  // Check if statement already imported
  app.get("/api/imports/check", requireAuth, async (req, res) => {
    try {
      const accountId = parseInt(req.query.account_id as string);
      const period = req.query.period as string;
      
      if (!accountId || !period) {
        return res.status(400).json({ error: "Missing account_id or period" });
      }

      const exists = await checkImportExists(accountId, period);
      res.json({ exists });
    } catch (error) {
      res.status(500).json({ error: "Failed to check import status" });
    }
  });
}

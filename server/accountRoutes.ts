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
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid account id" });
      }
      const parsed = accountSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid account data", details: parsed.error });
      }

      // Verify ownership before update
      const accounts = await getAccounts(user.id);
      const existing = accounts.find((a) => a.id === id);
      if (!existing) {
        return res.status(404).json({ error: "Account not found" });
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
      const id = Number.parseInt(req.params.id, 10);
      if (Number.isNaN(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid account id" });
      }
      // Verify ownership before delete
      const accounts = await getAccounts(user.id);
      const existing = accounts.find((a) => a.id === id);
      if (!existing) {
        return res.status(404).json({ error: "Account not found" });
      }
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
      const user = (req as any).user;
      const accountId = Number.parseInt(req.query.account_id as string, 10);
      const period = req.query.period as string;
      
      if (Number.isNaN(accountId) || !period) {
        return res.status(400).json({ error: "Missing account_id or period" });
      }

      // Ensure the account belongs to the authenticated user
      const accounts = await getAccounts(user.id);
      const owned = accounts.some((a) => a.id === accountId);
      if (!owned) {
        return res.status(404).json({ error: "Account not found" });
      }

      const exists = await checkImportExists(accountId, period);
      res.json({ exists });
    } catch (error) {
      res.status(500).json({ error: "Failed to check import status" });
    }
  });
}

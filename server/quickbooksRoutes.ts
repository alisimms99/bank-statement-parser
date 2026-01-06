import { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "./middleware/auth";
import { storeQuickbooksHistory, getUserByOpenId } from "./db";
import { logEvent } from "./_core/log";

const upload = multer({ storage: multer.memoryStorage() });

const quickbooksEntrySchema = z.object({
  date: z.string(),
  description: z.string(),
  payee: z.string().optional(),
  category: z.string(),
  amount: z.string(),
});

const quickbooksUploadSchema = z.array(quickbooksEntrySchema);

export function registerQuickbooksRoutes(app: Express) {
  app.post("/api/quickbooks/upload", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user || !user.id) {
        // Database user.id is required for storing QuickBooks history
        // This can occur when the database is unavailable or user data is malformed
        return res.status(503).json({ 
          error: "User database record required for QuickBooks operations." 
        });
      let userId: number | undefined = user?.id;
      if (!userId && user?.openId) {
        const dbUser = await getUserByOpenId(user.openId);
        userId = dbUser?.id as number | undefined;
      }
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const parsed = quickbooksUploadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid QuickBooks data format", details: parsed.error });
      }

      const entries = parsed.data.map(entry => ({
        ...entry,
        userId,
      }));

      await storeQuickbooksHistory(entries);

      logEvent("quickbooks_upload_success", {
        userId,
        entryCount: entries.length,
      });

      res.json({ success: true, count: entries.length });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logEvent("quickbooks_upload_failure", { error: errorMessage }, "error");
      res.status(500).json({ error: errorMessage });
    }
  });
}

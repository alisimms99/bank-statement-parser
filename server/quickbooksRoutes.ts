import { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "./middleware/auth";
import { storeQuickbooksHistory } from "./db";
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
        // This occurs when the database is unavailable and only session data is available
        return res.status(500).json({ 
          error: "Database unavailable. Cannot store QuickBooks history without user database record." 
        });
      }

      const parsed = quickbooksUploadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid QuickBooks data format", details: parsed.error });
      }

      const entries = parsed.data.map(entry => ({
        ...entry,
        userId: user.id,
      }));

      await storeQuickbooksHistory(entries);

      logEvent("quickbooks_upload_success", {
        userId: user.id,
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

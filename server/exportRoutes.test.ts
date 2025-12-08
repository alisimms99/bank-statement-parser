import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { registerExportRoutes, storeTransactions, getStoredTransactions } from "./exportRoutes";
import type { CanonicalTransaction } from "@shared/transactions";
import { recordExportEvent } from "./_core/exportMetrics";

vi.mock("./_core/exportMetrics", () => ({
  recordExportEvent: vi.fn(),
}));

describe("exportRoutes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("GET /api/export/:id/csv", () => {
    beforeEach(() => {
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("exports CSV successfully with valid export ID", async () => {
      const sampleTransactions: CanonicalTransaction[] = [
        {
          date: "2024-01-05",
          posted_date: "2024-01-05",
          description: "Test Transaction",
          payee: "Test Payee",
          debit: 100.0,
          credit: 0,
          balance: 1000.0,
          account_id: null,
          source_bank: null,
          statement_period: { start: null, end: null },
          metadata: {},
        },
      ];

      const exportId = storeTransactions(sampleTransactions);

      const app = express();
      registerExportRoutes(app);

      const res = await request(app).get(`/api/export/${exportId}/csv`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment");
      expect(res.text).toContain("Date,Description,Payee,Debit,Credit,Balance,Memo");
      expect(res.text).toContain("Test Transaction");
      
      expect(recordExportEvent).toHaveBeenCalledWith({
        exportId,
        format: "csv",
        transactionCount: 1,
        timestamp: expect.any(Number),
        success: true,
      });
    });

    it("returns 410 for expired export", async () => {
      const sampleTransactions: CanonicalTransaction[] = [
        {
          date: "2024-01-05",
          posted_date: "2024-01-05",
          description: "Test Transaction",
          payee: "Test Payee",
          debit: 100.0,
          credit: 0,
          balance: 1000.0,
          account_id: null,
          source_bank: null,
          statement_period: { start: null, end: null },
          metadata: {},
        },
      ];

      const exportId = storeTransactions(sampleTransactions);
      
      // Advance system time past TTL (1 hour + 1 minute)
      vi.setSystemTime(new Date("2024-01-01T01:01:00Z"));

      const app = express();
      registerExportRoutes(app);

      const res = await request(app).get(`/api/export/${exportId}/csv`);

      expect(res.status).toBe(410);
      expect(res.body.error).toBe("Export expired");
      
      expect(recordExportEvent).toHaveBeenCalledWith({
        exportId,
        format: "csv",
        transactionCount: 0,
        timestamp: expect.any(Number),
        success: false,
        error: "Export expired",
      });
    });

    it("returns 404 for invalid export ID", async () => {
      const app = express();
      registerExportRoutes(app);

      const res = await request(app).get("/api/export/invalid-id/csv");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Export not found");
      
      expect(recordExportEvent).toHaveBeenCalledWith({
        exportId: "invalid-id",
        format: "csv",
        transactionCount: 0,
        timestamp: expect.any(Number),
        success: false,
        error: "Export not found",
      });
    });

    it("includes BOM when bom query parameter is true", async () => {
      const sampleTransactions: CanonicalTransaction[] = [
        {
          date: "2024-01-05",
          posted_date: "2024-01-05",
          description: "Test Transaction",
          payee: "Test Payee",
          debit: 100.0,
          credit: 0,
          balance: 1000.0,
          account_id: null,
          source_bank: null,
          statement_period: { start: null, end: null },
          metadata: {},
        },
      ];

      const exportId = storeTransactions(sampleTransactions);

      const app = express();
      registerExportRoutes(app);

      const res = await request(app).get(`/api/export/${exportId}/csv?bom=true`);

      expect(res.status).toBe(200);
      // BOM is \uFEFF (UTF-8 BOM)
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
    });
  });

  describe("GET /api/export/:id/pdf", () => {
    beforeEach(() => {
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("exports PDF successfully with valid export ID", async () => {
      const sampleTransactions: CanonicalTransaction[] = [
        {
          date: "2024-01-05",
          posted_date: "2024-01-05",
          description: "Test Transaction",
          payee: "Test Payee",
          debit: 100.0,
          credit: 0,
          balance: 1000.0,
          account_id: null,
          source_bank: null,
          statement_period: { start: null, end: null },
          metadata: {},
        },
      ];

      const exportId = storeTransactions(sampleTransactions);

      const app = express();
      registerExportRoutes(app);

      const res = await request(app).get(`/api/export/${exportId}/pdf`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["content-disposition"]).toContain("attachment");
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect(res.body.toString()).toContain("%PDF-1.4");
      
      expect(recordExportEvent).toHaveBeenCalledWith({
        exportId,
        format: "pdf",
        transactionCount: 1,
        timestamp: expect.any(Number),
        success: true,
      });
    });

    it("returns 410 for expired export", async () => {
      const sampleTransactions: CanonicalTransaction[] = [
        {
          date: "2024-01-05",
          posted_date: "2024-01-05",
          description: "Test Transaction",
          payee: "Test Payee",
          debit: 100.0,
          credit: 0,
          balance: 1000.0,
          account_id: null,
          source_bank: null,
          statement_period: { start: null, end: null },
          metadata: {},
        },
      ];

      const exportId = storeTransactions(sampleTransactions);
      
      // Advance system time past TTL (1 hour + 1 minute)
      vi.setSystemTime(new Date("2024-01-01T01:01:00Z"));

      const app = express();
      registerExportRoutes(app);

      const res = await request(app).get(`/api/export/${exportId}/pdf`);

      expect(res.status).toBe(410);
      expect(res.body.error).toBe("Export expired");
      
      expect(recordExportEvent).toHaveBeenCalledWith({
        exportId,
        format: "pdf",
        transactionCount: 0,
        timestamp: expect.any(Number),
        success: false,
        error: "Export expired",
      });
    });

    it("returns 404 for invalid export ID", async () => {
      const app = express();
      registerExportRoutes(app);

      const res = await request(app).get("/api/export/invalid-id/pdf");

      // Invalid ID (not expired) returns 404, not 410
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Export not found");
      
      expect(recordExportEvent).toHaveBeenCalledWith({
        exportId: "invalid-id",
        format: "pdf",
        transactionCount: 0,
        timestamp: expect.any(Number),
        success: false,
        error: "Export not found",
      });
    });
  });

  describe("getStoredTransactions", () => {
    beforeEach(() => {
      vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retrieves stored transactions successfully", () => {
      const sampleTransactions: CanonicalTransaction[] = [
        {
          date: "2024-01-05",
          posted_date: "2024-01-05",
          description: "Test Transaction",
          payee: "Test Payee",
          debit: 100.0,
          credit: 0,
          balance: 1000.0,
          account_id: null,
          source_bank: null,
          statement_period: { start: null, end: null },
          metadata: {},
        },
      ];

      const exportId = storeTransactions(sampleTransactions);
      const retrieved = getStoredTransactions(exportId);

      expect(retrieved).toEqual(sampleTransactions);
    });

    it("returns null for expired transactions", () => {
      const sampleTransactions: CanonicalTransaction[] = [
        {
          date: "2024-01-05",
          posted_date: "2024-01-05",
          description: "Test Transaction",
          payee: "Test Payee",
          debit: 100.0,
          credit: 0,
          balance: 1000.0,
          account_id: null,
          source_bank: null,
          statement_period: { start: null, end: null },
          metadata: {},
        },
      ];

      const exportId = storeTransactions(sampleTransactions);
      
      // Advance system time past TTL (1 hour + 1 minute)
      vi.setSystemTime(new Date("2024-01-01T01:01:00Z"));
      
      const retrieved = getStoredTransactions(exportId);
      expect(retrieved).toBeNull();
    });
  });
});

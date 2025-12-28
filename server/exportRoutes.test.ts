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
          description: "First Transaction",
          payee: "Test Payee",
          debit: 100.0,
          credit: 0,
          balance: 1000.0,
          account_id: null,
          source_bank: null,
          statement_period: { start: null, end: null },
          inferred_description: "Inferred First",
          metadata: {
            edited: true,
            edited_at: "2024-01-05T12:00:00Z",
          },
        },
        {
          date: "2024-01-06",
          posted_date: "2024-01-06",
          description: "Second Transaction",
          payee: "Test Payee",
          debit: 0,
          credit: 50.0,
          balance: 1050.0,
          account_id: null,
          source_bank: null,
          statement_period: { start: null, end: null },
          inferred_description: null,
          metadata: {
            edited: false,
            edited_at: null,
          },
        },
        {
          date: "2024-01-07",
          posted_date: "2024-01-07",
          description: "Last Transaction",
          payee: "Test Payee",
          debit: 10.0,
          credit: 0,
          balance: 1040.0,
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
      const [header, row1, row2, row3] = res.text.trim().split("\n");
      expect(header).toBe(
        "date,description,amount,balance,metadata_edited,metadata_edited_at,ending_balance,inferred_description",
      );

      // Validate new export columns & null -> empty string behavior
      expect(row1).toBe(
        "2024-01-05,First Transaction,-100.00,1000.00,true,2024-01-05T12:00:00Z,,Inferred First",
      );
      expect(row2).toBe(
        "2024-01-06,Second Transaction,50.00,1050.00,false,,,Second Transaction",
      );
      // ending_balance is computed only for last row
      expect(row3).toBe(
        "2024-01-07,Last Transaction,-10.00,1040.00,,,1040.00,Last Transaction",
      );
      
      expect(recordExportEvent).toHaveBeenCalledWith({
        exportId,
        format: "csv",
        transactionCount: 3,
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

    it("generates a PDF with correct stream /Length (byte-accurate)", async () => {
      // `generateStubPDF()` only uses `transactions.length`, so we can repeat the same object.
      const tx = {
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
      } satisfies CanonicalTransaction;

      const manyTransactions: CanonicalTransaction[] = new Array(10_000).fill(tx);
      const exportId = storeTransactions(manyTransactions);

      const app = express();
      registerExportRoutes(app);

      const res = await request(app).get(`/api/export/${exportId}/pdf`);
      expect(res.status).toBe(200);

      const pdf = res.body.toString("utf8");
      const match = pdf.match(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream\nendobj/);
      expect(match).not.toBeNull();

      const declaredLength = Number(match![1]);
      const streamBytes = Buffer.byteLength(match![2], "utf8");
      expect(declaredLength).toBe(streamBytes);
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

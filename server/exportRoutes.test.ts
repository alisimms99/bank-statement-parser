import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { registerExportRoutes, storeTransactions } from "./exportRoutes";
import type { CanonicalTransaction } from "@shared/transactions";
import { exportEventStore } from "./exportEventStore";

describe("registerExportRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportEventStore.clear();
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

    const events = exportEventStore.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ exportId, format: "csv", status: "success" });
  });

  it("returns 404 for invalid export ID", async () => {
    const app = express();
    registerExportRoutes(app);

    const res = await request(app).get("/api/export/invalid-id/csv");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Export not found or expired");
    const events = exportEventStore.getEvents();
    expect(events).toEqual([
      expect.objectContaining({ exportId: "invalid-id", format: "csv", status: "expired" }),
    ]);
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

  it("returns stub PDF with appropriate headers", async () => {
    const sampleTransactions: CanonicalTransaction[] = [
      {
        date: "2024-01-05",
        posted_date: "2024-01-05",
        description: "PDF Transaction",
        payee: "Test Payee",
        debit: 50.0,
        credit: 0,
        balance: 950.0,
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
    const pdfText = res.text || res.body.toString("utf-8");
    expect(pdfText).toContain("PDF Export Stub");

    const events = exportEventStore.getEvents();
    expect(events).toContainEqual(
      expect.objectContaining({ exportId, format: "pdf", status: "success" }),
    );
  });
});

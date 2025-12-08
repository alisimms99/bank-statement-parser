import express from "express";
import request from "supertest";
import { describe, expect, it, beforeEach } from "vitest";

import { registerExportRoutes } from "./exportRoutes";
import type { NormalizedTransaction } from "@shared/types";

const sampleTransactions: NormalizedTransaction[] = [
  {
    date: "2024-01-10",
    posted_date: "2024-01-10",
    description: "Coffee Shop",
    payee: "Local Coffee",
    debit: 5.5,
    credit: 0,
    balance: 994.5,
    account_id: "1234",
    source_bank: "Citizens Bank",
    statement_period: { start: null, end: null },
    metadata: {},
  },
  {
    date: "2024-01-11",
    posted_date: "2024-01-11",
    description: "Paycheck",
    payee: "Employer Inc",
    debit: 0,
    credit: 2500,
    balance: 3494.5,
    account_id: "1234",
    source_bank: "Citizens Bank",
    statement_period: { start: null, end: null },
    metadata: {},
  },
];

describe("Export Routes", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    registerExportRoutes(app);
  });

  describe("POST /api/export", () => {
    it("stores transactions and returns an ID", async () => {
      const res = await request(app)
        .post("/api/export")
        .send({ transactions: sampleTransactions });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("id");
      expect(typeof res.body.id).toBe("string");
      expect(res.body.id.length).toBeGreaterThan(0);
    });

    it("rejects empty transactions array", async () => {
      const res = await request(app)
        .post("/api/export")
        .send({ transactions: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid or empty");
    });

    it("rejects invalid payload", async () => {
      const res = await request(app)
        .post("/api/export")
        .send({ transactions: "invalid" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid or empty");
    });
  });

  describe("GET /api/export/:id", () => {
    it("generates CSV for valid ID", async () => {
      // First store the transactions
      const storeRes = await request(app)
        .post("/api/export")
        .send({ transactions: sampleTransactions });

      const { id } = storeRes.body;

      // Then retrieve the CSV
      const exportRes = await request(app).get(`/api/export/${id}`);

      expect(exportRes.status).toBe(200);
      expect(exportRes.headers["content-type"]).toContain("text/csv");
      expect(exportRes.headers["content-disposition"]).toContain("attachment");
      expect(exportRes.text).toContain("Date,Description,Payee,Debit,Credit,Balance,Memo");
      expect(exportRes.text).toContain("01/10/2024");
      expect(exportRes.text).toContain("Coffee Shop");
      expect(exportRes.text).toContain("5.50");
    });

    it("includes BOM when requested", async () => {
      const storeRes = await request(app)
        .post("/api/export")
        .send({ transactions: sampleTransactions });

      const { id } = storeRes.body;

      const exportRes = await request(app).get(`/api/export/${id}?includeBOM=true`);

      expect(exportRes.status).toBe(200);
      expect(exportRes.text).toMatch(/^\uFEFF/);
    });

    it("returns 404 for non-existent ID", async () => {
      const res = await request(app).get("/api/export/nonexistent-id");

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found or expired");
    });

    it("handles DocAI-parsed transactions", async () => {
      const docAITransactions: NormalizedTransaction[] = [
        {
          date: "2024-02-15",
          posted_date: "2024-02-15",
          description: "Amazon Purchase",
          payee: "Amazon.com",
          debit: 49.99,
          credit: 0,
          balance: 1950.01,
          account_id: "5678",
          source_bank: "Citizens Bank",
          statement_period: { start: "2024-02-01", end: "2024-02-28" },
          metadata: { source: "documentai" },
        },
      ];

      const storeRes = await request(app)
        .post("/api/export")
        .send({ transactions: docAITransactions });

      const { id } = storeRes.body;
      const exportRes = await request(app).get(`/api/export/${id}`);

      expect(exportRes.status).toBe(200);
      expect(exportRes.text).toContain("Amazon Purchase");
      expect(exportRes.text).toContain("49.99");
    });

    it("handles legacy-parsed transactions", async () => {
      const legacyTransactions: NormalizedTransaction[] = [
        {
          date: "2024-03-20",
          posted_date: "2024-03-20",
          description: "Gas Station",
          payee: "Shell",
          debit: 45.00,
          credit: 0,
          balance: null,
          account_id: null,
          source_bank: null,
          statement_period: { start: null, end: null },
          metadata: { source: "legacy" },
        },
      ];

      const storeRes = await request(app)
        .post("/api/export")
        .send({ transactions: legacyTransactions });

      const { id } = storeRes.body;
      const exportRes = await request(app).get(`/api/export/${id}`);

      expect(exportRes.status).toBe(200);
      expect(exportRes.text).toContain("Gas Station");
      expect(exportRes.text).toContain("45.00");
    });
  });
});

import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { registerIngestionRoutes } from "./ingestRoutes";
import type { CanonicalDocument } from "@shared/transactions";
import { sampleCanonicalTransactions } from "../fixtures/transactions";
import { processWithDocumentAI } from "./_core/documentAIClient";
import { getDocumentAiConfig } from "./_core/env";

vi.mock("./_core/documentAIClient", () => ({
  processWithDocumentAI: vi.fn(),
}));

vi.mock("./_core/env", () => ({
  getDocumentAiConfig: vi.fn(() => ({
    enabled: true,
    ready: true,
    credentials: { client_email: "test", private_key: "key" },
    projectId: "project",
    location: "us",
    processors: { bank: "bank" },
    missing: [],
  })),
}));

vi.mock("../client/src/lib/pdfParser", () => ({
  parseStatementText: vi.fn(() => [
    { date: "01/10/2024", description: "Fallback Debit", amount: "-20.00" },
    { date: "01/11/2024", description: "Fallback Credit", amount: "+10.00" },
  ]),
  legacyTransactionsToCanonical: vi.fn((tx: any[]) =>
    tx.map(item => ({
      date: "2024-01-10",
      posted_date: "2024-01-10",
      description: item.description,
      payee: item.description,
      debit: item.amount.startsWith("-") ? 20 : 0,
      credit: item.amount.startsWith("-") ? 0 : 10,
      balance: null,
      account_id: null,
      source_bank: null,
      statement_period: { start: null, end: null },
      metadata: {},
    }))
  ),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn(async () => ({
        getTextContent: vi.fn(async () => ({ items: [{ str: "Synthetic PDF text" }] })),
      })),
    }),
  })),
}));

const processMock = processWithDocumentAI as unknown as vi.Mock;
const envMock = getDocumentAiConfig as unknown as vi.Mock;

const sampleDocument: CanonicalDocument = {
  documentType: "bank_statement",
  transactions: sampleCanonicalTransactions,
  rawText: "document ai text",
};

describe("registerIngestionRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns Document AI results when enabled and successful", async () => {
    processMock.mockResolvedValue(sampleDocument);

    const app = express();
    app.use(express.json());
    registerIngestionRoutes(app);

    const res = await request(app)
      .post("/api/ingest")
      .field("documentType", "bank_statement")
      .attach("file", Buffer.from("fake"), "statement.pdf");

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("documentai");
    expect(res.body.document.transactions).toHaveLength(sampleCanonicalTransactions.length);
    expect(processMock).toHaveBeenCalled();
  });

  it("falls back to legacy when Document AI fails", async () => {
    processMock.mockResolvedValue(null);

    const app = express();
    app.use(express.json());
    registerIngestionRoutes(app);

    const res = await request(app)
      .post("/api/ingest")
      .field("documentType", "bank_statement")
      .attach("file", Buffer.from("fake"), "statement.pdf");

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("legacy");
    expect(res.body.fallback).toBe("failed");
    expect(res.body.document.transactions).toHaveLength(2);
  });

  it("uses legacy-only mode when Document AI is disabled", async () => {
    envMock.mockReturnValue({
      enabled: false,
      ready: false,
      credentials: null,
      projectId: "",
      location: "",
      processors: {},
      missing: ["enable"],
    });
    processMock.mockResolvedValue(null);

    const app = express();
    app.use(express.json());
    registerIngestionRoutes(app);

    const res = await request(app)
      .post("/api/ingest")
      .field("documentType", "bank_statement")
      .attach("file", Buffer.from("fake"), "statement.pdf");

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("legacy");
    expect(res.body.fallback).toBe("disabled");
  });
});

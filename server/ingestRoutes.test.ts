import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { registerIngestionRoutes } from "./ingestRoutes";
import type { CanonicalDocument } from "@shared/transactions";
import { sampleCanonicalTransactions } from "../fixtures/transactions";
import { processWithDocumentAI, processWithDocumentAIStructured } from "./_core/documentAIClient";
import { getDocumentAiConfig } from "./_core/env";

vi.mock("./_core/documentAIClient", () => ({
  processWithDocumentAI: vi.fn(),
  processWithDocumentAIStructured: vi.fn(),
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

vi.mock("./_core/pdfText", () => ({
  extractTextFromPDFBuffer: vi.fn(async () => "Synthetic PDF text"),
}));

const processMock = processWithDocumentAI as unknown as vi.Mock;
const processStructuredMock = processWithDocumentAIStructured as unknown as vi.Mock;
const envMock = getDocumentAiConfig as unknown as vi.Mock;

const sampleDocument: CanonicalDocument = {
  documentType: "bank_statement",
  transactions: sampleCanonicalTransactions,
  rawText: "document ai text",
};

const sampleTelemetry = {
  enabled: true,
  processor: "bank",
  latencyMs: 150,
  entityCount: 3,
};

describe("registerIngestionRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env mock to default (enabled: true)
    envMock.mockReturnValue({
      enabled: true,
      ready: true,
      credentials: { client_email: "test", private_key: "key" },
      projectId: "project",
      location: "us",
      processors: { bank: "bank" },
      missing: [],
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns Document AI results when enabled and successful", async () => {
    processMock.mockResolvedValue({ document: sampleDocument, telemetry: sampleTelemetry });
    processStructuredMock.mockResolvedValue({
      success: true,
      document: sampleDocument,
      processorId: "test-processor-id",
      processorType: "bank",
    });

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
    expect(res.body.docAiTelemetry).toBeDefined();
    expect(res.body.docAiTelemetry.enabled).toBe(true);
    expect(res.body.docAiTelemetry.processor).toBe("test-processor-id");
    expect(processStructuredMock).toHaveBeenCalled();
  });

  it("falls back to legacy when Document AI fails", async () => {
    processStructuredMock.mockResolvedValue({
      success: false,
      error: {
        code: "processing_error",
        message: "Document AI processing failed",
        processorId: "test-processor-id",
      },
    });

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
    expect(Array.isArray(res.body.document.transactions)).toBe(true);
    expect(res.body.docAiTelemetry).toBeDefined();
    expect(res.body.docAiTelemetry.enabled).toBe(true);
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
    processStructuredMock.mockResolvedValue({
      success: false,
      error: {
        code: "disabled",
        message: "Document AI is disabled",
      },
    });

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
    expect(res.body.docAiTelemetry).toEqual({ enabled: false, processor: null, latencyMs: null, entityCount: 0 });
  });

  describe("POST /api/ingest/bulk", () => {
    it("should process multiple files", async () => {
      const pdfBase64 = Buffer.from("%PDF-1.4 test").toString("base64");
      processStructuredMock.mockResolvedValue({
        success: true,
        document: sampleDocument,
        processorId: "test-processor-id",
        processorType: "bank",
      });

      const app = express();
      app.use(express.json());
      registerIngestionRoutes(app);

      const res = await request(app).post("/api/ingest/bulk").send({
        files: [
          { fileName: "statement-2024-01.pdf", contentBase64: pdfBase64 },
          { fileName: "statement-2024-02.pdf", contentBase64: pdfBase64 },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.body.totalFiles).toBe(2);
      expect(res.body.results).toHaveLength(2);
      expect(res.body.batchId).toBeDefined();
      expect(res.body.successful).toBeGreaterThanOrEqual(0);
      expect(res.body.failed).toBeGreaterThanOrEqual(0);
    });

    it("should reject more than 60 files", async () => {
      const files = Array(61).fill({
        fileName: "test.pdf",
        contentBase64: Buffer.from("%PDF").toString("base64"),
      });

      const app = express();
      app.use(express.json());
      registerIngestionRoutes(app);

      const res = await request(app).post("/api/ingest/bulk").send({ files });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Too many files");
      expect(res.body.received).toBe(61);
    });

    it("should handle partial failures gracefully", async () => {
      // First file succeeds, second fails
      processStructuredMock
        .mockResolvedValueOnce({
          success: true,
          document: sampleDocument,
          processorId: "test-processor-id",
          processorType: "bank",
        })
        .mockRejectedValueOnce(new Error("Processing failed"));

      const app = express();
      app.use(express.json());
      registerIngestionRoutes(app);

      const res = await request(app).post("/api/ingest/bulk").send({
        files: [
          { fileName: "good.pdf", contentBase64: Buffer.from("%PDF-1.4").toString("base64") },
          { fileName: "bad.pdf", contentBase64: "not-valid-base64!" },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.body.totalFiles).toBe(2);
      expect(res.body.results).toHaveLength(2);
      expect(res.body.successful).toBeGreaterThanOrEqual(0);
      expect(res.body.failed).toBeGreaterThanOrEqual(0);
      // At least one should have an error status
      const hasError = res.body.results.some((r: { status: string }) => r.status === "error");
      expect(hasError).toBe(true);
    });

    it("should reject empty files array", async () => {
      const app = express();
      app.use(express.json());
      registerIngestionRoutes(app);

      const res = await request(app).post("/api/ingest/bulk").send({ files: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("should extract month and year from filenames", async () => {
      const pdfBase64 = Buffer.from("%PDF-1.4 test").toString("base64");
      processStructuredMock.mockResolvedValue({
        success: true,
        document: sampleDocument,
        processorId: "test-processor-id",
        processorType: "bank",
      });

      const app = express();
      app.use(express.json());
      registerIngestionRoutes(app);

      const res = await request(app).post("/api/ingest/bulk").send({
        files: [
          { fileName: "statement-2024-03.pdf", contentBase64: pdfBase64 },
          { fileName: "statement-2024-12.pdf", contentBase64: pdfBase64 },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.body.results[0].month).toBeDefined();
      expect(res.body.results[0].year).toBeDefined();
      expect(res.body.results[1].month).toBeDefined();
      expect(res.body.results[1].year).toBeDefined();
    });

    it("should not extract invalid numeric months from filenames", async () => {
      const pdfBase64 = Buffer.from("%PDF-1.4 test").toString("base64");
      processStructuredMock.mockResolvedValue({
        success: true,
        document: sampleDocument,
        processorId: "test-processor-id",
        processorType: "bank",
      });

      const app = express();
      app.use(express.json());
      registerIngestionRoutes(app);

      const res = await request(app).post("/api/ingest/bulk").send({
        files: [
          { fileName: "report-99-summary.pdf", contentBase64: pdfBase64 },
          { fileName: "invoice-50-data.pdf", contentBase64: pdfBase64 },
          { fileName: "statement-2024-13.pdf", contentBase64: pdfBase64 },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(3);
      // Months should be empty strings for invalid numeric values
      expect(res.body.results[0].month).toBe("");
      expect(res.body.results[1].month).toBe("");
      expect(res.body.results[2].month).toBe("");
    });
  });
});

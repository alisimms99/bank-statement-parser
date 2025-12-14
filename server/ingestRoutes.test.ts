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

  describe("bulk ingestion", () => {
    it("returns 400 when no files are provided", async () => {
      const app = express();
      app.use(express.json());
      registerIngestionRoutes(app);

      const res = await request(app).post("/api/ingest/bulk");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("No files provided");
    });

    it("returns 400 when fewer than 12 files are provided", async () => {
      const app = express();
      app.use(express.json());
      registerIngestionRoutes(app);

      const agent = request(app).post("/api/ingest/bulk");

      // Attach only 5 files
      for (let i = 0; i < 5; i++) {
        agent.attach("files", Buffer.from("fake"), `statement-${i}.pdf`);
      }

      const res = await agent;

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Insufficient files");
    });

    it("processes multiple PDFs successfully", async () => {
      processStructuredMock.mockResolvedValue({
        success: true,
        document: sampleDocument,
        processorId: "test-processor-id",
        processorType: "bank",
      });

      const app = express();
      app.use(express.json());
      registerIngestionRoutes(app);

      const agent = request(app).post("/api/ingest/bulk").field("documentType", "bank_statement");

      // Attach 12 files
      for (let i = 0; i < 12; i++) {
        agent.attach("files", Buffer.from("fake"), `statement-${i}.pdf`);
      }

      const res = await agent;

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.results).toHaveLength(12);
      expect(res.body.summary.total).toBe(12);
      expect(res.body.summary.successful).toBe(12);
      expect(res.body.summary.failed).toBe(0);

      // Verify each result has the expected structure
      res.body.results.forEach((result: any) => {
        expect(result).toHaveProperty("exportId");
        expect(result).toHaveProperty("transactions");
        expect(result).toHaveProperty("fileName");
        expect(result.success).toBe(true);
      });
    });

    it("processes PDFs with legacy fallback", async () => {
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

      const agent = request(app).post("/api/ingest/bulk").field("documentType", "bank_statement");

      // Attach 12 files
      for (let i = 0; i < 12; i++) {
        agent.attach("files", Buffer.from("fake"), `statement-${i}.pdf`);
      }

      const res = await agent;

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.results).toHaveLength(12);
      expect(res.body.summary.total).toBe(12);

      // Results should still succeed even with legacy fallback
      res.body.results.forEach((result: any) => {
        expect(result.success).toBe(true);
        expect(result).toHaveProperty("exportId");
      });
    });

    it("returns isolated export IDs for each statement", async () => {
      processStructuredMock.mockResolvedValue({
        success: true,
        document: sampleDocument,
        processorId: "test-processor-id",
        processorType: "bank",
      });

      const app = express();
      app.use(express.json());
      registerIngestionRoutes(app);

      const agent = request(app).post("/api/ingest/bulk").field("documentType", "bank_statement");

      // Attach 12 files
      for (let i = 0; i < 12; i++) {
        agent.attach("files", Buffer.from("fake"), `statement-${i}.pdf`);
      }

      const res = await agent;

      expect(res.status).toBe(200);

      // Verify all export IDs are unique
      const exportIds = res.body.results.map((r: any) => r.exportId).filter(Boolean);
      const uniqueExportIds = new Set(exportIds);
      expect(uniqueExportIds.size).toBe(exportIds.length);
    });
  });
});

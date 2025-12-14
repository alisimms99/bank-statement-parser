/**
 * Performance Stress Tests for Large Bank Statements
 * 
 * Tests ingestion performance with synthetic PDFs containing:
 * - 500 transactions
 * - 1,000 transactions
 * - 5,000 transactions
 * 
 * Measures:
 * - CPU usage (via process metrics)
 * - Memory usage (heap size)
 * - Latency (ingestion duration)
 * - Cold start effects
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { registerIngestionRoutes } from "../ingestRoutes";
import { generateSyntheticPDF } from "./generateSyntheticPDF";
import { getDocumentAiConfig } from "../_core/env";
import { processWithDocumentAIStructured } from "../_core/documentAIClient";

// Mock Document AI to avoid external API calls during performance testing
vi.mock("../_core/documentAIClient", () => ({
  processWithDocumentAI: vi.fn(),
  processWithDocumentAIStructured: vi.fn(),
}));

vi.mock("../_core/env", () => ({
  getDocumentAiConfig: vi.fn(() => ({
    enabled: false, // Test legacy parser performance
    ready: false,
    credentials: null,
    projectId: "",
    location: "",
    processors: {},
    missing: ["enable"],
  })),
}));

interface PerformanceMetrics {
  transactionCount: number;
  pdfSizeBytes: number;
  durationMs: number;
  memoryUsageMB: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpuUsage: {
    user: number;
    system: number;
  };
  success: boolean;
  extractedTransactions: number;
}

/**
 * Captures process metrics before and after operation
 */
function captureMetrics(startCpu: NodeJS.CpuUsage, startMem: NodeJS.MemoryUsage): {
  cpuUsage: { user: number; system: number };
  memoryUsageMB: { heapUsed: number; heapTotal: number; external: number; rss: number };
} {
  const endCpu = process.cpuUsage(startCpu);
  const endMem = process.memoryUsage();

  return {
    cpuUsage: {
      user: endCpu.user / 1000, // Convert to milliseconds
      system: endCpu.system / 1000,
    },
    memoryUsageMB: {
      heapUsed: Math.round(endMem.heapUsed / 1024 / 1024 * 100) / 100,
      heapTotal: Math.round(endMem.heapTotal / 1024 / 1024 * 100) / 100,
      external: Math.round(endMem.external / 1024 / 1024 * 100) / 100,
      rss: Math.round(endMem.rss / 1024 / 1024 * 100) / 100,
    },
  };
}

/**
 * Runs a performance benchmark for a given transaction count
 */
async function runPerformanceBenchmark(
  app: express.Application,
  transactionCount: number
): Promise<PerformanceMetrics> {
  // Generate synthetic PDF
  const pdfBuffer = await generateSyntheticPDF({ transactionCount });

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  // Capture initial metrics
  const startTime = Date.now();
  const startCpu = process.cpuUsage();
  const startMem = process.memoryUsage();

  // Run ingestion
  const res = await request(app)
    .post("/api/ingest")
    .field("documentType", "bank_statement")
    .attach("file", pdfBuffer, `synthetic-${transactionCount}.pdf`);

  // Capture final metrics
  const durationMs = Date.now() - startTime;
  const { cpuUsage, memoryUsageMB } = captureMetrics(startCpu, startMem);

  return {
    transactionCount,
    pdfSizeBytes: pdfBuffer.length,
    durationMs,
    memoryUsageMB,
    cpuUsage,
    success: res.status === 200,
    extractedTransactions: res.body?.document?.transactions?.length ?? 0,
  };
}

describe("Performance Stress Tests", () => {
  let app: express.Application;
  const benchmarkResults: PerformanceMetrics[] = [];

  beforeAll(() => {
    app = express();
    app.use(express.json());
    registerIngestionRoutes(app);
  });

  it("should handle 500 transactions", async () => {
    const metrics = await runPerformanceBenchmark(app, 500);
    benchmarkResults.push(metrics);

    console.log("\n=== Performance Metrics (500 transactions) ===");
    console.log(JSON.stringify(metrics, null, 2));

    expect(metrics.success).toBe(true);
    expect(metrics.durationMs).toBeLessThan(30000); // 30 seconds max
    expect(metrics.memoryUsageMB.heapUsed).toBeLessThan(512); // 512 MB max
  }, 60000); // 60 second timeout

  it("should handle 1,000 transactions", async () => {
    const metrics = await runPerformanceBenchmark(app, 1000);
    benchmarkResults.push(metrics);

    console.log("\n=== Performance Metrics (1,000 transactions) ===");
    console.log(JSON.stringify(metrics, null, 2));

    expect(metrics.success).toBe(true);
    expect(metrics.durationMs).toBeLessThan(60000); // 60 seconds max
    expect(metrics.memoryUsageMB.heapUsed).toBeLessThan(1024); // 1 GB max
  }, 120000); // 120 second timeout

  it("should handle 5,000 transactions", async () => {
    const metrics = await runPerformanceBenchmark(app, 5000);
    benchmarkResults.push(metrics);

    console.log("\n=== Performance Metrics (5,000 transactions) ===");
    console.log(JSON.stringify(metrics, null, 2));

    expect(metrics.success).toBe(true);
    expect(metrics.durationMs).toBeLessThan(180000); // 180 seconds max (3 minutes)
    expect(metrics.memoryUsageMB.heapUsed).toBeLessThan(2048); // 2 GB max
  }, 300000); // 300 second timeout (5 minutes)

  it("should generate performance summary", () => {
    console.log("\n=== Performance Summary ===");
    console.log("Transaction Count | PDF Size (KB) | Duration (ms) | Heap Used (MB) | CPU User (ms) | Success");
    console.log("------------------|---------------|---------------|----------------|---------------|--------");
    
    for (const result of benchmarkResults) {
      console.log(
        `${String(result.transactionCount).padEnd(17)} | ` +
        `${String(Math.round(result.pdfSizeBytes / 1024)).padEnd(13)} | ` +
        `${String(result.durationMs).padEnd(13)} | ` +
        `${String(result.memoryUsageMB.heapUsed).padEnd(14)} | ` +
        `${String(Math.round(result.cpuUsage.user)).padEnd(13)} | ` +
        `${result.success ? "✓" : "✗"}`
      );
    }

    // Calculate throughput
    console.log("\n=== Throughput Analysis ===");
    for (const result of benchmarkResults) {
      const txnsPerSecond = Math.round((result.transactionCount / result.durationMs) * 1000);
      console.log(`${result.transactionCount} transactions: ${txnsPerSecond} txns/sec`);
    }

    // Memory scaling
    console.log("\n=== Memory Scaling ===");
    for (const result of benchmarkResults) {
      const mbPerTransaction = (result.memoryUsageMB.heapUsed / result.transactionCount).toFixed(3);
      console.log(`${result.transactionCount} transactions: ${mbPerTransaction} MB/txn`);
    }

    expect(benchmarkResults.length).toBe(3);
  });
});

/**
 * Cold Start Test - Tests performance of first ingestion vs subsequent ingestions
 */
describe("Cold Start Effects", () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    registerIngestionRoutes(app);
  });

  it("should measure cold start vs warm performance", async () => {
    const iterations = 3;
    const transactionCount = 100;
    const results: number[] = [];

    console.log("\n=== Cold Start Analysis (100 transactions, 3 iterations) ===");

    for (let i = 0; i < iterations; i++) {
      const pdfBuffer = await generateSyntheticPDF({ transactionCount });
      
      const startTime = Date.now();
      const res = await request(app)
        .post("/api/ingest")
        .field("documentType", "bank_statement")
        .attach("file", pdfBuffer, `cold-start-${i}.pdf`);
      const durationMs = Date.now() - startTime;

      results.push(durationMs);
      console.log(`Iteration ${i + 1}: ${durationMs}ms`);

      expect(res.status).toBe(200);
    }

    const coldStartMs = results[0];
    const avgWarmMs = (results[1] + results[2]) / 2;
    const coldStartOverhead = Math.round(((coldStartMs - avgWarmMs) / avgWarmMs) * 100);

    console.log(`\nCold Start: ${coldStartMs}ms`);
    console.log(`Avg Warm: ${Math.round(avgWarmMs)}ms`);
    console.log(`Cold Start Overhead: ${coldStartOverhead}%`);

    // Cold start should not be more than 200% slower than warm
    expect(coldStartOverhead).toBeLessThan(200);
  }, 60000);
});

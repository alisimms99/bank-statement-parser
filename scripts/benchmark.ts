#!/usr/bin/env tsx

/**
 * Performance Benchmark CLI Tool
 * 
 * Runs performance benchmarks and generates detailed reports.
 * Can be used for local testing or CI/CD performance regression detection.
 * 
 * Usage:
 *   tsx scripts/benchmark.ts [options]
 * 
 * Options:
 *   --sizes <comma-separated>  Transaction counts to test (default: 500,1000,5000)
 *   --iterations <number>      Number of iterations per size (default: 1)
 *   --output <file>            Output file for JSON results (optional)
 *   --warmup                   Run a warmup iteration before benchmarking
 */

import { generateSyntheticPDF } from "../server/performance/generateSyntheticPDF";
import { extractTextFromPDFBuffer } from "../server/_core/pdfText";
import { parseStatementText, legacyTransactionsToCanonical } from "../shared/legacyStatementParser";
import fs from "fs";
import path from "path";

interface BenchmarkOptions {
  sizes: number[];
  iterations: number;
  output?: string;
  warmup: boolean;
}

interface BenchmarkResult {
  transactionCount: number;
  iteration: number;
  pdfSizeBytes: number;
  pdfGenerationMs: number;
  textExtractionMs: number;
  parsingMs: number;
  normalizationMs: number;
  totalMs: number;
  memoryBefore: NodeJS.MemoryUsage;
  memoryAfter: NodeJS.MemoryUsage;
  memoryDeltaMB: number;
  extractedTransactions: number;
  success: boolean;
  error?: string;
}

interface BenchmarkSummary {
  timestamp: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  results: BenchmarkResult[];
  summary: {
    totalTests: number;
    successfulTests: number;
    failedTests: number;
    avgThroughput: number; // transactions per second
    avgMemoryPerTransaction: number; // MB
  };
}

/**
 * Parse command line arguments
 */
function parseArgs(): BenchmarkOptions {
  const args = process.argv.slice(2);
  const options: BenchmarkOptions = {
    sizes: [500, 1000, 5000],
    iterations: 1,
    warmup: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--sizes":
        options.sizes = args[++i].split(",").map((s) => parseInt(s.trim(), 10));
        break;
      case "--iterations":
        options.iterations = parseInt(args[++i], 10);
        break;
      case "--output":
        options.output = args[++i];
        break;
      case "--warmup":
        options.warmup = true;
        break;
      case "--help":
        console.log(`
Performance Benchmark CLI Tool

Usage:
  tsx scripts/benchmark.ts [options]

Options:
  --sizes <comma-separated>  Transaction counts to test (default: 500,1000,5000)
  --iterations <number>      Number of iterations per size (default: 1)
  --output <file>            Output file for JSON results (optional)
  --warmup                   Run a warmup iteration before benchmarking

Examples:
  tsx scripts/benchmark.ts --sizes 100,500,1000 --iterations 3
  tsx scripts/benchmark.ts --sizes 5000 --output results.json
  tsx scripts/benchmark.ts --warmup --sizes 500,1000
        `);
        process.exit(0);
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(1);
    }
  }

  return options;
}

/**
 * Run a single benchmark iteration
 */
async function runBenchmark(
  transactionCount: number,
  iteration: number
): Promise<BenchmarkResult> {
  const result: Partial<BenchmarkResult> = {
    transactionCount,
    iteration,
    success: false,
  };

  try {
    // Capture initial memory
    if (global.gc) global.gc();
    result.memoryBefore = process.memoryUsage();

    // Generate PDF
    const pdfStart = Date.now();
    const pdfBuffer = await generateSyntheticPDF({ transactionCount });
    result.pdfGenerationMs = Date.now() - pdfStart;
    result.pdfSizeBytes = pdfBuffer.length;

    // Extract text
    const extractStart = Date.now();
    const text = await extractTextFromPDFBuffer(pdfBuffer);
    result.textExtractionMs = Date.now() - extractStart;

    // Parse transactions
    const parseStart = Date.now();
    const legacyTransactions = parseStatementText(text);
    result.parsingMs = Date.now() - parseStart;

    // Normalize transactions
    const normalizeStart = Date.now();
    const canonicalTransactions = legacyTransactionsToCanonical(legacyTransactions);
    result.normalizationMs = Date.now() - normalizeStart;

    result.extractedTransactions = canonicalTransactions.length;
    result.totalMs =
      result.pdfGenerationMs +
      result.textExtractionMs +
      result.parsingMs +
      result.normalizationMs;

    // Capture final memory
    result.memoryAfter = process.memoryUsage();
    result.memoryDeltaMB =
      (result.memoryAfter.heapUsed - result.memoryBefore.heapUsed) / 1024 / 1024;

    result.success = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result as BenchmarkResult;
}

/**
 * Generate summary statistics
 */
function generateSummary(results: BenchmarkResult[]): BenchmarkSummary["summary"] {
  const successfulResults = results.filter((r) => r.success);
  const totalTransactions = successfulResults.reduce((sum, r) => sum + r.transactionCount, 0);
  const totalTime = successfulResults.reduce((sum, r) => sum + r.totalMs, 0);
  const totalMemory = successfulResults.reduce((sum, r) => sum + r.memoryDeltaMB, 0);

  return {
    totalTests: results.length,
    successfulTests: successfulResults.length,
    failedTests: results.length - successfulResults.length,
    avgThroughput: totalTime > 0 ? Math.round((totalTransactions / totalTime) * 1000) : 0,
    avgMemoryPerTransaction: totalTransactions > 0 ? totalMemory / totalTransactions : 0,
  };
}

/**
 * Print results table
 */
function printResults(results: BenchmarkResult[]) {
  console.log("\n╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                         PERFORMANCE BENCHMARK RESULTS                        ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝\n");

  console.log("Txns | Iter | PDF Size | PDF Gen | Extract | Parse | Normalize | Total  | Mem Δ   | Status");
  console.log("-----|------|----------|---------|---------|-------|-----------|--------|---------|--------");

  for (const r of results) {
    const txns = String(r.transactionCount).padEnd(4);
    const iter = String(r.iteration).padEnd(4);
    const size = `${Math.round(r.pdfSizeBytes / 1024)}KB`.padEnd(8);
    const pdfGen = `${r.pdfGenerationMs}ms`.padEnd(7);
    const extract = `${r.textExtractionMs}ms`.padEnd(7);
    const parse = `${r.parsingMs}ms`.padEnd(5);
    const normalize = `${r.normalizationMs}ms`.padEnd(9);
    const total = `${r.totalMs}ms`.padEnd(6);
    const mem = `${r.memoryDeltaMB.toFixed(1)}MB`.padEnd(7);
    const status = r.success ? "✓" : "✗";

    console.log(`${txns} | ${iter} | ${size} | ${pdfGen} | ${extract} | ${parse} | ${normalize} | ${total} | ${mem} | ${status}`);
  }

  console.log("");
}

/**
 * Print summary
 */
function printSummary(summary: BenchmarkSummary["summary"]) {
  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                              SUMMARY STATISTICS                              ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝\n");

  console.log(`Total Tests:                ${summary.totalTests}`);
  console.log(`Successful:                 ${summary.successfulTests}`);
  console.log(`Failed:                     ${summary.failedTests}`);
  console.log(`Avg Throughput:             ${summary.avgThroughput} txns/sec`);
  console.log(`Avg Memory per Transaction: ${summary.avgMemoryPerTransaction.toFixed(3)} MB/txn`);
  console.log("");
}

/**
 * Main benchmark runner
 */
async function main() {
  const options = parseArgs();

  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                    BANK STATEMENT PARSER BENCHMARK                           ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝\n");

  console.log(`Node.js:    ${process.version}`);
  console.log(`Platform:   ${process.platform} ${process.arch}`);
  console.log(`Sizes:      ${options.sizes.join(", ")} transactions`);
  console.log(`Iterations: ${options.iterations}`);
  console.log(`Warmup:     ${options.warmup ? "Yes" : "No"}`);
  console.log("");

  const results: BenchmarkResult[] = [];

  // Warmup run
  if (options.warmup) {
    console.log("Running warmup...");
    await runBenchmark(100, 0);
    console.log("Warmup complete.\n");
  }

  // Run benchmarks
  for (const size of options.sizes) {
    console.log(`Testing ${size} transactions...`);
    for (let i = 1; i <= options.iterations; i++) {
      process.stdout.write(`  Iteration ${i}/${options.iterations}... `);
      const result = await runBenchmark(size, i);
      results.push(result);
      console.log(result.success ? "✓" : "✗");
    }
    console.log("");
  }

  // Print results
  printResults(results);

  // Generate and print summary
  const summary = generateSummary(results);
  printSummary(summary);

  // Save to file if requested
  if (options.output) {
    const fullSummary: BenchmarkSummary = {
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      results,
      summary,
    };

    const outputPath = path.resolve(options.output);
    fs.writeFileSync(outputPath, JSON.stringify(fullSummary, null, 2));
    console.log(`Results saved to: ${outputPath}\n`);
  }

  // Exit with error code if any tests failed
  if (summary.failedTests > 0) {
    console.error("Some tests failed!");
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Benchmark failed:", error);
    process.exit(1);
  });
}

export { runBenchmark, generateSummary };

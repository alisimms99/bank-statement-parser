# Performance Testing Suite

This directory contains performance stress tests and benchmarking tools for the bank statement parser.

## Overview

The performance suite tests the ingestion pipeline under heavy workloads to determine:
- CPU requirements
- Memory usage patterns
- Latency characteristics
- Cold start effects
- Optimal Cloud Run configuration

## Files

- **`generateSyntheticPDF.ts`**: Utility for generating synthetic bank statement PDFs with configurable transaction counts
- **`stress.test.ts`**: Vitest-based performance stress tests with automated benchmarking
- **`README.md`**: This file

## Quick Start

### Run Performance Tests

```bash
# Run all performance tests
npm run test:performance

# Run with verbose output
npm test -- server/performance/stress.test.ts --reporter=verbose

# Run with garbage collection monitoring
node --expose-gc node_modules/.bin/vitest run server/performance/stress.test.ts
```

### Run CLI Benchmark Tool

```bash
# Run with default settings (500, 1000, 5000 transactions)
npm run benchmark

# Custom transaction counts
npm run benchmark -- --sizes 100,500,1000

# Multiple iterations for more accurate results
npm run benchmark -- --sizes 500,1000 --iterations 3

# Save results to JSON file
npm run benchmark -- --output benchmark-results.json

# Run with warmup iteration
npm run benchmark -- --warmup --sizes 500,1000,5000

# Show help
npm run benchmark -- --help
```

## Test Scenarios

### Stress Tests (stress.test.ts)

1. **500 transactions**: Tests baseline performance
   - Expected: < 30 seconds
   - Memory: < 512 MB

2. **1,000 transactions**: Tests medium workload
   - Expected: < 60 seconds
   - Memory: < 1 GB

3. **5,000 transactions**: Tests heavy workload
   - Expected: < 180 seconds
   - Memory: < 2 GB

4. **Cold Start Analysis**: Measures first-run overhead
   - Compares cold start vs warm performance
   - Identifies JIT compilation overhead

### Benchmark CLI (benchmark.ts)

The CLI tool provides detailed stage-by-stage timing:
- PDF generation
- Text extraction
- Statement parsing
- Transaction normalization
- Total end-to-end time

## Metrics Collected

### Performance Metrics
- **Duration**: Total processing time (milliseconds)
- **Throughput**: Transactions processed per second
- **Stage Timing**: Time for each processing stage

### Resource Metrics
- **Memory Usage**: Heap used, heap total, RSS, external
- **Memory Delta**: Memory increase during processing
- **CPU Usage**: User and system CPU time

### Quality Metrics
- **Success Rate**: Percentage of successful ingestions
- **Extracted Transactions**: Number of transactions parsed
- **Error Rate**: Failed ingestion count

## Synthetic PDF Generation

The `generateSyntheticPDF` utility creates realistic bank statement PDFs:

```typescript
import { generateSyntheticPDF } from './generateSyntheticPDF';

// Generate a PDF with 1000 transactions
const buffer = await generateSyntheticPDF({
  transactionCount: 1000,
  accountNumber: '****1234',
  bankName: 'Test Bank',
  startingBalance: 5000.0,
});
```

### PDF Characteristics
- Realistic transaction data (dates, merchants, amounts)
- Mix of debits (70%) and credits (30%)
- Multiple pages for large transaction counts
- Standard bank statement format
- Running balance calculations

## Interpreting Results

### Good Performance Indicators
- Linear scaling: 2x transactions ≈ 2x time
- Stable memory usage across iterations
- Low cold start overhead (< 50%)
- High success rate (100%)

### Performance Issues
- Exponential time growth with transaction count
- Memory leaks (increasing usage per iteration)
- High cold start overhead (> 100%)
- Low success rate (< 100%)

### Example Output

```
=== Performance Metrics (1,000 transactions) ===
{
  "transactionCount": 1000,
  "pdfSizeBytes": 245632,
  "durationMs": 1250,
  "memoryUsageMB": {
    "heapUsed": 145.32,
    "heapTotal": 180.50,
    "external": 12.45,
    "rss": 210.67
  },
  "cpuUsage": {
    "user": 1180,
    "system": 45
  },
  "success": true,
  "extractedTransactions": 1000
}
```

## Cloud Run Recommendations

See [PERFORMANCE.md](../../docs/PERFORMANCE.md) for detailed Cloud Run configuration recommendations based on these test results.

### Quick Reference

| Workload Size | CPU | Memory | Timeout | Concurrency |
|---------------|-----|--------|---------|-------------|
| Light (< 500 txns) | 1 | 1 GB | 60s | 80 |
| Medium (500-2K txns) | 2 | 2 GB | 120s | 40 |
| Heavy (2K-5K+ txns) | 4 | 4 GB | 300s | 20 |

## Continuous Integration

Integrate performance tests into CI/CD:

```yaml
# GitHub Actions example
- name: Run Performance Tests
  run: npm run test:performance
  
- name: Run Benchmarks
  run: npm run benchmark -- --output results.json
  
- name: Upload Results
  uses: actions/upload-artifact@v3
  with:
    name: performance-results
    path: results.json
```

## Troubleshooting

### Out of Memory Errors
- Reduce transaction count or increase Node.js memory limit:
  ```bash
  node --max-old-space-size=4096 node_modules/.bin/vitest run server/performance/stress.test.ts
  ```

### Slow Test Execution
- Use smaller transaction counts for quick checks
- Run benchmark tool instead of full test suite
- Disable verbose logging

### Failed Tests
- Check that dependencies are installed
- Verify PDF generation is working
- Review error messages in test output

## Future Enhancements

Planned improvements:
1. Document AI performance testing (requires API credentials)
2. Parallel processing benchmarks
3. Database performance tests
4. Network latency simulation
5. Automated regression detection

## Contributing

When adding new performance tests:
1. Follow existing test patterns
2. Document expected performance characteristics
3. Update PERFORMANCE.md with findings
4. Consider adding to benchmark CLI tool

## References

- [Main Performance Documentation](../../docs/PERFORMANCE.md)
- [Testing Handbook](../../docs/TESTING.md)
- [Architecture Overview](../../ARCHITECTURE.md)

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(process.cwd(), 'fixtures', 'stress-test');
const API_URL = process.env.API_URL || 'http://localhost:8080';

// Skip if test files don't exist
const hasTestFiles = existsSync(join(TEST_DIR, 'small-500-transactions.pdf'));

describe.skipIf(!hasTestFiles)('Performance Stress Tests', () => {
  beforeAll(() => {
    if (!hasTestFiles) {
      console.log('Run `pnpm generate:test-pdfs` first to create test files');
    }
  });

  it('should process 500 transactions under 5 seconds', async () => {
    const file = readFileSync(join(TEST_DIR, 'small-500-transactions.pdf'));
    const start = performance.now();

    const response = await fetch(`${API_URL}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'small-500-transactions.pdf',
        contentBase64: file.toString('base64'),
        documentType: 'bank_statement',
      }),
    });

    const elapsed = performance.now() - start;
    expect(response.ok).toBe(true);
    expect(elapsed).toBeLessThan(5000);
  }, 10000);

  it('should process 1000 transactions under 10 seconds', async () => {
    const file = readFileSync(join(TEST_DIR, 'medium-1000-transactions.pdf'));
    const start = performance.now();

    const response = await fetch(`${API_URL}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'medium-1000-transactions.pdf',
        contentBase64: file.toString('base64'),
        documentType: 'bank_statement',
      }),
    });

    const elapsed = performance.now() - start;
    expect(response.ok).toBe(true);
    expect(elapsed).toBeLessThan(10000);
  }, 15000);

  it('should process 5000 transactions under 30 seconds', async () => {
    const file = readFileSync(join(TEST_DIR, 'large-5000-transactions.pdf'));
    const start = performance.now();

    const response = await fetch(`${API_URL}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'large-5000-transactions.pdf',
        contentBase64: file.toString('base64'),
        documentType: 'bank_statement',
      }),
    });

    const elapsed = performance.now() - start;
    expect(response.ok).toBe(true);
    expect(elapsed).toBeLessThan(30000);
  }, 35000);

  it('should not run out of memory with large file', async () => {
    const file = readFileSync(join(TEST_DIR, 'large-5000-transactions.pdf'));
    const initialMemory = process.memoryUsage().heapUsed;

    await fetch(`${API_URL}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'large-5000-transactions.pdf',
        contentBase64: file.toString('base64'),
        documentType: 'bank_statement',
      }),
    });

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncreaseMB = (finalMemory - initialMemory) / 1024 / 1024;
    
    // Should not increase by more than 100MB
    expect(memoryIncreaseMB).toBeLessThan(100);
  }, 35000);
});

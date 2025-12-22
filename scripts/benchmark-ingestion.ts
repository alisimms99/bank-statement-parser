import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

interface BenchmarkResult {
  file: string;
  transactions: number;
  fileSizeKB: number;
  localMs: number;
  cloudRunMs?: number;
  memoryMB?: number;
  status: 'success' | 'error';
  error?: string;
}

async function benchmarkLocal(filePath: string): Promise<BenchmarkResult> {
  const fileName = filePath.split('/').pop() || '';
  const fileBuffer = readFileSync(filePath);
  const fileSizeKB = fileBuffer.length / 1024;
  
  // Simulate transaction count from filename
  const match = fileName.match(/(\d+)-transactions/);
  const expectedTransactions = match ? parseInt(match[1]) : 0;
  
  const start = performance.now();
  
  try {
    const response = await fetch('http://localhost:8080/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName,
        contentBase64: fileBuffer.toString('base64'),
        documentType: 'bank_statement',
      }),
    });
    
    const elapsed = performance.now() - start;
    const data = await response.json();
    
    return {
      file: fileName,
      transactions: data.document?.transactions?.length || 0,
      fileSizeKB: Math.round(fileSizeKB),
      localMs: Math.round(elapsed),
      status: response.ok ? 'success' : 'error',
      error: response.ok ? undefined : data.error,
    };
  } catch (error) {
    return {
      file: fileName,
      transactions: 0,
      fileSizeKB: Math.round(fileSizeKB),
      localMs: Math.round(performance.now() - start),
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function benchmarkCloudRun(filePath: string, cloudRunUrl: string, idToken: string): Promise<BenchmarkResult> {
  const fileName = filePath.split('/').pop() || '';
  const fileBuffer = readFileSync(filePath);
  const fileSizeKB = fileBuffer.length / 1024;
  
  const start = performance.now();
  
  try {
    const response = await fetch(`${cloudRunUrl}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        fileName,
        contentBase64: fileBuffer.toString('base64'),
        documentType: 'bank_statement',
      }),
    });
    
    const elapsed = performance.now() - start;
    const data = await response.json();
    
    return {
      file: fileName,
      transactions: data.document?.transactions?.length || 0,
      fileSizeKB: Math.round(fileSizeKB),
      localMs: 0,
      cloudRunMs: Math.round(elapsed),
      status: response.ok ? 'success' : 'error',
      error: response.ok ? undefined : data.error,
    };
  } catch (error) {
    return {
      file: fileName,
      transactions: 0,
      fileSizeKB: Math.round(fileSizeKB),
      localMs: 0,
      cloudRunMs: Math.round(performance.now() - start),
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function runBenchmarks() {
  const testDir = join(process.cwd(), 'fixtures', 'stress-test');
  const files = readdirSync(testDir).filter(f => f.endsWith('.pdf'));
  
  console.log('🚀 Running ingestion benchmarks...\n');
  
  const results: BenchmarkResult[] = [];
  
  // Run local benchmarks
  console.log('📍 Local benchmarks:');
  for (const file of files) {
    const result = await benchmarkLocal(join(testDir, file));
    results.push(result);
    console.log(`  ${result.file}: ${result.localMs}ms (${result.transactions} txns)`);
  }
  
  // Check for Cloud Run URL
  const cloudRunUrl = process.env.CLOUDRUN_URL;
  if (cloudRunUrl) {
    console.log('\n☁️  Cloud Run benchmarks:');
    const idToken = process.env.GCLOUD_ID_TOKEN || '';
    
    for (const file of files) {
      const result = await benchmarkCloudRun(join(testDir, file), cloudRunUrl, idToken);
      results.push(result);
      console.log(`  ${result.file}: ${result.cloudRunMs}ms (${result.transactions} txns)`);
    }
  }
  
  // Generate report
  console.log('\n📊 Summary:');
  console.log('─'.repeat(70));
  console.log('File                          | Size KB | Txns  | Local ms | Cloud ms');
  console.log('─'.repeat(70));
  
  for (const r of results) {
    console.log(
      `${r.file.padEnd(30)} | ${String(r.fileSizeKB).padStart(7)} | ${String(r.transactions).padStart(5)} | ${String(r.localMs).padStart(8)} | ${String(r.cloudRunMs || '-').padStart(8)}`
    );
  }
  
  // Save results
  const reportPath = join(process.cwd(), 'benchmark-results.json');
  writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to ${reportPath}`);
  
  // Recommendations
  console.log('\n💡 Recommendations:');
  const maxLocal = Math.max(...results.filter(r => r.localMs > 0).map(r => r.localMs));
  const maxCloud = Math.max(...results.filter(r => r.cloudRunMs).map(r => r.cloudRunMs || 0));
  
  if (maxLocal > 10000) {
    console.log('  ⚠️  Local processing exceeds 10s for large files');
    console.log('     Consider increasing Cloud Run CPU or timeout');
  }
  if (maxCloud > 30000) {
    console.log('  ⚠️  Cloud Run processing exceeds 30s');
    console.log('     Consider: --cpu=2 --memory=1Gi --timeout=300');
  }
}

runBenchmarks().catch(console.error);

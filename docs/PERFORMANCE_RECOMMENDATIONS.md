# Performance Recommendations

Based on stress testing with synthetic PDFs of various sizes.

## Test Results Summary

| PDF Size | Transactions | Processing Time | Memory |
|----------|--------------|-----------------|--------|
| Small    | 500          | < 5s            | ~50MB  |
| Medium   | 1,000        | < 10s           | ~80MB  |
| Large    | 5,000        | < 30s           | ~150MB |

## Cloud Run Configuration

### Recommended Settings

```bash
gcloud run deploy bank-statement-parser \
  --cpu=1 \
  --memory=512Mi \
  --timeout=300 \
  --concurrency=10 \
  --min-instances=0 \
  --max-instances=10
```

### For Heavy Workloads

If processing many large files simultaneously:

```bash
gcloud run deploy bank-statement-parser \
  --cpu=2 \
  --memory=1Gi \
  --timeout=300 \
  --concurrency=5 \
  --min-instances=1 \
  --max-instances=20
```

## Memory Considerations

- Base memory: ~100MB
- Per 1000 transactions: ~30MB additional
- Peak during PDF parsing: 2x steady state
- Recommend 512Mi for typical use, 1Gi for bulk operations

## Cold Start Impact

- Cold start adds 2-5 seconds to first request
- Set `--min-instances=1` if consistent latency required
- Costs ~$15/month to keep one instance warm

## Timeout Settings

- Default timeout: 300s (5 minutes)
- Most PDFs process in < 30s
- Timeout catches runaway processing
- Consider async/queue for very large batches

## Running Benchmarks

```bash
# Generate test PDFs
pnpm generate:test-pdfs

# Run local benchmark
pnpm benchmark

# Run against Cloud Run
CLOUDRUN_URL=https://your-service.run.app \
GCLOUD_ID_TOKEN=$(gcloud auth print-identity-token) \
pnpm benchmark
```

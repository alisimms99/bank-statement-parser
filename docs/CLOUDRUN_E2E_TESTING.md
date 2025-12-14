# Cloud Run End-to-End Testing

This document describes the Cloud Run E2E test suite that validates the deployed API behaves correctly under real GCP networking, authentication, cold start, and concurrency conditions.

## Overview

The `cloudrun-e2e.yml` workflow provides comprehensive end-to-end testing of the deployed Cloud Run service to ensure it's production-ready.

## Workflow Triggers

The E2E test workflow can be triggered in two ways:

### 1. Manual Trigger (workflow_dispatch)

You can manually run the tests against any Cloud Run URL:

1. Go to **Actions** → **Cloud Run E2E Tests**
2. Click **Run workflow**
3. Enter your Cloud Run service URL (e.g., `https://my-service-abc123.run.app`)
4. Click **Run workflow**

### 2. Automated Post-Deployment (workflow_call)

The workflow can be called from your deployment workflow:

```yaml
# In your deploy.yml or similar
jobs:
  deploy:
    # ... your deployment steps ...
    outputs:
      service_url: ${{ steps.deploy.outputs.url }}
  
  e2e-tests:
    needs: deploy
    uses: ./.github/workflows/cloudrun-e2e.yml
    with:
      cloudrun_url: ${{ needs.deploy.outputs.service_url }}
```

## Test Coverage

The E2E test suite validates the following:

### 1. Health Check (`GET /api/health`)
- ✅ Returns HTTP 200
- ✅ JSON structure contains `ok: true`
- ✅ JSON structure contains `ts` (timestamp)
- ✅ Measures cold-start latency

### 2. CORS Validation
- ✅ Validates CORS preflight (OPTIONS) responses
- ✅ Checks CORS headers in responses
- ✅ Confirms proper handling of Origin headers

### 3. Document Ingestion (`POST /api/ingest`)
- ✅ Uploads real PDF from test fixtures
- ✅ Returns HTTP 200 on success
- ✅ Validates JSON response structure
- ✅ Confirms `source` field (documentai/legacy)
- ✅ Validates `document` and `exportId` fields
- ✅ Measures ingestion latency

### 4. CSV Export (`GET /api/export/:id/csv`)
- ✅ Returns HTTP 200 for valid export ID
- ✅ Validates CSV file structure
- ✅ Confirms CSV header contains required columns
- ✅ Validates file integrity (UTF-8 text)
- ✅ Returns HTTP 404 for invalid export ID

### 5. PDF Export (`GET /api/export/:id/pdf`)
- ✅ Returns HTTP 200 for valid export ID
- ✅ Validates PDF file integrity
- ✅ Confirms PDF magic bytes (`%PDF`)
- ✅ Validates file size is reasonable
- ✅ Returns HTTP 404 for invalid export ID

### 6. Error Handling
- ✅ Validates 404 responses for invalid export IDs
- ✅ Confirms proper JSON error structure
- ✅ Tests negative cases

## Test Artifacts

After each run, the workflow uploads test artifacts:
- `ingest-response.json` - Response from the ingest endpoint
- `export.csv` - Generated CSV export file
- `export.pdf` - Generated PDF export file

These can be downloaded from the Actions run page for debugging.

## Performance Metrics

The workflow measures and reports:
- **Cold Start Latency**: Time for the first health check request
- **Ingestion Latency**: Time to process and ingest a PDF document

These metrics appear in the test summary.

## Test Summary

After all tests complete, a comprehensive summary is generated in the GitHub Actions step summary, showing:
- Pass/fail status for each test
- Performance metrics
- Service URL tested
- Overall production-readiness status

## Prerequisites

### Sample Test Data

The workflow uses a sample PDF file located at:
```
fixtures/sample-statement.pdf
```

This is a minimal valid PDF with sample bank transaction data that exercises the parser.

### Required Endpoints

Your Cloud Run service must expose these endpoints:
- `GET /api/health`
- `POST /api/ingest` (accepts multipart/form-data with `file` field)
- `GET /api/export/:id/csv`
- `GET /api/export/:id/pdf`

## Acceptance Criteria

The workflow is considered successful when:
- ✅ All HTTP status codes are as expected (200, 404, etc.)
- ✅ JSON responses have correct structure
- ✅ Export files are valid and complete
- ✅ CORS headers are present (if configured)
- ✅ Latency metrics are within acceptable ranges
- ✅ No test failures occur

## CI/CD Integration

This workflow prevents regressions in deployment by:
1. Running automatically after successful Cloud Run deployments
2. Failing the deployment if any E2E test fails
3. Providing immediate feedback on production readiness
4. Validating real-world networking and infrastructure conditions

## Troubleshooting

### Test Failures

If tests fail, check:
1. **Service URL**: Ensure the Cloud Run URL is correct and accessible
2. **Service Status**: Verify the service is deployed and running
3. **Test Artifacts**: Download artifacts from the Actions run to inspect responses
4. **Logs**: Check Cloud Run logs for server-side errors
5. **CORS Configuration**: Verify CORS is configured if needed

### Common Issues

**"Health check failed with status 503"**
- Service may still be deploying or cold-starting
- Check Cloud Run logs for startup errors

**"CSV export failed with status 404"**
- Export ID may have expired (1-hour TTL)
- Ingest may have failed silently

**"CORS preflight returned unexpected status"**
- CORS may not be configured
- This is a warning, not a failure

## Future Enhancements

Potential improvements to the E2E test suite:
- [ ] Add authentication/authorization tests
- [ ] Test concurrent requests and rate limiting
- [ ] Add larger PDF files to test upload limits
- [ ] Validate specific transaction parsing accuracy
- [ ] Add performance benchmarks and SLO validation
- [ ] Test multiple document types (invoice, receipt)

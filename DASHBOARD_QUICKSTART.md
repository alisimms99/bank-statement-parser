# Observability Dashboard - Quick Start

This guide helps you quickly set up the production observability dashboard for monitoring your Bank Statement Parser deployment on Google Cloud Run.

## Prerequisites

- Application deployed to Google Cloud Run
- `gcloud` CLI installed and authenticated
- IAM permissions: `monitoring.dashboards.create`, `logging.logEntries.list`

## Quick Setup (3 Steps)

### 1. Set Your Project

```bash
gcloud config set project YOUR_PROJECT_ID
```

### 2. Create the Dashboard

```bash
gcloud monitoring dashboards create --config-from-file=cloud-monitoring-dashboard.json
```

### 3. View the Dashboard

Open the [Cloud Monitoring Dashboards](https://console.cloud.google.com/monitoring/dashboards) page in Google Cloud Console and select "Bank Statement Parser - Production Observability".

## What You'll See

The dashboard provides real-time visibility into:

✅ **Ingestion Latency** - P50 and P95 response times  
✅ **Error Rate** - Failures by ingestion phase  
✅ **Export Volume** - CSV and PDF downloads per hour  
✅ **Cold Start Duration** - Container startup performance  
✅ **Source Distribution** - DocumentAI vs legacy parser usage  
✅ **Transaction Volume** - Throughput over time  
✅ **Live Logs** - Recent events and errors  

## Metrics Reference

All metrics are derived from structured logs with these event types:

| Event | Purpose | Key Fields |
|-------|---------|------------|
| `ingestion_start` | Document processing begins | `fileName`, `bytes`, `coldStartMs` |
| `ingestion_complete` | Processing finished | `source`, `durationMs`, `transactionCount` |
| `ingest_error` | Processing failed | `phase`, `error`, `durationMs` |
| `export_csv` | CSV export | `exportId`, `success`, `transactionCount` |
| `export_pdf` | PDF export | `exportId`, `success`, `transactionCount` |
| `cold_start` | Container startup | `durationMs`, `containerStartup` |

## Troubleshooting

### Dashboard shows no data

1. Generate test traffic by uploading a document
2. Wait 1-2 minutes for logs to propagate
3. Verify logs are present:
   ```bash
   gcloud logging read 'resource.type="cloud_run_revision" AND jsonPayload.event="ingestion_complete"' --limit 5
   ```

### Need help?

See the complete documentation: [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md)

## Next Steps

- Set up alerting for high error rates
- Create log-based metrics for better performance
- Configure notification channels for alerts

For detailed instructions, see [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md).

#!/bin/bash
set -e

echo "Creating log-based metrics..."

gcloud logging metrics create ingestion_complete \
  --config-from-file=monitoring/metrics/ingestion_complete.json \
  2>/dev/null || echo "ingestion_complete already exists"

gcloud logging metrics create ingestion_error \
  --config-from-file=monitoring/metrics/ingestion_error.json \
  2>/dev/null || echo "ingestion_error already exists"

gcloud logging metrics create ingestion_latency \
  --config-from-file=monitoring/metrics/ingestion_latency.json \
  2>/dev/null || echo "ingestion_latency already exists"

gcloud logging metrics create cold_start \
  --config-from-file=monitoring/metrics/cold_start.json \
  2>/dev/null || echo "cold_start already exists"

echo "✅ Metrics created"
echo ""
echo "Create dashboard with:"
echo "  gcloud monitoring dashboards create --config-from-file=monitoring/dashboard.json"

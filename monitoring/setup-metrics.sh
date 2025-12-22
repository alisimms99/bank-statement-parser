#!/bin/bash
set -e

echo "Creating log-based metrics..."

gcloud logging metrics create ingestion_complete \
  --description="Count of successful ingestions" \
  --log-filter='jsonPayload.event="ingestion_complete"' 2>/dev/null || echo "ingestion_complete already exists"

gcloud logging metrics create ingestion_error \
  --description="Count of failed ingestions" \
  --log-filter='jsonPayload.event="ingestion_error"' 2>/dev/null || echo "ingestion_error already exists"

gcloud logging metrics create export_csv \
  --description="Count of CSV exports" \
  --log-filter='jsonPayload.event="export_csv"' 2>/dev/null || echo "export_csv already exists"

echo "✅ Metrics created"
echo ""
echo "Create dashboard with:"
echo "  gcloud monitoring dashboards create --config-from-file=monitoring/dashboard.json"

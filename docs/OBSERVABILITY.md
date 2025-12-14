# Production Observability Dashboard

This document describes the production observability dashboard for monitoring the Bank Statement Parser application running on Google Cloud Run.

## Overview

The observability dashboard provides real-time insights into:
- **Ingestion Health**: Latency, throughput, and success rates
- **Error Tracking**: Failure rates and error patterns by phase
- **Export Monitoring**: CSV and PDF export volumes
- **Cold Start Analysis**: Container startup performance
- **Transaction Volume**: Processing throughput

## Metrics Collected

### Ingestion Metrics

The application emits structured logs for the following ingestion events:

1. **`ingestion_start`**: Emitted when document ingestion begins
   - Fields: `fileName`, `documentType`, `bytes`, `contentType`, `coldStartMs`

2. **`ingestion_complete`**: Emitted when ingestion completes successfully
   - Fields: `source` (documentai/legacy), `fileName`, `documentType`, `transactionCount`, `durationMs`, `exportId`

3. **`ingest_error`**: Emitted when ingestion fails
   - Fields: `phase`, `fileName`, `documentType`, `error`, `durationMs`

### Export Metrics

4. **`export_csv`**: CSV export event
   - Fields: `exportId`, `includeBOM`, `success`, `status`, `transactionCount`

5. **`export_pdf`**: PDF export event
   - Fields: `exportId`, `success`, `status`, `transactionCount`

### Performance Metrics

6. **`cold_start`**: Container cold start detected
   - Fields: `durationMs`, `containerStartup`

## Dashboard Panels

The Cloud Monitoring dashboard includes the following panels:

### 1. Ingestion Latency (P50 / P95)
- **Purpose**: Monitor ingestion performance and detect slowdowns
- **Metrics**: 50th and 95th percentile latency from `ingestion_complete` events
- **Update Interval**: 1 minute
- **Query**: Filters on `jsonPayload.event="ingestion_complete"` and aggregates `durationMs`

### 2. Error Rate
- **Purpose**: Track ingestion failures and identify problematic phases
- **Metrics**: Rate of `ingest_error` and `ingest_failure` events by phase
- **Update Interval**: 1 minute
- **Query**: Compares error events against successful ingestions

### 3. Export Volume per Hour
- **Purpose**: Monitor CSV and PDF export activity
- **Metrics**: Successful exports per hour by format
- **Update Interval**: 1 hour aggregation
- **Query**: Filters on `jsonPayload.event="export_csv"` and `"export_pdf"` with `success=true`

### 4. Cold Start Duration
- **Purpose**: Track container startup latency
- **Metrics**: Average and P95 cold start duration
- **Update Interval**: 1 minute
- **Query**: Filters on `jsonPayload.event="cold_start"` and aggregates `durationMs`

### 5. Ingestion Source Distribution
- **Purpose**: Show DocumentAI vs legacy parser usage
- **Metrics**: Ingestion rate by source (documentai/legacy/error)
- **Update Interval**: 1 minute
- **Query**: Groups `ingestion_complete` events by `source` field

### 6. Transaction Volume Processed
- **Purpose**: Monitor total transaction throughput
- **Metrics**: Sum of transactions processed over 5-minute windows
- **Update Interval**: 5 minutes
- **Query**: Sums `transactionCount` from `ingestion_complete` events

### 7-9. Detailed Log Queries
- **Recent Ingestion Events**: Shows recent ingestion start/complete/error logs
- **Recent Export Events**: Shows recent CSV/PDF export logs
- **Errors and Warnings**: Shows all logs with severity >= WARNING

## Setting Up the Dashboard

### Prerequisites

1. Your application must be deployed to Google Cloud Run
2. You must have appropriate IAM permissions:
   - `monitoring.dashboards.create`
   - `monitoring.dashboards.update`
   - `logging.logEntries.list`

### Installation Methods

#### Method 1: Using gcloud CLI

1. Install the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) if not already installed

2. Authenticate and set your project:
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

3. Create the dashboard from the JSON configuration:
   ```bash
   gcloud monitoring dashboards create --config-from-file=cloud-monitoring-dashboard.json
   ```

4. View the dashboard:
   ```bash
   # List all dashboards to find the ID
   gcloud monitoring dashboards list
   
   # Open in browser
   gcloud monitoring dashboards describe DASHBOARD_ID
   ```

#### Method 2: Using Google Cloud Console

1. Navigate to [Cloud Monitoring](https://console.cloud.google.com/monitoring) in Google Cloud Console

2. Click **Dashboards** in the left navigation

3. Click **+ CREATE DASHBOARD**

4. Click the **⋮** (more options) menu in the top right

5. Select **View JSON**

6. Copy the contents of `cloud-monitoring-dashboard.json` and paste it into the JSON editor

7. Click **APPLY**

#### Method 3: Using Terraform

Add this resource to your Terraform configuration:

```hcl
resource "google_monitoring_dashboard" "bank_statement_parser" {
  dashboard_json = file("${path.module}/cloud-monitoring-dashboard.json")
  
  lifecycle {
    ignore_changes = [
      dashboard_json
    ]
  }
}
```

### Updating the Dashboard

To update an existing dashboard:

```bash
# Get the dashboard ID
DASHBOARD_ID=$(gcloud monitoring dashboards list --filter="displayName:'Bank Statement Parser - Production Observability'" --format="value(name)")

# Update the dashboard
gcloud monitoring dashboards update $DASHBOARD_ID --config-from-file=cloud-monitoring-dashboard.json
```

## Verifying Metrics Collection

After deploying your application and creating the dashboard:

1. **Generate Test Traffic**: Upload a bank statement through the application

2. **Check Logs**: Verify structured logs are being emitted
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND jsonPayload.event=ingestion_complete" --limit 10 --format json
   ```

3. **Verify Dashboard Data**: 
   - Navigate to your dashboard in Cloud Monitoring
   - Wait 1-2 minutes for metrics to populate
   - Confirm charts are showing data

## Log-Based Metrics (Optional)

For more efficient querying and alerting, you can create log-based metrics:

### Create Metrics via gcloud

```bash
# Ingestion latency metric
gcloud logging metrics create ingestion_latency \
  --description="Distribution of ingestion latency" \
  --log-filter='resource.type="cloud_run_revision" AND jsonPayload.event="ingestion_complete"' \
  --value-extractor='EXTRACT(jsonPayload.durationMs)' \
  --metric-kind=DELTA \
  --value-type=DISTRIBUTION

# Error rate metric
gcloud logging metrics create ingestion_errors \
  --description="Count of ingestion errors by phase" \
  --log-filter='resource.type="cloud_run_revision" AND (jsonPayload.event="ingest_error" OR jsonPayload.event="ingest_failure")' \
  --metric-kind=DELTA \
  --value-type=INT64

# Export volume metric
gcloud logging metrics create export_count \
  --description="Count of successful exports by format" \
  --log-filter='resource.type="cloud_run_revision" AND (jsonPayload.event="export_csv" OR jsonPayload.event="export_pdf") AND jsonPayload.success=true' \
  --metric-kind=DELTA \
  --value-type=INT64

# Cold start metric
gcloud logging metrics create cold_start_duration \
  --description="Distribution of cold start durations" \
  --log-filter='resource.type="cloud_run_revision" AND jsonPayload.event="cold_start"' \
  --value-extractor='EXTRACT(jsonPayload.durationMs)' \
  --metric-kind=DELTA \
  --value-type=DISTRIBUTION
```

## Setting Up Alerts

To be notified of issues, create alerting policies:

### Example: High Error Rate Alert

```bash
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="Bank Statement Parser - High Error Rate" \
  --condition-display-name="Error rate above 10%" \
  --condition-threshold-value=0.1 \
  --condition-threshold-duration=300s \
  --condition-filter='resource.type="cloud_run_revision" AND (jsonPayload.event="ingest_error" OR jsonPayload.event="ingest_failure")'
```

### Example: High Latency Alert

```bash
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="Bank Statement Parser - High Latency" \
  --condition-display-name="P95 latency above 5 seconds" \
  --condition-threshold-value=5000 \
  --condition-threshold-duration=300s \
  --condition-filter='resource.type="cloud_run_revision" AND jsonPayload.event="ingestion_complete"' \
  --condition-threshold-aggregation='percentile:0.95'
```

## Troubleshooting

### Dashboard shows no data

1. **Check Cloud Run deployment**: Ensure your application is deployed and receiving traffic
   ```bash
   gcloud run services list
   gcloud run services describe SERVICE_NAME
   ```

2. **Verify structured logging**: Check that logs are being emitted in JSON format
   ```bash
   gcloud logging read "resource.type=cloud_run_revision" --limit 5 --format json
   ```

3. **Check log filters**: Ensure the dashboard filters match your Cloud Run service name

### Metrics are incomplete

1. **Wait for propagation**: Cloud Logging can take 1-2 minutes to index logs
2. **Check time range**: Ensure the dashboard time range includes recent activity
3. **Verify log structure**: Confirm that events include all required fields (e.g., `durationMs`, `event`)

### Cold start metrics not appearing

1. **Generate cold starts**: Trigger a new container instance by:
   - Deploying a new revision
   - Scaling down to zero and back up
   - Waiting for auto-scaling to create new instances

2. **Check first request tracking**: Verify the `cold_start` event is logged:
   ```bash
   gcloud logging read 'resource.type="cloud_run_revision" AND jsonPayload.event="cold_start"' --limit 5
   ```

## Cost Considerations

- **Cloud Logging**: First 50 GiB/month is free, then $0.50/GiB
- **Cloud Monitoring**: First 150 MiB of metrics is free, then $0.2580/MiB
- **Log-based metrics**: User-defined metrics count against the 150 MiB free tier

To minimize costs:
- Use appropriate log retention policies
- Consider sampling for high-volume environments
- Delete unused dashboards and metrics

## Additional Resources

- [Cloud Monitoring Documentation](https://cloud.google.com/monitoring/docs)
- [Cloud Logging Documentation](https://cloud.google.com/logging/docs)
- [Cloud Run Monitoring Guide](https://cloud.google.com/run/docs/monitoring)
- [MQL (Monitoring Query Language)](https://cloud.google.com/monitoring/mql)

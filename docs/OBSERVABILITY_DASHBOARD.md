# Production Observability Dashboard

Guide for setting up Cloud Monitoring dashboard and log-based metrics.

## Metrics Overview

| Metric | Type | Description |
|--------|------|-------------|
| `ingestion_start` | Counter | PDF upload initiated |
| `ingestion_complete` | Counter | PDF successfully processed |
| `ingestion_error` | Counter | PDF processing failed |
| `export_csv` | Counter | CSV export requested |
| `export_pdf` | Counter | PDF export requested |
| `ingestion_latency` | Distribution | P50/P95 ingestion time |
| `cold_start_duration` | Distribution | Cold start latency |

## Create Log-Based Metrics

### Via gcloud CLI

```bash
# Ingestion complete counter
gcloud logging metrics create ingestion_complete \
  --description="Count of successful ingestions" \
  --log-filter='jsonPayload.event="ingestion_complete"'

# Ingestion error counter  
gcloud logging metrics create ingestion_error \
  --description="Count of failed ingestions" \
  --log-filter='jsonPayload.event="ingestion_error"'

# CSV export counter
gcloud logging metrics create export_csv \
  --description="Count of CSV exports" \
  --log-filter='jsonPayload.event="export_csv"'

# Cold start tracking
gcloud logging metrics create cold_start \
  --description="Cold start occurrences" \
  --log-filter='textPayload=~"Cold start" OR jsonPayload.message=~"Cold start"'
```

### Ingestion Latency (Distribution Metric)

```bash
gcloud logging metrics create ingestion_latency \
  --description="Ingestion processing time in ms" \
  --log-filter='jsonPayload.event="ingestion_complete"' \
  --bucket-name="ingestion_latency_bucket" \
  --value-extractor='EXTRACT(jsonPayload.durationMs)'
```

## Create Dashboard

### Via Console

1. Go to Cloud Monitoring → Dashboards → Create Dashboard
2. Name: "Bank Statement Parser - Production"
3. Add widgets:

### Dashboard JSON (Import)

Save as `monitoring/dashboard.json`:

```json
{
  "displayName": "Bank Statement Parser - Production",
  "gridLayout": {
    "columns": "2",
    "widgets": [
      {
        "title": "Ingestion Volume",
        "xyChart": {
          "dataSets": [{
            "timeSeriesQuery": {
              "timeSeriesFilter": {
                "filter": "metric.type=\"logging.googleapis.com/user/ingestion_complete\"",
                "aggregation": {
                  "alignmentPeriod": "60s",
                  "perSeriesAligner": "ALIGN_RATE"
                }
              }
            }
          }]
        }
      },
      {
        "title": "Error Rate",
        "xyChart": {
          "dataSets": [{
            "timeSeriesQuery": {
              "timeSeriesFilter": {
                "filter": "metric.type=\"logging.googleapis.com/user/ingestion_error\"",
                "aggregation": {
                  "alignmentPeriod": "60s", 
                  "perSeriesAligner": "ALIGN_RATE"
                }
              }
            }
          }]
        }
      },
      {
        "title": "P50/P95 Latency",
        "xyChart": {
          "dataSets": [{
            "timeSeriesQuery": {
              "timeSeriesFilter": {
                "filter": "metric.type=\"logging.googleapis.com/user/ingestion_latency\"",
                "aggregation": {
                  "alignmentPeriod": "60s",
                  "perSeriesAligner": "ALIGN_PERCENTILE_50"
                }
              }
            }
          }]
        }
      },
      {
        "title": "Cold Starts",
        "scorecard": {
          "timeSeriesQuery": {
            "timeSeriesFilter": {
              "filter": "metric.type=\"logging.googleapis.com/user/cold_start\""
            }
          }
        }
      }
    ]
  }
}
```

Import via:
```bash
gcloud monitoring dashboards create --config-from-file=monitoring/dashboard.json
```

## Useful Log Queries

### Recent Errors
```
resource.type="cloud_run_revision"
resource.labels.service_name="bank-statement-parser"
severity>=ERROR
```

### Ingestion Events
```
resource.type="cloud_run_revision"
jsonPayload.event=~"ingestion.*"
```

### Slow Requests (>5s)
```
resource.type="cloud_run_revision"
jsonPayload.durationMs>5000
```

### Cold Starts
```
resource.type="cloud_run_revision"
textPayload=~"Cold start"
```

## Alerting Policies

### High Error Rate Alert

```bash
gcloud alpha monitoring policies create \
  --display-name="High Ingestion Error Rate" \
  --condition-filter='metric.type="logging.googleapis.com/user/ingestion_error"' \
  --condition-threshold-value=10 \
  --condition-threshold-duration=300s \
  --notification-channels=YOUR_CHANNEL_ID
```

## Acceptance Criteria

- [ ] Dashboard visible in Cloud Monitoring
- [ ] Metrics populated from live Cloud Run logs
- [ ] P50/P95 latency graphs working
- [ ] Error rate widget shows data

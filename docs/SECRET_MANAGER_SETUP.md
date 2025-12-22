# Secret Manager Setup Guide

Complete guide for configuring Google Cloud Secret Manager for production deployment.

## Prerequisites

- Google Cloud project with Secret Manager API enabled
- `gcloud` CLI authenticated with appropriate permissions
- Service account with `Secret Manager Secret Accessor` role

## Enable API

```bash
gcloud services enable secretmanager.googleapis.com
```

## Create All Required Secrets

Run this script to create all secrets:

```bash
#!/bin/bash

# Configuration secrets
echo -n "your-project-id" | gcloud secrets create GOOGLE_PROJECT_ID --data-file=-
echo -n "us" | gcloud secrets create DOCAI_LOCATION --data-file=-
echo -n "your-processor-id" | gcloud secrets create DOCAI_PROCESSOR_ID --data-file=-
echo -n "true" | gcloud secrets create ENABLE_DOC_AI --data-file=-

# Security secrets
openssl rand -base64 32 | tr -d '\n' | gcloud secrets create JWT_SECRET --data-file=-

# Database
echo -n "mysql://user:pass@host:3306/dbname" | gcloud secrets create DATABASE_URL --data-file=-

# CORS
echo -n "https://your-frontend-domain.com" | gcloud secrets create CORS_ALLOW_ORIGIN --data-file=-

# Service account (from file)
gcloud secrets create GCP_SERVICE_ACCOUNT_JSON --data-file=path/to/service-account.json
```

## Grant Cloud Run Access

```bash
# Get the Cloud Run service account
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Grant access to each secret
for SECRET in GOOGLE_PROJECT_ID DOCAI_LOCATION DOCAI_PROCESSOR_ID ENABLE_DOC_AI JWT_SECRET DATABASE_URL CORS_ALLOW_ORIGIN GCP_SERVICE_ACCOUNT_JSON; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/secretmanager.secretAccessor"
done
```

## Deploy with Secrets

```bash
gcloud run deploy bank-statement-parser \
  --image=us-central1-docker.pkg.dev/PROJECT/REPO/bank-statement-parser:latest \
  --region=us-central1 \
  --set-secrets="GOOGLE_PROJECT_ID=GOOGLE_PROJECT_ID:latest,DOCAI_LOCATION=DOCAI_LOCATION:latest,DOCAI_PROCESSOR_ID=DOCAI_PROCESSOR_ID:latest,ENABLE_DOC_AI=ENABLE_DOC_AI:latest,JWT_SECRET=JWT_SECRET:latest,DATABASE_URL=DATABASE_URL:latest,CORS_ALLOW_ORIGIN=CORS_ALLOW_ORIGIN:latest" \
  --set-secrets="/secrets/gcp-sa.json=GCP_SERVICE_ACCOUNT_JSON:latest" \
  --update-env-vars="GCP_SERVICE_ACCOUNT_PATH=/secrets/gcp-sa.json"
```

## Verification

After deployment, verify secrets are loaded:

```bash
# Check Cloud Run service
gcloud run services describe bank-statement-parser \
  --region=us-central1 \
  --format="yaml(spec.template.spec.containers[0].env)"

# Test the health endpoint
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  https://your-service.run.app/api/health
```

## Rotating Secrets

To rotate a secret:

```bash
# Add new version
echo -n "new-value" | gcloud secrets versions add SECRET_NAME --data-file=-

# Redeploy Cloud Run (it will pick up :latest)
gcloud run services update bank-statement-parser --region=us-central1
```

## Local Development

For local development, continue using `.env.local`:

```bash
# .env.local (never commit this file!)
GOOGLE_PROJECT_ID=your-project-id
DOCAI_LOCATION=us
# ... etc
```

The application automatically detects the environment and uses:
- Secret Manager in Cloud Run (production)
- `.env.local` in local development

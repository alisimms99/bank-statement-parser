# Cloud Run Deployment Checklist

Use this checklist to ensure a successful deployment to Google Cloud Run with Secret Manager.

## Pre-Deployment

- [ ] Google Cloud Project created with billing enabled
- [ ] gcloud CLI installed and authenticated (`gcloud auth login`)
- [ ] Docker installed and running
- [ ] Project ID set: `gcloud config set project YOUR_PROJECT_ID`

## Enable Required APIs

```bash
gcloud services enable \
  secretmanager.googleapis.com \
  run.googleapis.com \
  containerregistry.googleapis.com \
  documentai.googleapis.com
```

- [ ] Secret Manager API enabled
- [ ] Cloud Run API enabled
- [ ] Container Registry API enabled
- [ ] Document AI API enabled

## Document AI Setup

- [ ] Document AI processor created (bank statement or invoice)
- [ ] Processor ID noted from the console
- [ ] Service account created with Document AI User role
- [ ] Service account JSON key downloaded

## Create Secrets in Secret Manager

Run the interactive script:
```bash
GCP_PROJECT_ID=your-project-id ./scripts/create-secrets.sh
```

Or create manually:

- [ ] `jwt-secret` - Random 32+ character string
- [ ] `google-project-id` - Your GCP project ID
- [ ] `docai-location` - Document AI region (us, eu, etc.)
- [ ] `docai-processor-id` - Your processor ID
- [ ] `gcp-service-account-json` - Service account JSON key file
- [ ] `cors-allow-origin` (optional) - Allowed origins
- [ ] `database-url` (optional) - Database connection string

## Grant IAM Permissions

The service account needs access to secrets:

```bash
# Get your project number (different from project ID)
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format="value(projectNumber)")

# Cloud Run uses the default Compute Engine service account
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for secret in jwt-secret google-project-id docai-location docai-processor-id gcp-service-account-json; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor"
done
```

- [ ] IAM permissions granted to Cloud Run service account

## Deploy to Cloud Run

Run the deployment script:
```bash
GCP_PROJECT_ID=your-project-id ./scripts/deploy-cloud-run.sh
```

Or deploy manually using the commands in `docs/SECRET_MANAGER.md`.

- [ ] Docker image built successfully
- [ ] Image pushed to Container Registry
- [ ] Cloud Run service deployed
- [ ] All secrets mounted correctly

## Post-Deployment Verification

- [ ] Service URL accessible
- [ ] Health check endpoint responds: `curl https://YOUR-SERVICE-URL/api/health`
- [ ] Check logs for startup errors: `gcloud run services logs read SERVICE_NAME --limit=50`
- [ ] Document AI configuration validated (if enabled)
- [ ] Upload a test PDF to verify Document AI integration

## Security Checklist

- [ ] No secrets in version control (`.env`, `.env.local` gitignored)
- [ ] All production secrets stored in Secret Manager only
- [ ] Service account has minimal required permissions
- [ ] CORS properly configured for your frontend domain
- [ ] JWT secret is secure and random (32+ characters)
- [ ] Old/unused secrets rotated or deleted

## Troubleshooting

### Service fails to start
- Check Cloud Run logs: `gcloud run services logs read SERVICE_NAME`
- Verify all required secrets exist: `gcloud secrets list`
- Check IAM permissions on secrets

### Document AI not working
- Verify `ENABLE_DOC_AI=true` is set
- Check processor ID is correct
- Verify service account has Document AI User role
- Check service account JSON is valid

### CORS errors
- Verify `CORS_ALLOW_ORIGIN` includes your frontend domain
- Check domain format (must include protocol: `https://example.com`)
- Test with `curl -H "Origin: https://your-domain.com" SERVICE_URL/api/health`

## Rollback Plan

If deployment fails:

1. Check previous revision:
```bash
gcloud run revisions list --service=SERVICE_NAME
```

2. Rollback to previous version:
```bash
gcloud run services update-traffic SERVICE_NAME --to-revisions=REVISION_NAME=100
```

## Monitoring

- [ ] Set up Cloud Monitoring alerts for errors
- [ ] Configure log-based metrics for Document AI usage
- [ ] Monitor Secret Manager access logs
- [ ] Set up uptime checks for the service

## Cost Optimization

- [ ] Set max instances limit (default: 10)
- [ ] Configure CPU allocation (1 CPU default)
- [ ] Set memory limit (1Gi default)
- [ ] Enable CPU throttling when idle
- [ ] Set request timeout (300s default)

## Next Steps

- Review [Secret Manager Integration Guide](SECRET_MANAGER.md) for detailed configuration
- Set up CI/CD pipeline for automated deployments
- Configure custom domain with Cloud Run
- Set up staging environment with separate secrets

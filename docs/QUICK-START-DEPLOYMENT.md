# Quick Start: Secure Cloud Run Deployment

This guide provides a streamlined path to deploy the Bank Statement Parser to Google Cloud Run with proper IAM lockdown.

## Prerequisites Checklist

- [ ] Google Cloud Project with billing enabled
- [ ] `gcloud` CLI installed and authenticated
- [ ] Docker installed locally
- [ ] Google Workspace domain (for IAM restriction)
- [ ] OAuth provider configured (for user authentication)

## 5-Step Deployment

### Step 1: Configure Environment Variables

Create required secrets in Google Secret Manager:

```bash
export PROJECT_ID="your-project-id"
export REGION="us-central1"

# Create secrets (replace with your actual values)
echo -n "your-database-url" | gcloud secrets create DATABASE_URL --data-file=-
echo -n "your-jwt-secret-min-32-chars" | gcloud secrets create JWT_SECRET --data-file=-
echo -n "${PROJECT_ID}" | gcloud secrets create GOOGLE_PROJECT_ID --data-file=-
echo -n "https://your-oauth-server.com" | gcloud secrets create OAUTH_SERVER_URL --data-file=-
echo -n "your-app-id" | gcloud secrets create VITE_APP_ID --data-file=-
```

### Step 2: Build and Push Container

```bash
export SERVICE_NAME="bank-statement-parser"

# Build image
docker build -t gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest .

# Push to Google Container Registry
gcloud auth configure-docker
docker push gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest
```

### Step 3: Deploy to Cloud Run

```bash
gcloud run deploy ${SERVICE_NAME} \
  --image gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest \
  --platform managed \
  --region ${REGION} \
  --project ${PROJECT_ID} \
  --port 8080 \
  --set-env-vars NODE_ENV=production \
  --update-secrets DATABASE_URL_FILE=/secrets/database-url:DATABASE_URL:latest \
  --update-secrets JWT_SECRET_FILE=/secrets/jwt-secret:JWT_SECRET:latest \
  --update-secrets GOOGLE_PROJECT_ID_FILE=/secrets/google-project-id:GOOGLE_PROJECT_ID:latest \
  --update-secrets OAUTH_SERVER_URL_FILE=/secrets/oauth-server-url:OAUTH_SERVER_URL:latest \
  --update-secrets VITE_APP_ID_FILE=/secrets/vite-app-id:VITE_APP_ID:latest \
  --allow-unauthenticated
```

**Note:** We temporarily allow unauthenticated access during deployment. This will be locked down in the next step.

### Step 4: Lock Down IAM

Use the provided script for automated IAM lockdown:

```bash
# Option A: Lock down to entire Workspace domain (recommended)
./scripts/setup-iam.sh ${SERVICE_NAME} ${REGION} "domain:yourdomain.com"

# Option B: Lock down to specific Google Group
./scripts/setup-iam.sh ${SERVICE_NAME} ${REGION} "group:app-users@yourdomain.com"

# Option C: Lock down to specific user
./scripts/setup-iam.sh ${SERVICE_NAME} ${REGION} "user:admin@yourdomain.com"
```

Or manually:

```bash
# Remove public access
gcloud run services remove-iam-policy-binding ${SERVICE_NAME} \
  --region ${REGION} \
  --member="allUsers" \
  --role="roles/run.invoker"

# Grant access to your Workspace
gcloud run services add-iam-policy-binding ${SERVICE_NAME} \
  --region ${REGION} \
  --member="domain:yourdomain.com" \
  --role="roles/run.invoker"
```

### Step 5: Verify Deployment

Get your service URL:

```bash
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
  --region ${REGION} \
  --format "value(status.url)")

echo "Service deployed at: ${SERVICE_URL}"
```

Verify IAM lockdown:

```bash
# Check IAM policy
gcloud run services get-iam-policy ${SERVICE_NAME} \
  --region ${REGION} \
  --format yaml

# Test unauthenticated access (should return 403)
curl -i "${SERVICE_URL}/api/health"
```

## Verification

### ✅ Success Indicators

1. **IAM Policy**: No `allUsers` or `allAuthenticatedUsers` bindings
2. **Unauthenticated Access**: Returns 403 Forbidden
3. **Workspace User Access**: Can access after OAuth login
4. **Application Functions**: Users can upload PDFs and export CSV

### ❌ Troubleshooting

| Issue | Solution |
|-------|----------|
| 403 for Workspace users | Verify domain name matches exactly: `gcloud organizations list` |
| Service still public | Ensure `allUsers` binding removed: `gcloud run services get-iam-policy` |
| OAuth fails | Check `OAUTH_SERVER_URL` and `VITE_APP_ID` configuration |
| Secrets not loading | Verify secret mounting paths and Secret Manager access |

For detailed troubleshooting, see [IAM Verification Guide](IAM-VERIFICATION.md).

## Post-Deployment Tasks

### 1. Configure CORS (if frontend is separate)

```bash
gcloud run services update ${SERVICE_NAME} \
  --region ${REGION} \
  --set-env-vars CORS_ALLOW_ORIGIN="https://your-frontend-domain.com"
```

### 2. Enable Document AI (optional)

```bash
# Add Document AI configuration
echo -n '{"type":"service_account",...}' | \
  gcloud secrets create GCP_SERVICE_ACCOUNT_JSON --data-file=-

gcloud run services update ${SERVICE_NAME} \
  --region ${REGION} \
  --set-env-vars ENABLE_DOC_AI=true \
  --update-secrets GCP_SERVICE_ACCOUNT_JSON_FILE=/secrets/gcp-service-account:GCP_SERVICE_ACCOUNT_JSON:latest \
  --set-env-vars DOCAI_LOCATION=us \
  --set-env-vars DOCAI_PROCESSOR_ID=your-processor-id
```

### 3. Set Up Monitoring

```bash
# View logs
gcloud run services logs read ${SERVICE_NAME} \
  --region ${REGION} \
  --limit 50

# Monitor metrics in Cloud Console
echo "https://console.cloud.google.com/run/detail/${REGION}/${SERVICE_NAME}/metrics?project=${PROJECT_ID}"
```

### 4. Enable Cloud Audit Logs

Track who accesses your service:

```bash
# Enable audit logs (requires appropriate permissions)
gcloud logging read "resource.type=cloud_run_revision \
  AND resource.labels.service_name=${SERVICE_NAME}" \
  --limit 20 \
  --format json
```

## Security Best Practices

1. **Rotate Secrets Regularly**: Update secrets in Secret Manager and redeploy
2. **Use Groups**: Manage access via Google Groups instead of individual users
3. **Monitor Access**: Regularly review Cloud Audit Logs
4. **Least Privilege**: Only grant `roles/run.invoker` to necessary users/groups
5. **Secure Database**: Ensure database is not publicly accessible
6. **HTTPS Only**: Cloud Run enforces HTTPS by default

## Updating the Deployment

To deploy a new version:

```bash
# Build new image with version tag
VERSION=$(date +%Y%m%d-%H%M%S)
docker build -t gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${VERSION} .
docker push gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${VERSION}

# Deploy new version (IAM policy is preserved)
gcloud run deploy ${SERVICE_NAME} \
  --image gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${VERSION} \
  --region ${REGION}
```

## Additional Resources

- **[Complete Deployment Guide](DEPLOYMENT.md)**: Detailed deployment instructions
- **[IAM Verification Guide](IAM-VERIFICATION.md)**: Step-by-step IAM verification
- **[Main README](../README.md)**: Application overview and local development

## Need Help?

Common commands for troubleshooting:

```bash
# View service details
gcloud run services describe ${SERVICE_NAME} --region ${REGION}

# Check recent logs
gcloud run services logs tail ${SERVICE_NAME} --region ${REGION}

# List all IAM bindings
gcloud run services get-iam-policy ${SERVICE_NAME} --region ${REGION}

# Get service URL
gcloud run services describe ${SERVICE_NAME} --region ${REGION} --format="value(status.url)"
```

For more help, see the full [Deployment Guide](DEPLOYMENT.md).

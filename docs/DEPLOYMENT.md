# Deployment Guide

This guide covers deploying the Bank Statement Parser to Google Cloud Run with proper security configuration.

## Prerequisites

- Google Cloud Project with billing enabled
- `gcloud` CLI installed and configured
- Docker installed (for local builds)
- Appropriate IAM permissions to:
  - Deploy to Cloud Run
  - Manage IAM policies
  - Create/mount secrets

## Cloud Run Deployment

### 1. Build and Push Container

```bash
# Set your project ID and region
export PROJECT_ID="your-project-id"
export REGION="us-central1"
export SERVICE_NAME="bank-statement-parser"

# Configure Docker for Google Container Registry
gcloud auth configure-docker

# Build the production image
docker build -t gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest .

# Push to GCR
docker push gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest
```

### 2. Deploy to Cloud Run

```bash
# Deploy the service (initial deployment allows unauthenticated access by default)
gcloud run deploy ${SERVICE_NAME} \
  --image gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest \
  --platform managed \
  --region ${REGION} \
  --project ${PROJECT_ID} \
  --port 8080 \
  --set-env-vars NODE_ENV=production
```

### 3. Configure Environment Variables and Secrets

Use Cloud Run's built-in secret management to securely provide credentials:

```bash
# Create secrets in Secret Manager (if not already created)
echo -n "your-database-url" | gcloud secrets create DATABASE_URL --data-file=-
echo -n "your-jwt-secret" | gcloud secrets create JWT_SECRET --data-file=-
echo -n "your-gcp-project-id" | gcloud secrets create GOOGLE_PROJECT_ID --data-file=-
echo -n "https://your-oauth-server.com" | gcloud secrets create OAUTH_SERVER_URL --data-file=-
echo -n "your-app-id" | gcloud secrets create VITE_APP_ID --data-file=-

# Mount secrets to your Cloud Run service
gcloud run services update ${SERVICE_NAME} \
  --region ${REGION} \
  --update-secrets DATABASE_URL_FILE=/secrets/database-url:DATABASE_URL:latest \
  --update-secrets JWT_SECRET_FILE=/secrets/jwt-secret:JWT_SECRET:latest \
  --update-secrets GOOGLE_PROJECT_ID_FILE=/secrets/google-project-id:GOOGLE_PROJECT_ID:latest \
  --update-secrets OAUTH_SERVER_URL_FILE=/secrets/oauth-server-url:OAUTH_SERVER_URL:latest \
  --update-secrets VITE_APP_ID_FILE=/secrets/vite-app-id:VITE_APP_ID:latest
```

For a complete list of required environment variables, see the [Environment Configuration](#environment-configuration) section below.

## IAM Security Configuration

By default, Cloud Run services are publicly accessible. To lock down access to your Google Workspace organization only, follow these steps:

### Remove Public Access

First, remove the `allUsers` IAM binding that allows unauthenticated access:

```bash
# Get current IAM policy
gcloud run services get-iam-policy ${SERVICE_NAME} \
  --region ${REGION} \
  --format json > iam-policy.json

# Remove allUsers binding
gcloud run services remove-iam-policy-binding ${SERVICE_NAME} \
  --region ${REGION} \
  --member="allUsers" \
  --role="roles/run.invoker"
```

### Grant Access to Your Workspace

Add the `roles/run.invoker` role to your Google Workspace domain or specific users/groups:

```bash
# For an entire Workspace domain
gcloud run services add-iam-policy-binding ${SERVICE_NAME} \
  --region ${REGION} \
  --member="domain:yourdomain.com" \
  --role="roles/run.invoker"

# For a specific user
gcloud run services add-iam-policy-binding ${SERVICE_NAME} \
  --region ${REGION} \
  --member="user:user@yourdomain.com" \
  --role="roles/run.invoker"

# For a Google Group
gcloud run services add-iam-policy-binding ${SERVICE_NAME} \
  --region ${REGION} \
  --member="group:team@yourdomain.com" \
  --role="roles/run.invoker"
```

### Verify IAM Configuration

Confirm that the service is properly locked down:

```bash
# Check the IAM policy
gcloud run services get-iam-policy ${SERVICE_NAME} \
  --region ${REGION} \
  --format yaml

# Expected output should show:
# - NO "allUsers" binding
# - Your domain/users/groups with "roles/run.invoker"
```

### Test Access Control

1. **Without authentication**: Attempting to access the Cloud Run URL directly should require login:
   ```bash
   curl https://your-service-url.run.app/api/health
   # Should return 403 Forbidden without proper authentication
   ```

2. **With authentication**: Users in your Workspace should be able to access after OAuth login through the application frontend.

For detailed verification steps and troubleshooting, see the **[IAM Verification Guide](IAM-VERIFICATION.md)**.

## OAuth2 Frontend Configuration

The application uses OAuth2 for user authentication. Ensure the following environment variables are properly configured:

```bash
# OAuth Server Configuration
OAUTH_SERVER_URL=https://your-oauth-server.com
VITE_APP_ID=your-app-id

# Optional: Restrict to specific owner
OWNER_OPEN_ID=owner-open-id-from-oauth-server
```

### How Authentication Works

1. Users access the frontend application
2. Frontend redirects to OAuth provider for authentication
3. After successful OAuth login, users receive a session token
4. Session token is stored as a secure HTTP-only cookie
5. All API requests include this cookie for authentication
6. Cloud Run's IAM layer ensures only authorized Workspace users can invoke the service
7. Application-level authentication ensures only logged-in users can access protected endpoints

This dual-layer approach provides both infrastructure-level (Cloud Run IAM) and application-level (OAuth2 session) security.

## Environment Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port (auto-set by Cloud Run) | `8080` |
| `NODE_ENV` | Runtime environment | `production` |
| `DATABASE_URL` | Database connection string | `mysql://...` |
| `JWT_SECRET` | Secret for signing session tokens | `your-secret-key` |
| `OAUTH_SERVER_URL` | OAuth provider base URL | `https://auth.example.com` |
| `VITE_APP_ID` | Application ID for OAuth | `your-app-id` |

### Optional Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `CORS_ALLOW_ORIGIN` | Allowed CORS origins (comma-separated) | `https://app.example.com` |
| `OWNER_OPEN_ID` | Specific owner identity for admin actions | `user-open-id` |
| `ENABLE_DOC_AI` | Enable Document AI processing | `true` |
| `GOOGLE_PROJECT_ID` | GCP project ID for Document AI | `my-project` |
| `DOCAI_LOCATION` | Document AI location | `us` |
| `GCP_SERVICE_ACCOUNT_JSON` | Service account credentials (JSON string) | `{"type":"service_account",...}` |

### Using Secret Manager

For production deployments, mount secrets as files using the `_FILE` suffix convention:

```bash
# The application reads from either:
# - Direct environment variable: DATABASE_URL
# - Secret file: DATABASE_URL_FILE (path to file containing the value)

gcloud run services update ${SERVICE_NAME} \
  --region ${REGION} \
  --update-secrets DATABASE_URL_FILE=/secrets/db:DATABASE_URL:latest \
  --update-secrets JWT_SECRET_FILE=/secrets/jwt:JWT_SECRET:latest \
  --update-secrets GCP_SERVICE_ACCOUNT_JSON_FILE=/secrets/gcp:GCP_CREDS:latest
```

The application automatically reads from `<NAME>_FILE` paths if the direct variable is not set (see `server/_core/env.ts` for implementation).

## Monitoring and Troubleshooting

### View Logs

```bash
# Stream logs from Cloud Run
gcloud run services logs read ${SERVICE_NAME} \
  --region ${REGION} \
  --limit 100 \
  --format "table(timestamp,message)"
```

### Common Issues

1. **403 Forbidden on Health Check**
   - This is expected after IAM lockdown
   - Health checks from Google Cloud Console will fail
   - Consider using authenticated monitoring or allowlist the health check

2. **OAuth Callback Fails**
   - Ensure `OAUTH_SERVER_URL` is correctly configured
   - Verify redirect URIs are registered with OAuth provider
   - Check that `VITE_APP_ID` matches your OAuth application

3. **Missing Environment Variables**
   - Check Cloud Run service configuration in Google Cloud Console
   - Verify secrets are properly mounted
   - Review startup logs for configuration errors

## Rollback Procedure

If you need to temporarily restore public access:

```bash
# Re-add allUsers binding (NOT RECOMMENDED for production)
gcloud run services add-iam-policy-binding ${SERVICE_NAME} \
  --region ${REGION} \
  --member="allUsers" \
  --role="roles/run.invoker"
```

## Additional Security Considerations

1. **CORS Configuration**: Restrict `CORS_ALLOW_ORIGIN` to your frontend domain only
2. **Session Security**: Use strong `JWT_SECRET` (minimum 32 characters)
3. **Database Access**: Ensure database is not publicly accessible
4. **Secret Rotation**: Regularly rotate secrets in Secret Manager
5. **Audit Logging**: Enable Cloud Audit Logs for Cloud Run
6. **VPC**: Consider deploying to VPC for additional network isolation

## Further Reading

- [Cloud Run IAM Documentation](https://cloud.google.com/run/docs/securing/managing-access)
- [Secret Manager Best Practices](https://cloud.google.com/secret-manager/docs/best-practices)
- [Cloud Run Security Hardening](https://cloud.google.com/run/docs/securing/overview)

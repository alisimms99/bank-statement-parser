# Secrets Reference Guide

Quick reference for all secrets used by the Bank Statement Parser application.

## Required Secrets for Production

| Secret Name | Environment Variable | File-Mount Variable | Description | Example Value |
|-------------|---------------------|---------------------|-------------|---------------|
| `jwt-secret` | `JWT_SECRET` | `JWT_SECRET_FILE` | Session cookie signing key | Random 32+ character string |
| `google-project-id` | `GOOGLE_PROJECT_ID` | `GOOGLE_PROJECT_ID_FILE` | GCP Project ID | `my-project-123` |
| `docai-location` | `DOCAI_LOCATION` | `DOCAI_LOCATION_FILE` | Document AI region | `us`, `eu`, `asia-northeast1` |
| `docai-processor-id` | `DOCAI_PROCESSOR_ID` | `DOCAI_PROCESSOR_ID_FILE` | Document AI processor ID | `abc123def456` |
| `gcp-service-account-json` | `GCP_SERVICE_ACCOUNT_JSON` | `GCP_SERVICE_ACCOUNT_JSON_FILE` | Service account credentials JSON | Full JSON key file content |

## Optional Secrets

| Secret Name | Environment Variable | File-Mount Variable | Description | Example Value |
|-------------|---------------------|---------------------|-------------|---------------|
| `cors-allow-origin` | `CORS_ALLOW_ORIGIN` | `CORS_ALLOW_ORIGIN_FILE` | Allowed CORS origins (comma-separated) | `https://app.example.com` |
| `database-url` | `DATABASE_URL` | `DATABASE_URL_FILE` | Database connection string | `mysql://user:pass@host:3306/db` |

## Non-Secret Configuration

These should be set as regular environment variables (not secrets):

| Variable | Description | Default | Values |
|----------|-------------|---------|--------|
| `ENABLE_DOC_AI` | Enable Document AI processing | `false` | `true`, `false` |
| `NODE_ENV` | Runtime environment | `development` | `production`, `development` |
| `PORT` | Server port | `3000` (dev), `8080` (prod) | Any valid TCP port |

## Secret Requirements

### JWT_SECRET
- **Length**: Minimum 32 characters (recommended: 64+ characters)
- **Type**: Random alphanumeric string
- **Generation**: Use `openssl rand -hex 32` or similar
- **Rotation**: Rotate every 90 days in production

### GOOGLE_PROJECT_ID
- **Format**: GCP project ID (lowercase, hyphens allowed)
- **Source**: Google Cloud Console
- **Note**: Must match the project where Document AI is enabled

### DOCAI_LOCATION
- **Format**: GCP region code
- **Common values**: `us`, `eu`, `asia-northeast1`, `us-central1`
- **Note**: Must match where your Document AI processor is deployed

### DOCAI_PROCESSOR_ID
- **Format**: Alphanumeric processor ID
- **Source**: Document AI console → Processors
- **Note**: Can be a bank processor, invoice processor, or generic OCR processor

### GCP_SERVICE_ACCOUNT_JSON
- **Format**: Complete JSON service account key
- **Required fields**: `type`, `project_id`, `private_key_id`, `private_key`, `client_email`
- **Recommended**: Mount as file in Cloud Run (use `GCP_SERVICE_ACCOUNT_JSON_FILE`)
- **IAM Roles Required**:
  - `roles/documentai.apiUser` (Document AI User)
  - Optional: `roles/storage.objectViewer` if using GCS

### CORS_ALLOW_ORIGIN
- **Format**: Comma-separated list of origins with protocol
- **Example**: `https://app.example.com,https://app2.example.com`
- **Note**: Do not use `*` with credentials (cookies/auth)

### DATABASE_URL
- **Format**: Database connection URL
- **MySQL**: `mysql://user:password@host:port/database`
- **PostgreSQL**: `postgresql://user:password@host:port/database`
- **Note**: Only required if using database features

## Secret Manager vs Environment Variables

### Use Secret Manager (Production) for:
✅ JWT secrets  
✅ Service account credentials  
✅ Database passwords  
✅ API keys  
✅ Any sensitive configuration  

### Use Environment Variables for:
✅ Feature flags (`ENABLE_DOC_AI`)  
✅ Runtime settings (`NODE_ENV`)  
✅ Non-sensitive configuration (`PORT`)  
✅ Public URLs  

## Local Development

For local development, create `.env.local`:

```bash
# .env.local (never commit this file!)
NODE_ENV=development
PORT=3000

# Auth
JWT_SECRET=local-dev-secret-not-for-production

# Document AI
ENABLE_DOC_AI=true
GOOGLE_PROJECT_ID=my-dev-project
DOCAI_LOCATION=us
DOCAI_PROCESSOR_ID=your-processor-id

# Credentials (option 1: file path)
GCP_SERVICE_ACCOUNT_PATH=/absolute/path/to/service-account.json

# Credentials (option 2: JSON string - not recommended for large files)
# GCP_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'

# Optional
CORS_ALLOW_ORIGIN=http://localhost:5173
```

## Backwards Compatibility

The application still supports legacy environment variable names:

| Legacy Variable | Current Variable | Status |
|----------------|------------------|---------|
| `GCP_PROJECT_ID` | `GOOGLE_PROJECT_ID` | ✅ Supported |
| `GCP_LOCATION` | `DOCAI_LOCATION` | ✅ Supported |
| `DOC_AI_BANK_PROCESSOR_ID` | `DOCAI_PROCESSOR_ID` | ✅ Supported |
| `DOC_AI_INVOICE_PROCESSOR_ID` | `DOCAI_PROCESSOR_ID` | ✅ Supported |
| `DOC_AI_OCR_PROCESSOR_ID` | `DOCAI_PROCESSOR_ID` | ✅ Supported |

Use the current variable names for new deployments.

## How readEnvOrFile Works

The application uses the `readEnvOrFile` helper to support both direct environment variables and file-mounted secrets:

```typescript
// Priority order:
// 1. Check JWT_SECRET environment variable
// 2. If not found, check JWT_SECRET_FILE environment variable
// 3. If JWT_SECRET_FILE is set, read the file at that path
// 4. Return the value (or empty string if not found)
```

This pattern works for all secrets listed above.

## Validation

The application validates required secrets on startup in production mode:

- ✅ All required secrets must be present
- ✅ Service account JSON must be valid JSON
- ✅ Document AI configuration must be complete if enabled
- ❌ Startup fails with clear error messages if validation fails

## Security Best Practices

1. **Never commit secrets** - Use `.gitignore` for `.env.local`
2. **Rotate secrets regularly** - Update Secret Manager versions quarterly
3. **Use minimal permissions** - Grant only required IAM roles
4. **Audit access** - Monitor Secret Manager access logs
5. **Separate environments** - Use different secrets for dev/staging/prod
6. **Delete unused secrets** - Clean up old versions and unused secrets
7. **Use file mounts for large secrets** - Especially for service account JSON

## Troubleshooting

### Secret not loading
1. Verify secret exists: `gcloud secrets describe SECRET_NAME`
2. Check IAM permissions
3. Verify file path if using `_FILE` convention
4. Check Cloud Run logs for detailed errors

### Invalid JSON error
1. Verify the secret contains valid JSON
2. Check for extra whitespace (automatically trimmed)
3. Try mounting as file instead of environment variable

### Document AI not ready
1. Verify all Document AI secrets are set
2. Check processor ID is correct
3. Verify service account has Document AI User role
4. Enable Document AI with `ENABLE_DOC_AI=true`

## Additional Resources

- [Secret Manager Documentation](SECRET_MANAGER.md)
- [Deployment Checklist](DEPLOYMENT_CHECKLIST.md)
- [Cloud Run Deployment Script](../scripts/deploy-cloud-run.sh)
- [Secret Creation Script](../scripts/create-secrets.sh)

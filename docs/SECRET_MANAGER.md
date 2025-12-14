# Secret Manager Integration Guide

This guide shows how to deploy the Bank Statement Parser to Google Cloud Run using Secret Manager to manage sensitive configuration values.

## Overview

The application supports reading secrets from both environment variables and Secret Manager mounted files. When deploying to Cloud Run, you can mount secrets as files using the `<NAME>_FILE` convention, where Cloud Run writes the secret value to a file path specified in the environment variable.

## Secrets to Configure

The following secrets should be stored in Secret Manager for production deployments:

### Required Secrets

1. **`jwt-secret`** - Session cookie signing key
   - Environment variable: `JWT_SECRET` or `JWT_SECRET_FILE`
   - Example value: A random 32+ character string

2. **`gcp-service-account-json`** - Service account credentials for Document AI
   - Environment variable: `GCP_SERVICE_ACCOUNT_JSON` or `GCP_SERVICE_ACCOUNT_JSON_FILE`
   - Example value: Full JSON service account key file content
   - **Note**: This should be mounted as a file (see below)

### Project Configuration Secrets

3. **`google-project-id`** - GCP Project ID
   - Environment variable: `GOOGLE_PROJECT_ID` or `GOOGLE_PROJECT_ID_FILE`
   - Example value: `my-project-123`

4. **`docai-location`** - Document AI processor location
   - Environment variable: `DOCAI_LOCATION` or `DOCAI_LOCATION_FILE`
   - Example value: `us` or `eu`

5. **`docai-processor-id`** - Document AI processor ID
   - Environment variable: `DOCAI_PROCESSOR_ID` or `DOCAI_PROCESSOR_ID_FILE`
   - Example value: Your processor ID from Document AI console

### Optional Secrets

6. **`cors-allow-origin`** - Allowed CORS origins (comma-separated)
   - Environment variable: `CORS_ALLOW_ORIGIN` or `CORS_ALLOW_ORIGIN_FILE`
   - Example value: `https://my-app.web.app,https://my-app.firebaseapp.com`

7. **`database-url`** - Database connection string (if using database features)
   - Environment variable: `DATABASE_URL` or `DATABASE_URL_FILE`
   - Example value: `mysql://user:pass@host:3306/db`

### Non-Secret Environment Variables

These should be set directly as environment variables (not secrets):

- **`ENABLE_DOC_AI`** - Set to `true` to enable Document AI, `false` to disable
- **`PORT`** - Cloud Run automatically sets this to `8080`
- **`NODE_ENV`** - Should be `production` for Cloud Run deployments

## Creating Secrets in Secret Manager

Use the `gcloud` CLI to create secrets in your project:

```bash
# Set your project ID
export PROJECT_ID="your-project-id"
gcloud config set project $PROJECT_ID

# Create JWT secret
echo -n "your-random-jwt-secret-key-here" | \
  gcloud secrets create jwt-secret --data-file=- --replication-policy=automatic

# Create GCP Project ID secret
echo -n "$PROJECT_ID" | \
  gcloud secrets create google-project-id --data-file=- --replication-policy=automatic

# Create Document AI location secret
echo -n "us" | \
  gcloud secrets create docai-location --data-file=- --replication-policy=automatic

# Create Document AI processor ID secret
echo -n "your-processor-id" | \
  gcloud secrets create docai-processor-id --data-file=- --replication-policy=automatic

# Create service account JSON secret from file
gcloud secrets create gcp-service-account-json \
  --data-file=./service-account-key.json \
  --replication-policy=automatic

# Create CORS origin secret (optional)
echo -n "https://your-app-domain.com" | \
  gcloud secrets create cors-allow-origin --data-file=- --replication-policy=automatic
```

## Deploying to Cloud Run with Secret Manager

### Option 1: Using gcloud CLI

Deploy your Cloud Run service with secrets mounted as environment variables or files:

```bash
#!/bin/bash
# deploy.sh - Example Cloud Run deployment script

set -euo pipefail

PROJECT_ID="your-project-id"
SERVICE_NAME="bank-statement-parser"
REGION="us-central1"
IMAGE="gcr.io/$PROJECT_ID/$SERVICE_NAME:latest"

# Build and push container
docker build -t $IMAGE .
docker push $IMAGE

# Configure Docker authentication for GCR
gcloud auth configure-docker gcr.io --quiet

# Deploy to Cloud Run with secrets
gcloud run deploy $SERVICE_NAME \
  --project=$PROJECT_ID \
  --region=$REGION \
  --image=$IMAGE \
  --platform=managed \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --set-env-vars="NODE_ENV=production,ENABLE_DOC_AI=true,GCP_SERVICE_ACCOUNT_JSON_FILE=/secrets/gcp-service-account.json" \
  --update-secrets="JWT_SECRET=jwt-secret:latest" \
  --update-secrets="GOOGLE_PROJECT_ID=google-project-id:latest" \
  --update-secrets="DOCAI_LOCATION=docai-location:latest" \
  --update-secrets="DOCAI_PROCESSOR_ID=docai-processor-id:latest" \
  --update-secrets="CORS_ALLOW_ORIGIN=cors-allow-origin:latest" \
  --update-secrets="/secrets/gcp-service-account.json=gcp-service-account-json:latest"

echo "Deployment complete!"
```

**Important**: For the service account JSON, we:
1. Mount the secret as a file using: `--update-secrets="/secrets/gcp-service-account.json=gcp-service-account-json:latest"`
2. Set the environment variable to point to the mounted file: `--set-env-vars="GCP_SERVICE_ACCOUNT_JSON_FILE=/secrets/gcp-service-account.json"`

The application's `readEnvOrFile` function will read the `GCP_SERVICE_ACCOUNT_JSON_FILE` environment variable and load the secret from the mounted file.

### Option 2: Using Cloud Run YAML Configuration

Create a `service.yaml` file:

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: bank-statement-parser
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/maxScale: '10'
    spec:
      containerConcurrency: 80
      timeoutSeconds: 300
      containers:
      - image: gcr.io/PROJECT_ID/bank-statement-parser:latest
        ports:
        - name: http1
          containerPort: 8080
        env:
        - name: NODE_ENV
          value: "production"
        - name: ENABLE_DOC_AI
          value: "true"
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: jwt-secret
              key: latest
        - name: GOOGLE_PROJECT_ID
          valueFrom:
            secretKeyRef:
              name: google-project-id
              key: latest
        - name: DOCAI_LOCATION
          valueFrom:
            secretKeyRef:
              name: docai-location
              key: latest
        - name: DOCAI_PROCESSOR_ID
          valueFrom:
            secretKeyRef:
              name: docai-processor-id
              key: latest
        - name: CORS_ALLOW_ORIGIN
          valueFrom:
            secretKeyRef:
              name: cors-allow-origin
              key: latest
        - name: GCP_SERVICE_ACCOUNT_JSON_FILE
          value: "/secrets/gcp-service-account.json"
        volumeMounts:
        - name: gcp-service-account
          mountPath: /secrets
          readOnly: true
        resources:
          limits:
            memory: 1Gi
            cpu: '1'
      volumes:
      - name: gcp-service-account
        secret:
          secretName: gcp-service-account-json
          items:
          - key: latest
            path: gcp-service-account.json
```

Deploy using:

```bash
gcloud run services replace service.yaml --region=us-central1
```

## File-Mount vs Environment Variable

The application's `readEnvOrFile` function automatically tries both methods:

1. First, it checks for the direct environment variable (e.g., `JWT_SECRET`)
2. If not found, it looks for `<NAME>_FILE` (e.g., `JWT_SECRET_FILE`)
3. If `<NAME>_FILE` is set, it reads the file path and loads the content

### When to Use File Mounts

Use file mounts for:
- **Service account JSON credentials** - These can be large and contain special characters
- **Large secrets** - Anything over a few KB

Use direct environment variables for:
- **Simple strings** - Project IDs, processor IDs, short secrets
- **Flags and configuration** - Non-sensitive values like `ENABLE_DOC_AI`

## Security Best Practices

1. **Never commit secrets to version control** - Use `.env.local` for local development only
2. **Use separate secrets for each environment** - Don't share secrets between dev/staging/prod
3. **Rotate secrets regularly** - Update secret versions in Secret Manager
4. **Grant minimal permissions** - Cloud Run service accounts should only access required secrets
5. **Audit secret access** - Monitor Secret Manager access logs

## Verifying Secret Configuration

After deployment, check that secrets are properly loaded:

1. **Check Cloud Run logs** for any secret loading errors:
```bash
gcloud run services logs read bank-statement-parser \
  --project=your-project-id \
  --region=us-central1 \
  --limit=50
```

2. **Test the /api/status endpoint** (if available) to verify Document AI configuration
3. **Check startup logs** for any validation errors related to missing secrets

## Troubleshooting

### Secret not found

```
Error: Failed to read JWT_SECRET_FILE
```

**Solution**: Verify the secret exists and Cloud Run has permission to access it:
```bash
gcloud secrets describe jwt-secret --project=your-project-id
gcloud secrets list --project=your-project-id
```

Grant the Cloud Run service account access (replace PROJECT_NUMBER with your actual project number):
```bash
# Get your project number
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format="value(projectNumber)")

# Grant access to the default Compute Engine service account (used by Cloud Run)
gcloud secrets add-iam-policy-binding jwt-secret \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Document AI not ready

```
Document AI misconfigured. Missing: GOOGLE_PROJECT_ID (or GCP_PROJECT_ID)
```

**Solution**: Ensure all required Document AI secrets are created and mounted. The application validates these on startup in production mode.

### Service account JSON parsing error

```
Failed to parse GCP service account JSON
```

**Solution**: 
1. Verify the secret contains valid JSON
2. Ensure no extra whitespace or newlines (the app trims these automatically)
3. Try mounting as a file instead of an environment variable

## Local Development with Secret Manager

For local development, you can:

1. **Use `.env.local`** with direct values (never commit this file)
2. **Use Application Default Credentials** by running `gcloud auth application-default login`
3. **Reference local service account files** using `GCP_SERVICE_ACCOUNT_PATH`

Example `.env.local`:

```bash
NODE_ENV=development
ENABLE_DOC_AI=true
GOOGLE_PROJECT_ID=my-dev-project
DOCAI_LOCATION=us
DOCAI_PROCESSOR_ID=my-processor-id
GCP_SERVICE_ACCOUNT_PATH=/path/to/service-account-key.json
JWT_SECRET=local-dev-secret-not-for-production
```

## Migrating from .env to Secret Manager

If you're currently using `.env` files in production:

1. Create all secrets in Secret Manager using the commands above
2. Update your deployment script to use `--update-secrets` flags
3. Remove any `.env` references from your deployment pipeline
4. Verify the deployment works with secrets
5. Delete or invalidate old credentials that were in `.env` files

## Additional Resources

- [Cloud Run Secret Manager Integration](https://cloud.google.com/run/docs/configuring/secrets)
- [Secret Manager Documentation](https://cloud.google.com/secret-manager/docs)
- [Cloud Run Environment Variables](https://cloud.google.com/run/docs/configuring/environment-variables)
- [Service Account Best Practices](https://cloud.google.com/iam/docs/best-practices-service-accounts)

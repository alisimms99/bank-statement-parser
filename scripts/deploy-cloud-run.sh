#!/usr/bin/env bash
# Deploy Bank Statement Parser to Google Cloud Run with Secret Manager
# This script builds the Docker image and deploys to Cloud Run with secrets mounted

set -euo pipefail

# ============================================================================
# Configuration Variables
# ============================================================================

# Required: Set your GCP project ID
PROJECT_ID="${GCP_PROJECT_ID:-}"
if [ -z "$PROJECT_ID" ]; then
  echo "Error: GCP_PROJECT_ID environment variable must be set"
  echo "Usage: GCP_PROJECT_ID=your-project-id ./scripts/deploy-cloud-run.sh"
  exit 1
fi

# Service configuration
SERVICE_NAME="${SERVICE_NAME:-bank-statement-parser}"
REGION="${REGION:-us-central1}"
IMAGE_NAME="${IMAGE_NAME:-gcr.io/$PROJECT_ID/$SERVICE_NAME}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE="$IMAGE_NAME:$IMAGE_TAG"

# Resource configuration
MEMORY="${MEMORY:-1Gi}"
CPU="${CPU:-1}"
MAX_INSTANCES="${MAX_INSTANCES:-10}"
TIMEOUT="${TIMEOUT:-300}"
CONCURRENCY="${CONCURRENCY:-80}"

# Feature flags
ENABLE_DOC_AI="${ENABLE_DOC_AI:-true}"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-false}"

# ============================================================================
# Preflight Checks
# ============================================================================

echo "======================================"
echo "Cloud Run Deployment Configuration"
echo "======================================"
echo "Project ID:      $PROJECT_ID"
echo "Service Name:    $SERVICE_NAME"
echo "Region:          $REGION"
echo "Image:           $IMAGE"
echo "Memory:          $MEMORY"
echo "CPU:             $CPU"
echo "Max Instances:   $MAX_INSTANCES"
echo "Enable Doc AI:   $ENABLE_DOC_AI"
echo "======================================"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
  echo "Error: gcloud CLI is not installed"
  echo "Install it from: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

# Set the active project
echo "Setting active GCP project to $PROJECT_ID..."
gcloud config set project "$PROJECT_ID"

# ============================================================================
# Required Secrets Validation
# ============================================================================

echo ""
echo "Validating required secrets exist in Secret Manager..."

REQUIRED_SECRETS=(
  "jwt-secret"
  "google-project-id"
  "docai-location"
  "docai-processor-id"
  "gcp-service-account-json"
)

MISSING_SECRETS=()

for secret in "${REQUIRED_SECRETS[@]}"; do
  if ! gcloud secrets describe "$secret" --project="$PROJECT_ID" &>/dev/null; then
    MISSING_SECRETS+=("$secret")
    echo "  ✗ Missing: $secret"
  else
    echo "  ✓ Found: $secret"
  fi
done

if [ ${#MISSING_SECRETS[@]} -ne 0 ]; then
  echo ""
  echo "Error: The following required secrets are missing from Secret Manager:"
  for secret in "${MISSING_SECRETS[@]}"; do
    echo "  - $secret"
  done
  echo ""
  echo "Please create them using the commands in docs/SECRET_MANAGER.md"
  echo "Or run: ./scripts/create-secrets.sh"
  exit 1
fi

echo "✓ All required secrets found"

# ============================================================================
# Build and Push Docker Image
# ============================================================================

echo ""
echo "Configuring Docker authentication for GCR..."
gcloud auth configure-docker gcr.io --quiet

echo ""
echo "Building Docker image..."
docker build -t "$IMAGE" .

echo ""
echo "Pushing image to Google Container Registry..."
docker push "$IMAGE"

echo "✓ Image pushed successfully: $IMAGE"

# ============================================================================
# Deploy to Cloud Run
# ============================================================================

echo ""
echo "Deploying to Cloud Run..."

DEPLOY_CMD=(
  gcloud run deploy "$SERVICE_NAME"
  --project="$PROJECT_ID"
  --region="$REGION"
  --image="$IMAGE"
  --platform=managed
  --memory="$MEMORY"
  --cpu="$CPU"
  --timeout="$TIMEOUT"
  --concurrency="$CONCURRENCY"
  --max-instances="$MAX_INSTANCES"
  --set-env-vars="NODE_ENV=production,ENABLE_DOC_AI=$ENABLE_DOC_AI,GCP_SERVICE_ACCOUNT_JSON_FILE=/secrets/gcp-service-account.json"
  --update-secrets="JWT_SECRET=jwt-secret:latest"
  --update-secrets="GOOGLE_PROJECT_ID=google-project-id:latest"
  --update-secrets="DOCAI_LOCATION=docai-location:latest"
  --update-secrets="DOCAI_PROCESSOR_ID=docai-processor-id:latest"
  --update-secrets="/secrets/gcp-service-account.json=gcp-service-account-json:latest"
)

# Add optional CORS secret if it exists
if gcloud secrets describe "cors-allow-origin" --project="$PROJECT_ID" &>/dev/null; then
  echo "  ✓ Adding CORS_ALLOW_ORIGIN from Secret Manager"
  DEPLOY_CMD+=(--update-secrets="CORS_ALLOW_ORIGIN=cors-allow-origin:latest")
fi

# Add optional DATABASE_URL secret if it exists
if gcloud secrets describe "database-url" --project="$PROJECT_ID" &>/dev/null; then
  echo "  ✓ Adding DATABASE_URL from Secret Manager"
  DEPLOY_CMD+=(--update-secrets="DATABASE_URL=database-url:latest")
fi

# Set authentication policy
if [ "$ALLOW_UNAUTHENTICATED" = "true" ]; then
  DEPLOY_CMD+=(--allow-unauthenticated)
else
  DEPLOY_CMD+=(--no-allow-unauthenticated)
fi

# Execute deployment
"${DEPLOY_CMD[@]}"

# ============================================================================
# Post-Deployment
# ============================================================================

echo ""
echo "======================================"
echo "Deployment Complete!"
echo "======================================"

# Get service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format="value(status.url)")

echo "Service URL: $SERVICE_URL"
echo ""
echo "Check deployment status:"
echo "  gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID"
echo ""
echo "View logs:"
echo "  gcloud run services logs read $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --limit=50"
echo ""
echo "Test the service:"
echo "  curl $SERVICE_URL/api/health"
echo ""

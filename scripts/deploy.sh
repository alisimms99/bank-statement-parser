#!/bin/bash
set -e

# Deployment script for Cloud Run
# Usage: ./scripts/deploy.sh [SERVICE_NAME] [REGION]

PROJECT_ID=${GCP_PROJECT_ID:-$(gcloud config get-value project)}
SERVICE_NAME=${1:-bank-statement-parser}
REGION=${2:-us-central1}
IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}"
COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")

echo "🚀 Deploying to Cloud Run"
echo "Project: ${PROJECT_ID}"
echo "Service: ${SERVICE_NAME}"
echo "Region: ${REGION}"
echo "Image: ${IMAGE_NAME}:${COMMIT_SHA}"
echo ""

# Check if authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
  echo "❌ Not authenticated with gcloud. Please run: gcloud auth login"
  exit 1
fi

# Set project
echo "📋 Setting project to ${PROJECT_ID}..."
gcloud config set project "${PROJECT_ID}"

# Configure Docker for Artifact Registry
echo "🐳 Configuring Docker for Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# Build Docker image
echo "🔨 Building Docker image..."
docker build -t "${IMAGE_NAME}:${COMMIT_SHA}" -t "${IMAGE_NAME}:latest" .

# Push Docker image
echo "📤 Pushing Docker image to Artifact Registry..."
docker push "${IMAGE_NAME}:${COMMIT_SHA}"
docker push "${IMAGE_NAME}:latest"

# Deploy to Cloud Run
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_NAME}:${COMMIT_SHA}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --set-env-vars "NODE_ENV=production,WORKSPACE_DOMAIN=*.run.app" \
  --update-secrets="OPENAI_API_KEY=OPENAI_API_KEY:latest" \
  --format=json > deploy-output.json

SERVICE_URL=$(jq -r '.status.url' deploy-output.json)
echo ""
echo "✅ Deployment complete!"
echo "🌐 Service URL: ${SERVICE_URL}"
echo ""
echo "Testing health endpoint..."
sleep 5
if curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/api/status" | grep -q "200"; then
  echo "✅ Service is healthy!"
else
  echo "⚠️  Service may not be ready yet. Check logs:"
  echo "   gcloud run logs tail ${SERVICE_NAME} --region ${REGION}"
fi

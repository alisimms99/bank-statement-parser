#!/bin/bash
set -e

# Deployment script for Cloud Run
# Usage: ./scripts/deploy.sh [SERVICE_NAME] [REGION]
#
# This script:
# 1. Verifies all required environment variables/secrets exist
# 2. Builds and pushes Docker image
# 3. Deploys to Cloud Run with persistent env vars from env.yaml
# 4. Sets secrets from Google Secret Manager
# 5. Validates deployment with health checks

PROJECT_ID=${GCP_PROJECT_ID:-$(gcloud config get-value project)}
SERVICE_NAME=${1:-bank-statement-parser}
REGION=${2:-us-central1}
IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${SERVICE_NAME}"
COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${ROOT_DIR}/env.yaml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "  Cloud Run Deployment"
echo "========================================"
echo ""
echo "Project:  ${PROJECT_ID}"
echo "Service:  ${SERVICE_NAME}"
echo "Region:   ${REGION}"
echo "Image:    ${IMAGE_NAME}:${COMMIT_SHA}"
echo ""

# =============================================================================
# PRE-DEPLOYMENT VERIFICATION
# =============================================================================

echo "----------------------------------------"
echo "Step 1: Pre-deployment verification"
echo "----------------------------------------"

# Check if authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
  echo -e "${RED}ERROR: Not authenticated with gcloud${NC}"
  echo "Please run: gcloud auth login"
  exit 1
fi
echo -e "${GREEN}[OK]${NC} gcloud authenticated"

# Check if env.yaml exists
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}ERROR: env.yaml not found at $ENV_FILE${NC}"
  echo "Please create env.yaml with required environment variables."
  exit 1
fi
echo -e "${GREEN}[OK]${NC} env.yaml found"

# Required secrets in Secret Manager
REQUIRED_SECRETS=(
  "GOOGLE_CLIENT_ID"
  "GOOGLE_CLIENT_SECRET"
  "GCP_SERVICE_ACCOUNT_JSON"
  "OPENAI_API_KEY"
)

# Optional secrets (warn if missing but don't fail)
OPTIONAL_SECRETS=(
  "JWT_SECRET"
  "DOCAI_PROCESSOR_ID"
  "DATABASE_URL"
)

echo ""
echo "Checking required secrets in Secret Manager..."

MISSING_SECRETS=()
for secret in "${REQUIRED_SECRETS[@]}"; do
  if gcloud secrets describe "$secret" --project="$PROJECT_ID" &>/dev/null; then
    echo -e "${GREEN}[OK]${NC} Secret '$secret' exists"
  else
    echo -e "${RED}[MISSING]${NC} Secret '$secret' not found"
    MISSING_SECRETS+=("$secret")
  fi
done

if [ ${#MISSING_SECRETS[@]} -ne 0 ]; then
  echo ""
  echo -e "${RED}ERROR: Missing required secrets in Secret Manager:${NC}"
  for secret in "${MISSING_SECRETS[@]}"; do
    echo "  - $secret"
  done
  echo ""
  echo "To create a secret, run:"
  echo "  echo -n 'YOUR_VALUE' | gcloud secrets create SECRET_NAME --data-file=- --project=$PROJECT_ID"
  echo ""
  echo "Or for a JSON file (like service account):"
  echo "  gcloud secrets create GCP_SERVICE_ACCOUNT_JSON --data-file=service-account.json --project=$PROJECT_ID"
  exit 1
fi

echo ""
echo "Checking optional secrets..."
for secret in "${OPTIONAL_SECRETS[@]}"; do
  if gcloud secrets describe "$secret" --project="$PROJECT_ID" &>/dev/null; then
    echo -e "${GREEN}[OK]${NC} Secret '$secret' exists"
  else
    echo -e "${YELLOW}[WARN]${NC} Optional secret '$secret' not found (may cause limited functionality)"
  fi
done

echo ""
echo -e "${GREEN}Pre-deployment verification passed!${NC}"

# =============================================================================
# BUILD AND PUSH
# =============================================================================

echo ""
echo "----------------------------------------"
echo "Step 2: Build and push Docker image"
echo "----------------------------------------"

# Set project
echo "Setting project to ${PROJECT_ID}..."
gcloud config set project "${PROJECT_ID}"

# Configure Docker for Artifact Registry
echo "Configuring Docker for Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# Build Docker image
echo "Building Docker image..."
docker build -t "${IMAGE_NAME}:${COMMIT_SHA}" -t "${IMAGE_NAME}:latest" .

# Push Docker image
echo "Pushing Docker image to Artifact Registry..."
docker push "${IMAGE_NAME}:${COMMIT_SHA}"
docker push "${IMAGE_NAME}:latest"

echo -e "${GREEN}Docker image pushed successfully!${NC}"

# =============================================================================
# DEPLOY TO CLOUD RUN
# =============================================================================

echo ""
echo "----------------------------------------"
echo "Step 3: Deploy to Cloud Run"
echo "----------------------------------------"

# Build secrets argument
# Format: ENV_VAR=SECRET_NAME:VERSION
SECRETS_ARG="GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest"
SECRETS_ARG="${SECRETS_ARG},GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest"
SECRETS_ARG="${SECRETS_ARG},GCP_SERVICE_ACCOUNT_JSON=GCP_SERVICE_ACCOUNT_JSON:latest"
SECRETS_ARG="${SECRETS_ARG},OPENAI_API_KEY=OPENAI_API_KEY:latest"

# Add optional secrets if they exist
for secret in "${OPTIONAL_SECRETS[@]}"; do
  if gcloud secrets describe "$secret" --project="$PROJECT_ID" &>/dev/null; then
    SECRETS_ARG="${SECRETS_ARG},${secret}=${secret}:latest"
  fi
done

echo "Deploying to Cloud Run with:"
echo "  - Environment variables from: env.yaml"
echo "  - Secrets: ${REQUIRED_SECRETS[*]}"
echo ""

gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_NAME}:${COMMIT_SHA}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --env-vars-file="${ENV_FILE}" \
  --set-secrets="${SECRETS_ARG}" \
  --format=json > deploy-output.json

SERVICE_URL=$(jq -r '.status.url' deploy-output.json)
echo ""
echo -e "${GREEN}Deployment complete!${NC}"
echo "Service URL: ${SERVICE_URL}"

# =============================================================================
# POST-DEPLOYMENT VERIFICATION
# =============================================================================

echo ""
echo "----------------------------------------"
echo "Step 4: Post-deployment verification"
echo "----------------------------------------"

# Wait for service to be ready
echo "Waiting for service to be ready..."
sleep 10

# Test health endpoint
echo ""
echo "Testing /api/health endpoint..."
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "${SERVICE_URL}/api/health" 2>/dev/null || echo -e "\n000")
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | head -n -1)
HEALTH_CODE=$(echo "$HEALTH_RESPONSE" | tail -n 1)

if [ "$HEALTH_CODE" = "200" ]; then
  echo -e "${GREEN}[OK]${NC} Health check passed (HTTP $HEALTH_CODE)"
  echo "    Response: $HEALTH_BODY"
else
  echo -e "${RED}[FAIL]${NC} Health check failed (HTTP $HEALTH_CODE)"
  echo "    Response: $HEALTH_BODY"
  echo ""
  echo "Check logs with: gcloud run logs tail ${SERVICE_NAME} --region ${REGION}"
fi

# Test auth status endpoint
echo ""
echo "Testing /api/auth/status endpoint..."
AUTH_RESPONSE=$(curl -s -w "\n%{http_code}" "${SERVICE_URL}/api/auth/status" 2>/dev/null || echo -e "\n000")
AUTH_BODY=$(echo "$AUTH_RESPONSE" | head -n -1)
AUTH_CODE=$(echo "$AUTH_RESPONSE" | tail -n 1)

if [ "$AUTH_CODE" = "200" ] || [ "$AUTH_CODE" = "401" ]; then
  echo -e "${GREEN}[OK]${NC} Auth endpoint responding (HTTP $AUTH_CODE)"
  echo "    Response: $AUTH_BODY"
else
  echo -e "${RED}[FAIL]${NC} Auth endpoint not responding correctly (HTTP $AUTH_CODE)"
  echo "    Response: $AUTH_BODY"
fi

# Test OAuth configuration by checking if redirect works
echo ""
echo "Testing OAuth configuration..."
OAUTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -L --max-redirs 0 "${SERVICE_URL}/api/auth/google" 2>/dev/null || echo "000")
if [ "$OAUTH_RESPONSE" = "302" ] || [ "$OAUTH_RESPONSE" = "307" ]; then
  echo -e "${GREEN}[OK]${NC} OAuth redirect configured (HTTP $OAUTH_RESPONSE)"
else
  echo -e "${YELLOW}[WARN]${NC} OAuth may not be configured correctly (HTTP $OAUTH_RESPONSE)"
  echo "    This could indicate missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET"
fi

# =============================================================================
# SUMMARY
# =============================================================================

echo ""
echo "========================================"
echo "  Deployment Summary"
echo "========================================"
echo ""
echo "Service URL: ${SERVICE_URL}"
echo "Image:       ${IMAGE_NAME}:${COMMIT_SHA}"
echo ""

# Count passed/failed checks
CHECKS_PASSED=0
CHECKS_FAILED=0

if [ "$HEALTH_CODE" = "200" ]; then ((CHECKS_PASSED++)); else ((CHECKS_FAILED++)); fi
if [ "$AUTH_CODE" = "200" ] || [ "$AUTH_CODE" = "401" ]; then ((CHECKS_PASSED++)); else ((CHECKS_FAILED++)); fi
if [ "$OAUTH_RESPONSE" = "302" ] || [ "$OAUTH_RESPONSE" = "307" ]; then ((CHECKS_PASSED++)); else ((CHECKS_FAILED++)); fi

if [ $CHECKS_FAILED -eq 0 ]; then
  echo -e "${GREEN}All checks passed! ($CHECKS_PASSED/$((CHECKS_PASSED + CHECKS_FAILED)))${NC}"
  echo ""
  echo "Your app is ready at: ${SERVICE_URL}"
else
  echo -e "${YELLOW}Some checks failed: $CHECKS_PASSED passed, $CHECKS_FAILED failed${NC}"
  echo ""
  echo "View logs: gcloud run logs tail ${SERVICE_NAME} --region ${REGION}"
  echo "View service: gcloud run services describe ${SERVICE_NAME} --region ${REGION}"
fi

echo ""

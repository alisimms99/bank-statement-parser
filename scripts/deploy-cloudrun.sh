#!/usr/bin/env bash
set -euo pipefail

# Manual deploy helper for Cloud Run.
# Requires: gcloud, docker, pnpm

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="${PROJECT_ID:-ojpm-bank-parser}"
REGION="${REGION:-us-central1}"
AR_REPO="${AR_REPO:-bank-parser}"
IMAGE_NAME="${IMAGE_NAME:-bank-parser}"
TAG="${TAG:-latest}"
SERVICE_NAME="${SERVICE_NAME:-bank-statement-parser}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-docai-runner@ojpm-bank-parser.iam.gserviceaccount.com}"

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${IMAGE_NAME}:${TAG}"

echo "==> Building production artifact (pnpm build:prod)"
pnpm build:prod

echo "==> Ensuring Artifact Registry auth for Docker"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

echo "==> Building Docker image: ${IMAGE_URI}"
docker build --tag "${IMAGE_URI}" .

echo "==> Pushing Docker image: ${IMAGE_URI}"
docker push "${IMAGE_URI}"

echo "==> Deploying to Cloud Run: ${SERVICE_NAME} (${REGION})"
gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE_URI}" \
  --region="${REGION}" \
  --service-account="${RUNTIME_SERVICE_ACCOUNT}" \
  --allow-unauthenticated=false

echo "==> Done"

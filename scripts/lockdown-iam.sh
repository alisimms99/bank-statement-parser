#!/bin/bash
set -e

SERVICE_NAME=${1:-bank-statement-parser}
REGION=${2:-us-central1}
DOMAIN=${3:-yourdomain.com}

echo "Locking down IAM for $SERVICE_NAME in $REGION..."

# Remove public access
gcloud run services remove-iam-policy-binding $SERVICE_NAME \
  --region=$REGION \
  --member="allUsers" \
  --role="roles/run.invoker" 2>/dev/null || echo "allUsers binding not found (already removed)"

# Add domain access
gcloud run services add-iam-policy-binding $SERVICE_NAME \
  --region=$REGION \
  --member="domain:$DOMAIN" \
  --role="roles/run.invoker"

echo "✅ IAM lockdown complete"
echo ""
echo "Verify with:"
echo "  gcloud run services get-iam-policy $SERVICE_NAME --region=$REGION"

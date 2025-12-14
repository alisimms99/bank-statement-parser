#!/usr/bin/env bash
# Cloud Run IAM Lockdown Setup Script
# 
# This script removes public access and grants Cloud Run invoker role
# to your Google Workspace domain or specific users/groups.
#
# Usage:
#   ./scripts/setup-iam.sh <service-name> <region> <member>
#
# Examples:
#   # Lock down to entire Workspace domain
#   ./scripts/setup-iam.sh bank-statement-parser us-central1 domain:example.com
#
#   # Lock down to specific user
#   ./scripts/setup-iam.sh bank-statement-parser us-central1 user:admin@example.com
#
#   # Lock down to Google Group
#   ./scripts/setup-iam.sh bank-statement-parser us-central1 group:team@example.com

set -euo pipefail -E

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Check arguments
if [ $# -lt 3 ]; then
  echo "Usage: $0 <service-name> <region> <member>"
  echo ""
  echo "Examples:"
  echo "  $0 bank-statement-parser us-central1 domain:example.com"
  echo "  $0 bank-statement-parser us-central1 user:admin@example.com"
  echo "  $0 bank-statement-parser us-central1 group:team@example.com"
  exit 1
fi

SERVICE_NAME="$1"
REGION="$2"
MEMBER="$3"

print_info "Starting IAM lockdown for Cloud Run service: ${SERVICE_NAME}"
print_info "Region: ${REGION}"
print_info "Granting access to: ${MEMBER}"

# Verify service exists
print_info "Verifying service exists..."
if ! gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format="value(status.url)" >/dev/null 2>&1; then
  print_error "Service '${SERVICE_NAME}' not found in region '${REGION}'"
  exit 1
fi

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format="value(status.url)")
print_info "Service URL: ${SERVICE_URL}"

# Get current IAM policy
print_info "Fetching current IAM policy..."
CURRENT_POLICY=$(gcloud run services get-iam-policy "${SERVICE_NAME}" --region="${REGION}" --format=json)

# Check if allUsers binding exists
if echo "${CURRENT_POLICY}" | grep -q '"allUsers"'; then
  print_warning "Found 'allUsers' binding - this service is currently publicly accessible"
  
  # Remove allUsers binding
  print_info "Removing public access (allUsers)..."
  ERROR_OUTPUT=$(gcloud run services remove-iam-policy-binding "${SERVICE_NAME}" \
    --region="${REGION}" \
    --member="allUsers" \
    --role="roles/run.invoker" \
    --quiet 2>&1) || true
  
  if echo "${ERROR_OUTPUT}" | grep -q "NOT_FOUND"; then
    print_info "allUsers binding was already removed"
  elif [ -z "${ERROR_OUTPUT}" ]; then
    print_info "Successfully removed allUsers binding"
  else
    print_warning "Unexpected response: ${ERROR_OUTPUT}"
  fi
else
  print_info "No 'allUsers' binding found - service is already private"
fi

# Remove allAuthenticatedUsers if present
if echo "${CURRENT_POLICY}" | grep -q '"allAuthenticatedUsers"'; then
  print_warning "Found 'allAuthenticatedUsers' binding - removing..."
  ERROR_OUTPUT=$(gcloud run services remove-iam-policy-binding "${SERVICE_NAME}" \
    --region="${REGION}" \
    --member="allAuthenticatedUsers" \
    --role="roles/run.invoker" \
    --quiet 2>&1) || true
  
  if echo "${ERROR_OUTPUT}" | grep -q "NOT_FOUND"; then
    print_info "allAuthenticatedUsers binding was already removed"
  elif [ -z "${ERROR_OUTPUT}" ]; then
    print_info "Successfully removed allAuthenticatedUsers binding"
  else
    print_warning "Unexpected response: ${ERROR_OUTPUT}"
  fi
fi

# Grant access to specified member
print_info "Granting 'roles/run.invoker' to ${MEMBER}..."
if gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --region="${REGION}" \
  --member="${MEMBER}" \
  --role="roles/run.invoker"; then
  print_info "Successfully granted access to ${MEMBER}"
else
  print_error "Failed to grant access to ${MEMBER}"
  exit 1
fi

# Display final IAM policy
print_info "Current IAM policy:"
gcloud run services get-iam-policy "${SERVICE_NAME}" \
  --region="${REGION}" \
  --format=yaml

echo ""
print_info "✓ IAM lockdown complete!"
echo ""
print_info "Next steps:"
echo "  1. Test access by visiting ${SERVICE_URL}"
echo "  2. You should be prompted to authenticate"
echo "  3. Only users matching '${MEMBER}' can invoke the service"
echo ""
print_info "To verify the policy:"
echo "  gcloud run services get-iam-policy ${SERVICE_NAME} --region=${REGION}"
echo ""
print_info "To grant additional access:"
echo "  gcloud run services add-iam-policy-binding ${SERVICE_NAME} \\"
echo "    --region=${REGION} \\"
echo "    --member='user:another@example.com' \\"
echo "    --role='roles/run.invoker'"

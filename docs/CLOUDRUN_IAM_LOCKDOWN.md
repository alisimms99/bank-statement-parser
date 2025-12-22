# Cloud Run IAM Lockdown

This guide explains how to secure your Cloud Run service by removing public access and requiring Google Workspace authentication.

## Overview

By default, Cloud Run services can be deployed with `--allow-unauthenticated`, making them publicly accessible. For production, we lock this down to require authentication.

## Prerequisites

- Google Cloud CLI (`gcloud`) installed and authenticated
- Owner or IAM Admin role on the GCP project
- Google Workspace domain (e.g., `yourdomain.com`)

## Step 1: Remove Public Access

Remove the `allUsers` IAM binding from the Cloud Run service:

```bash
# Check current IAM policy
gcloud run services get-iam-policy bank-statement-parser \
  --region=us-central1 \
  --format=json

# Remove allUsers binding
gcloud run services remove-iam-policy-binding bank-statement-parser \
  --region=us-central1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

## Step 2: Grant Access to Workspace Identity

Grant the `roles/run.invoker` role to your Workspace domain:

```bash
# For entire domain
gcloud run services add-iam-policy-binding bank-statement-parser \
  --region=us-central1 \
  --member="domain:yourdomain.com" \
  --role="roles/run.invoker"

# OR for specific users
gcloud run services add-iam-policy-binding bank-statement-parser \
  --region=us-central1 \
  --member="user:admin@yourdomain.com" \
  --role="roles/run.invoker"

# OR for a Google Group
gcloud run services add-iam-policy-binding bank-statement-parser \
  --region=us-central1 \
  --member="group:finance-team@yourdomain.com" \
  --role="roles/run.invoker"
```

## Step 3: Verify Configuration

```bash
# Verify IAM policy
gcloud run services get-iam-policy bank-statement-parser \
  --region=us-central1

# Test unauthenticated access (should fail with 403)
curl -s -o /dev/null -w "%{http_code}" https://your-service-url.run.app/api/health
# Expected: 403

# Test authenticated access (should work)
curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  https://your-service-url.run.app/api/health
# Expected: 200
```

## Frontend OAuth2 Access

When IAM is locked down, the frontend must use OAuth2 to access the API:

1. User logs in via Google OAuth
2. Frontend obtains ID token
3. Frontend includes `Authorization: Bearer <token>` header
4. Cloud Run validates token automatically

### Example Frontend Code

```typescript
// After Google OAuth login
const idToken = googleUser.getAuthResponse().id_token;

// Include in API requests
fetch('https://your-service.run.app/api/ingest', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(data),
});
```

## Automation Script

Create a script for consistent deployment:

**File:** `scripts/lockdown-iam.sh`

```bash
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
```

## Troubleshooting

### "403 Forbidden" on all requests
- Verify user is in the allowed domain/group
- Check that the ID token is being sent correctly
- Ensure token hasn't expired (tokens are valid for ~1 hour)

### OAuth callback fails
- Add the OAuth callback URL to your Google Cloud Console OAuth config
- Ensure the callback route is exempted from Cloud Run access control (see middleware)

## Acceptance Criteria

- [ ] Visiting Cloud Run URL without auth returns 403
- [ ] `gcloud run services get-iam-policy` shows no `allUsers` binding
- [ ] Workspace users can access after OAuth login

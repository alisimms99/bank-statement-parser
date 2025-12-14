# Cloud Run IAM Verification Guide

This guide helps you verify that your Cloud Run service is properly locked down and only accessible to authorized users.

## Quick Verification Checklist

Use this checklist to confirm your Cloud Run service IAM is properly configured:

- [ ] No `allUsers` binding exists
- [ ] No `allAuthenticatedUsers` binding exists  
- [ ] `roles/run.invoker` is granted to your Workspace domain/users/groups only
- [ ] Unauthenticated requests return 403 Forbidden
- [ ] Authenticated workspace users can access after OAuth login

## Step 1: Check IAM Policy

Get the current IAM policy for your Cloud Run service:

```bash
# Replace with your service name and region
SERVICE_NAME="bank-statement-parser"
REGION="us-central1"

gcloud run services get-iam-policy ${SERVICE_NAME} \
  --region ${REGION} \
  --format yaml
```

### Expected Output (Secure Configuration)

```yaml
bindings:
- members:
  - domain:yourdomain.com
  role: roles/run.invoker
etag: BwYZQqR5tHM=
version: 1
```

### What to Look For

✅ **Good Signs:**
- Only your domain, specific users, or groups are listed as members
- The role is `roles/run.invoker`
- No `allUsers` or `allAuthenticatedUsers` entries

❌ **Red Flags:**
- `allUsers` member present (service is publicly accessible)
- `allAuthenticatedUsers` member present (any Google account can access)
- Missing your domain/users/groups (no one can access)

## Step 2: Test Unauthenticated Access

Try accessing your Cloud Run service without authentication:

```bash
# Get your service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
  --region ${REGION} \
  --format "value(status.url)")

echo "Testing unauthenticated access to: ${SERVICE_URL}"

# Test the health endpoint
curl -i "${SERVICE_URL}/api/health"
```

### Expected Result

```
HTTP/2 403
...
```

You should receive a **403 Forbidden** response. This confirms that unauthenticated requests are blocked at the Cloud Run level.

> **Note:** If you get a 200 OK response, your service is still publicly accessible. Review the IAM policy and ensure `allUsers` binding is removed.

## Step 3: Test Authenticated Access

### Via Browser

1. Open your Cloud Run service URL in a browser:
   ```
   https://your-service-name-hash.run.app
   ```

2. You should be redirected to your OAuth login page

3. After logging in with a Workspace account, you should be able to access the application

4. The OAuth flow should complete and you should see the application interface

### Via gcloud (for API testing)

For testing API endpoints with proper authentication:

```bash
# Get an identity token for your authenticated user
TOKEN=$(gcloud auth print-identity-token)

# Test the health endpoint with authentication
curl -H "Authorization: Bearer ${TOKEN}" \
  "${SERVICE_URL}/api/health"
```

### Expected Result

```json
{
  "ok": true,
  "ts": "2024-01-15T10:30:00.000Z"
}
```

You should receive a **200 OK** response with the health check data.

## Step 4: Verify Workspace Domain Restriction

Test that users outside your Workspace cannot access the service:

1. **Using a personal Gmail account** (not in your Workspace):
   - Try to access the service URL
   - You should see a 403 Forbidden error
   - OAuth login should either:
     - Prevent login with non-Workspace accounts, OR
     - Allow login but Cloud Run blocks the request

2. **Using a Workspace account** (in your domain):
   - Access the service URL
   - Login should succeed
   - Application should be fully accessible

## Common Issues and Troubleshooting

### Issue: Service Returns 403 for Workspace Users

**Possible Causes:**
- Domain name mismatch in IAM policy
- Incorrect member format (should be `domain:example.com`)
- User's account is not part of the Workspace

**Solution:**
```bash
# Verify the exact domain
gcloud organizations list

# Re-add the correct domain
gcloud run services add-iam-policy-binding ${SERVICE_NAME} \
  --region ${REGION} \
  --member="domain:yourdomain.com" \
  --role="roles/run.invoker"
```

### Issue: Service Still Publicly Accessible

**Possible Causes:**
- `allUsers` binding still exists
- Cached DNS/CDN entries

**Solution:**
```bash
# Force removal of all public bindings
gcloud run services remove-iam-policy-binding ${SERVICE_NAME} \
  --region ${REGION} \
  --member="allUsers" \
  --role="roles/run.invoker"

gcloud run services remove-iam-policy-binding ${SERVICE_NAME} \
  --region ${REGION} \
  --member="allAuthenticatedUsers" \
  --role="roles/run.invoker"

# Verify policy
gcloud run services get-iam-policy ${SERVICE_NAME} \
  --region ${REGION}
```

### Issue: OAuth Login Works but API Calls Fail

**Possible Causes:**
- Application-level authentication issues
- Missing or invalid session cookie
- CORS configuration problems

**Solution:**
1. Check browser console for errors
2. Verify `JWT_SECRET` is configured in Cloud Run
3. Ensure `OAUTH_SERVER_URL` is correct
4. Check CORS settings in environment variables

### Issue: Health Check Endpoint Failing

After IAM lockdown, external health checks may fail because they're unauthenticated. This is expected behavior.

**Options:**
1. Use authenticated health checks in your monitoring
2. Create a separate, public health endpoint (not recommended)
3. Monitor via Cloud Run's built-in metrics

## Automated Verification Script

Save this as `verify-iam.sh` for quick verification:

```bash
#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${1:-bank-statement-parser}"
REGION="${2:-us-central1}"

echo "Verifying IAM for ${SERVICE_NAME} in ${REGION}..."
echo ""

# Get service URL
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
  --region ${REGION} \
  --format "value(status.url)" 2>/dev/null || echo "")

if [ -z "${SERVICE_URL}" ]; then
  echo "❌ Service not found"
  exit 1
fi

echo "✓ Service found: ${SERVICE_URL}"
echo ""

# Check IAM policy
echo "IAM Policy:"
POLICY=$(gcloud run services get-iam-policy ${SERVICE_NAME} \
  --region ${REGION} \
  --format json)

if echo "${POLICY}" | grep -q '"allUsers"'; then
  echo "❌ WARNING: 'allUsers' binding found - service is public!"
elif echo "${POLICY}" | grep -q '"allAuthenticatedUsers"'; then
  echo "⚠️  WARNING: 'allAuthenticatedUsers' binding found"
else
  echo "✓ No public bindings found"
fi

if echo "${POLICY}" | grep -q "roles/run.invoker"; then
  echo "✓ Restricted access configured"
  echo ""
  echo "Authorized members:"
  # Try jq first, fall back to grep if jq is not available
  if command -v jq >/dev/null 2>&1; then
    echo "${POLICY}" | jq -r '.bindings[] | select(.role=="roles/run.invoker") | .members[]' 2>/dev/null || \
      echo "${POLICY}" | grep -A 5 "roles/run.invoker" | grep "domain\|user\|group" || true
  else
    echo "${POLICY}" | grep -A 5 "roles/run.invoker" | grep "domain\|user\|group" || true
  fi
else
  echo "❌ No invoker role found - service may be inaccessible"
fi

echo ""
echo "Testing unauthenticated access..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/api/health")

if [ "${STATUS}" = "403" ]; then
  echo "✓ Unauthenticated requests blocked (403)"
elif [ "${STATUS}" = "401" ]; then
  echo "✓ Unauthenticated requests blocked (401)"
else
  echo "❌ Unexpected response: ${STATUS} (expected 403 or 401)"
fi

echo ""
echo "Verification complete!"
```

Make it executable and run:

```bash
chmod +x verify-iam.sh
./verify-iam.sh bank-statement-parser us-central1
```

## Best Practices

1. **Regular Audits**: Periodically verify IAM policies haven't been changed:
   ```bash
   # Add to cron or CI/CD pipeline
   gcloud run services get-iam-policy ${SERVICE_NAME} --region ${REGION}
   ```

2. **Use Groups**: Instead of individual users, use Google Groups for easier management:
   ```bash
   gcloud run services add-iam-policy-binding ${SERVICE_NAME} \
     --region ${REGION} \
     --member="group:app-users@yourdomain.com" \
     --role="roles/run.invoker"
   ```

3. **Least Privilege**: Only grant access to those who need it

4. **Document Changes**: Keep a log of who has access and why

5. **Monitor Access**: Use Cloud Audit Logs to track who accesses your service:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision \
     AND resource.labels.service_name=${SERVICE_NAME}" \
     --limit 50 \
     --format json
   ```

## Additional Resources

- [Cloud Run IAM Roles](https://cloud.google.com/run/docs/securing/managing-access)
- [Google Workspace Domain-wide Delegation](https://developers.google.com/admin-sdk/directory/v1/guides/delegation)
- [Cloud Run Authentication](https://cloud.google.com/run/docs/authenticating/overview)
- [OAuth 2.0 for Cloud Run](https://cloud.google.com/run/docs/authenticating/end-users)

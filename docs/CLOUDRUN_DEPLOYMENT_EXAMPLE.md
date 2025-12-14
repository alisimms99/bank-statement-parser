# Cloud Run Deployment with E2E Tests

This document provides an example of how to integrate the E2E test suite into a Cloud Run deployment workflow.

## Example Deployment Workflow

Create a `.github/workflows/deploy-cloudrun.yml` file:

```yaml
name: Deploy to Cloud Run

on:
  push:
    branches:
      - main
  workflow_dispatch:

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  SERVICE_NAME: bank-statement-parser
  REGION: us-central1

jobs:
  build-and-deploy:
    name: Build and Deploy to Cloud Run
    runs-on: ubuntu-latest
    outputs:
      service_url: ${{ steps.deploy.outputs.url }}
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker for Artifact Registry
        run: |
          gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev

      - name: Build Docker image
        run: |
          docker build -t ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.SERVICE_NAME }}:${{ github.sha }} .
          docker build -t ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.SERVICE_NAME }}:latest .

      - name: Push Docker image to Artifact Registry
        run: |
          docker push ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.SERVICE_NAME }}:${{ github.sha }}
          docker push ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.SERVICE_NAME }}:latest

      - name: Deploy to Cloud Run
        id: deploy
        run: |
          gcloud run deploy ${{ env.SERVICE_NAME }} \
            --image ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.SERVICE_NAME }}:${{ github.sha }} \
            --region ${{ env.REGION }} \
            --platform managed \
            --allow-unauthenticated \
            --port 8080 \
            --memory 512Mi \
            --cpu 1 \
            --timeout 300 \
            --set-env-vars "NODE_ENV=production" \
            --format=json > deploy-output.json
          
          SERVICE_URL=$(jq -r '.status.url' deploy-output.json)
          echo "url=$SERVICE_URL" >> $GITHUB_OUTPUT
          echo "Deployed to: $SERVICE_URL"

      - name: Wait for service to be ready
        run: |
          for i in {1..30}; do
            if curl -s -o /dev/null -w "%{http_code}" ${{ steps.deploy.outputs.url }}/api/health | grep -q "200"; then
              echo "Service is ready!"
              exit 0
            fi
            echo "Waiting for service to be ready... ($i/30)"
            sleep 10
          done
          echo "Service did not become ready in time"
          exit 1

  # Run E2E tests after successful deployment
  e2e-tests:
    name: Post-Deployment E2E Tests
    needs: build-and-deploy
    uses: ./.github/workflows/cloudrun-e2e.yml
    with:
      cloudrun_url: ${{ needs.build-and-deploy.outputs.service_url }}

  # Optional: Rollback on test failure
  rollback-on-failure:
    name: Rollback on E2E Failure
    needs: [build-and-deploy, e2e-tests]
    if: failure()
    runs-on: ubuntu-latest
    steps:
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Rollback to previous revision
        run: |
          echo "E2E tests failed, rolling back to previous revision..."
          REVISIONS=$(gcloud run revisions list \
            --service ${{ env.SERVICE_NAME }} \
            --region ${{ env.REGION }} \
            --format="value(name)" \
            --limit=2)
          
          PREVIOUS_REVISION=$(echo "$REVISIONS" | tail -n 1)
          
          if [ -n "$PREVIOUS_REVISION" ]; then
            echo "Rolling back to revision: $PREVIOUS_REVISION"
            gcloud run services update-traffic ${{ env.SERVICE_NAME }} \
              --region ${{ env.REGION }} \
              --to-revisions $PREVIOUS_REVISION=100
          else
            echo "No previous revision found to rollback to"
          fi
```

## Required GitHub Secrets

For the deployment workflow to work, configure these secrets in your repository:

- `GCP_PROJECT_ID`: Your Google Cloud Project ID
- `GCP_SA_KEY`: Service account JSON key with permissions:
  - Cloud Run Admin
  - Storage Admin (for Artifact Registry)
  - Service Account User

## Workflow Behavior

### On Successful Deployment
1. **Build** → Docker image is built from Dockerfile
2. **Push** → Image is pushed to Artifact Registry
3. **Deploy** → Service is deployed to Cloud Run
4. **Health Check** → Wait for service to be ready
5. **E2E Tests** → Run comprehensive end-to-end tests
6. **Success** ✅ → Deployment is complete and verified

### On E2E Test Failure
1. **E2E Tests Fail** ❌
2. **Rollback Triggered** → Previous revision is restored
3. **Notification** → Workflow fails with clear error message

## Manual Testing

You can also manually test a deployed service:

```bash
# Trigger the E2E tests manually
gh workflow run cloudrun-e2e.yml \
  -f cloudrun_url=https://your-service-xyz.run.app
```

Or via the GitHub UI:
1. Go to **Actions** → **Cloud Run E2E Tests**
2. Click **Run workflow**
3. Enter your Cloud Run URL
4. Click **Run workflow**

## Local Testing Before Deployment

Before deploying to Cloud Run, you can test locally:

```bash
# Build and run the Docker container locally
docker build -t bank-statement-parser:local .
docker run -p 8080:8080 bank-statement-parser:local

# Test the health endpoint
curl http://localhost:8080/api/health

# Test file upload
curl -X POST http://localhost:8080/api/ingest \
  -F "file=@fixtures/sample-statement.pdf" \
  -F "documentType=bank_statement"
```

## Monitoring and Alerts

After deployment, monitor:
- **Cloud Run Metrics**: Request count, latency, error rate
- **GitHub Actions**: E2E test results and trends
- **Cloud Logging**: Application logs for errors

Set up alerts for:
- E2E test failures
- High error rates (>1%)
- Slow response times (>2s p99)
- Container crashes or restarts

## Best Practices

1. **Always run E2E tests** after deployment
2. **Monitor test results** for patterns or degradation
3. **Keep test data realistic** but minimal
4. **Update tests** when adding new endpoints
5. **Review test artifacts** when tests fail
6. **Set appropriate timeouts** for cold starts
7. **Test with CORS** if your frontend is on a different domain

## Troubleshooting Deployments

### Deployment Fails
- Check GCP quotas and billing
- Verify service account permissions
- Review build logs for errors

### E2E Tests Fail
- Check test artifacts in Actions
- Review Cloud Run logs
- Verify environment variables
- Check CORS configuration

### Service is Slow
- Increase CPU/memory allocation
- Check cold start latency
- Review Document AI configuration
- Consider minimum instances

#!/usr/bin/env bash
# Create required secrets in Google Cloud Secret Manager
# This is an interactive script that guides you through creating all required secrets

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

PROJECT_ID="${GCP_PROJECT_ID:-}"
if [ -z "$PROJECT_ID" ]; then
  echo "Error: GCP_PROJECT_ID environment variable must be set"
  echo "Usage: GCP_PROJECT_ID=your-project-id ./scripts/create-secrets.sh"
  exit 1
fi

echo "======================================"
echo "Secret Manager Setup"
echo "======================================"
echo "Project ID: $PROJECT_ID"
echo ""

# Set the active project
gcloud config set project "$PROJECT_ID"

# Enable Secret Manager API if not already enabled
echo "Ensuring Secret Manager API is enabled..."
gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"
echo "✓ Secret Manager API enabled"
echo ""

# ============================================================================
# Helper Functions
# ============================================================================

create_secret_from_input() {
  local secret_name="$1"
  local description="$2"
  local example="$3"
  
  echo "------------------------------------"
  echo "Creating secret: $secret_name"
  echo "Description: $description"
  if [ -n "$example" ]; then
    echo "Example: $example"
  fi
  echo ""
  
  # Check if secret already exists
  if gcloud secrets describe "$secret_name" --project="$PROJECT_ID" &>/dev/null; then
    echo "⚠ Secret '$secret_name' already exists"
    read -p "Do you want to create a new version? (y/N): " -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Skipping $secret_name"
      echo ""
      return
    fi
    
    # Create new version
    read -s -p "Enter value for $secret_name: " secret_value
    echo
    
    if [ -z "$secret_value" ]; then
      echo "⚠ Empty value provided, skipping"
      echo ""
      return
    fi
    
    echo -n "$secret_value" | gcloud secrets versions add "$secret_name" --data-file=-
    echo "✓ New version created for $secret_name"
  else
    # Create new secret
    read -s -p "Enter value for $secret_name: " secret_value
    echo
    
    if [ -z "$secret_value" ]; then
      echo "⚠ Empty value provided, skipping"
      echo ""
      return
    fi
    
    echo -n "$secret_value" | gcloud secrets create "$secret_name" \
      --data-file=- \
      --replication-policy=automatic \
      --project="$PROJECT_ID"
    
    echo "✓ Created $secret_name"
  fi
  
  echo ""
}

create_secret_from_file() {
  local secret_name="$1"
  local description="$2"
  
  echo "------------------------------------"
  echo "Creating secret from file: $secret_name"
  echo "Description: $description"
  echo ""
  
  # Check if secret already exists
  if gcloud secrets describe "$secret_name" --project="$PROJECT_ID" &>/dev/null; then
    echo "⚠ Secret '$secret_name' already exists"
    read -p "Do you want to create a new version? (y/N): " -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Skipping $secret_name"
      echo ""
      return
    fi
    
    read -p "Enter path to JSON file: " file_path
    
    if [ ! -f "$file_path" ]; then
      echo "⚠ File not found: $file_path"
      echo "Skipping $secret_name"
      echo ""
      return
    fi
    
    gcloud secrets versions add "$secret_name" --data-file="$file_path"
    echo "✓ New version created for $secret_name"
  else
    read -p "Enter path to JSON file: " file_path
    
    if [ ! -f "$file_path" ]; then
      echo "⚠ File not found: $file_path"
      echo "Skipping $secret_name"
      echo ""
      return
    fi
    
    gcloud secrets create "$secret_name" \
      --data-file="$file_path" \
      --replication-policy=automatic \
      --project="$PROJECT_ID"
    
    echo "✓ Created $secret_name"
  fi
  
  echo ""
}

generate_jwt_secret() {
  # Generate a secure random JWT secret (32 bytes = 64 hex characters)
  if command -v openssl &> /dev/null; then
    openssl rand -hex 32
  else
    # Fallback: generate 32 random bytes and convert to hex
    head -c 32 /dev/urandom | xxd -p -c 32
  fi
}

# ============================================================================
# Create Required Secrets
# ============================================================================

echo "This script will guide you through creating all required secrets."
echo "Press Ctrl+C at any time to cancel."
echo ""
read -p "Press Enter to continue..."
echo ""

# 1. JWT Secret
echo "======================================"
echo "1. JWT Secret"
echo "======================================"
echo "This is used to sign session cookies."
echo ""
echo "Would you like to:"
echo "  1) Generate a random secure value (recommended)"
echo "  2) Enter your own value"
read -p "Choose option (1/2): " jwt_option
echo ""

if [ "$jwt_option" = "1" ]; then
  JWT_SECRET=$(generate_jwt_secret)
  echo "Generated JWT secret"
  
  if gcloud secrets describe "jwt-secret" --project="$PROJECT_ID" &>/dev/null; then
    read -p "Secret 'jwt-secret' already exists. Create new version? (y/N): " -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      echo -n "$JWT_SECRET" | gcloud secrets versions add "jwt-secret" --data-file=-
      echo "✓ New version created for jwt-secret"
    fi
  else
    echo -n "$JWT_SECRET" | gcloud secrets create "jwt-secret" \
      --data-file=- \
      --replication-policy=automatic \
      --project="$PROJECT_ID"
    echo "✓ Created jwt-secret"
  fi
  echo ""
else
  create_secret_from_input "jwt-secret" \
    "Session cookie signing key" \
    "a-random-32-plus-character-string"
fi

# 2. Google Project ID
echo "======================================"
echo "2. Google Project ID"
echo "======================================"
create_secret_from_input "google-project-id" \
  "Your GCP project ID" \
  "$PROJECT_ID"

# 3. Document AI Location
echo "======================================"
echo "3. Document AI Location"
echo "======================================"
create_secret_from_input "docai-location" \
  "Document AI processor location" \
  "us (or eu, asia-northeast1, etc.)"

# 4. Document AI Processor ID
echo "======================================"
echo "4. Document AI Processor ID"
echo "======================================"
echo "You can find this in the Google Cloud Console:"
echo "https://console.cloud.google.com/ai/document-ai/processors"
echo ""
create_secret_from_input "docai-processor-id" \
  "Document AI processor ID" \
  "abc123def456"

# 5. GCP Service Account JSON
echo "======================================"
echo "5. GCP Service Account JSON"
echo "======================================"
echo "This should be the JSON key file for a service account with:"
echo "  - Document AI User role"
echo "  - (Optional) Storage Object Viewer if using GCS"
echo ""
echo "Download from: https://console.cloud.google.com/iam-admin/serviceaccounts"
echo ""
create_secret_from_file "gcp-service-account-json" \
  "Service account credentials for Document AI"

# 6. CORS Allow Origin (Optional)
echo "======================================"
echo "6. CORS Allow Origin (Optional)"
echo "======================================"
read -p "Do you want to configure CORS allowed origins? (y/N): " -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  create_secret_from_input "cors-allow-origin" \
    "Comma-separated list of allowed CORS origins" \
    "https://my-app.web.app,https://my-app.firebaseapp.com"
else
  echo "Skipping CORS configuration"
  echo ""
fi

# 7. Database URL (Optional)
echo "======================================"
echo "7. Database URL (Optional)"
echo "======================================"
read -p "Do you want to configure a database connection? (y/N): " -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  create_secret_from_input "database-url" \
    "Database connection string" \
    "mysql://user:pass@host:3306/db"
else
  echo "Skipping database configuration"
  echo ""
fi

# ============================================================================
# Grant Permissions
# ============================================================================

echo "======================================"
echo "Secret Creation Complete!"
echo "======================================"
echo ""
echo "Secrets created in project: $PROJECT_ID"
echo ""

# Get the project number for the service account
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
CLOUD_RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo ""
echo "======================================"
echo "Cloud Run Service Account"
echo "======================================"
echo "The default Compute Engine service account will be used by Cloud Run:"
echo "  $CLOUD_RUN_SA"
echo ""
echo "Grant access to Cloud Run service account?"
read -p "Continue? (Y/n): " -r
echo

if [[ ! $REPLY =~ ^[Nn]$ ]]; then
  echo "Granting secretAccessor role to secrets..."
  
  for secret in jwt-secret google-project-id docai-location docai-processor-id gcp-service-account-json; do
    if gcloud secrets describe "$secret" --project="$PROJECT_ID" &>/dev/null; then
      gcloud secrets add-iam-policy-binding "$secret" \
        --member="serviceAccount:$CLOUD_RUN_SA" \
        --role="roles/secretmanager.secretAccessor" \
        --project="$PROJECT_ID" \
        &>/dev/null
      echo "  ✓ Granted access to $secret"
    fi
  done
  
  # Grant for optional secrets if they exist
  if gcloud secrets describe "cors-allow-origin" --project="$PROJECT_ID" &>/dev/null; then
    gcloud secrets add-iam-policy-binding "cors-allow-origin" \
      --member="serviceAccount:$CLOUD_RUN_SA" \
      --role="roles/secretmanager.secretAccessor" \
      --project="$PROJECT_ID" \
      &>/dev/null
    echo "  ✓ Granted access to cors-allow-origin"
  fi
  
  if gcloud secrets describe "database-url" --project="$PROJECT_ID" &>/dev/null; then
    gcloud secrets add-iam-policy-binding "database-url" \
      --member="serviceAccount:$CLOUD_RUN_SA" \
      --role="roles/secretmanager.secretAccessor" \
      --project="$PROJECT_ID" \
      &>/dev/null
    echo "  ✓ Granted access to database-url"
  fi
  
  echo ""
  echo "✓ Permissions granted"
fi

echo ""
echo "======================================"
echo "Next Steps"
echo "======================================"
echo "1. Review your secrets:"
echo "   gcloud secrets list --project=$PROJECT_ID"
echo ""
echo "2. Deploy to Cloud Run:"
echo "   GCP_PROJECT_ID=$PROJECT_ID ./scripts/deploy-cloud-run.sh"
echo ""
echo "3. View secret values (if needed):"
echo "   gcloud secrets versions access latest --secret=jwt-secret --project=$PROJECT_ID"
echo ""

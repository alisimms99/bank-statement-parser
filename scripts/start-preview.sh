#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "PRODUCTION PREVIEW START"

# Build the Cloud-Run-ready artifact into ./prod
bash ./scripts/build-prod.sh

# Run the production server from the artifact folder
NODE_ENV=production node "prod/dist/index.js"


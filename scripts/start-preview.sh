#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "PRODUCTION PREVIEW START"

# Build the production artifact (UI + server) into ./dist
pnpm install --frozen-lockfile
pnpm build

# Copy built assets into a Cloud-Run-like artifact folder and install prod deps there
rm -rf "prod"
mkdir -p "prod"
cp -R "dist" "prod/"
cp "package.json" "prod/"
if [ -f "pnpm-lock.yaml" ]; then
  cp "pnpm-lock.yaml" "prod/"
fi

(cd "prod" && pnpm install --prod --frozen-lockfile)

NODE_ENV=production node "prod/dist/index.js"


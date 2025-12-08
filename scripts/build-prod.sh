#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[build-prod] Installing dependencies..."
pnpm install --frozen-lockfile

echo "[build-prod] Running typecheck..."
pnpm check

echo "[build-prod] Building client and server bundles..."
pnpm build

echo "[build-prod] Syncing client assets to server/public..."
if [ -d "dist/public" ]; then
  rm -rf server/public
  mkdir -p server/public
  cp -r dist/public/. server/public/
else
  echo "[build-prod] Warning: dist/public not found after build" >&2
fi

echo "[build-prod] Creating Cloud Run bundle..."
mkdir -p dist/artifacts
cd "$ROOT_DIR"
tar -czf dist/artifacts/cloud-run-bundle.tar.gz dist/index.js server/public package.json pnpm-lock.yaml

echo "[build-prod] Artifact ready at dist/artifacts/cloud-run-bundle.tar.gz"

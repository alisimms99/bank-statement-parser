#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "PRODUCTION BUILD START"

pnpm install --frozen-lockfile
pnpm check
pnpm build

# This repo's production server serves static assets from dist/public.
# If a separate client build output exists (e.g. client/dist), copy it into dist/public.
if [ -d "client/dist" ]; then
  mkdir -p "dist/public"
  cp -R "client/dist"/* "dist/public/" || true
fi

# Optional: create a Cloud-Run-ready artifact folder.
rm -rf "prod"
mkdir -p "prod"
cp -R "dist" "prod/"

# Helpful for container builds that use prod/ as build context.
cp "package.json" "prod/"
if [ -f "pnpm-lock.yaml" ]; then
  cp "pnpm-lock.yaml" "prod/"
fi

echo "PRODUCTION ARTIFACT READY"

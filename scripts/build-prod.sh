#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "PRODUCTION BUILD START"

# This repo builds client+server together into ./dist
# - client bundle -> dist/public
# - server bundle  -> dist/index.js
# Ensure devDependencies are installed so typecheck/build can run even when
# NODE_ENV=production (as in container builds).
pnpm install --frozen-lockfile --prod=false
pnpm check
pnpm build

# This repo's production server serves static assets from dist/public.
# If a separate client build output exists (e.g. client/dist), copy it into dist/public.
if [ -d "client/dist" ]; then
  mkdir -p "dist/public"
  cp -R "client/dist"/* "dist/public/" || true
fi

# Create a Cloud-Run-ready artifact folder with production-only deps.
rm -rf "prod"
mkdir -p "prod"
cp -R "dist" "prod/"

# Helpful for container builds that use prod/ as build context.
cp "package.json" "prod/"
if [ -f "pnpm-lock.yaml" ]; then
  cp "pnpm-lock.yaml" "prod/"
fi
if [ -d "patches" ]; then
  cp -R "patches" "prod/"
fi

echo "INSTALLING PRODUCTION DEPENDENCIES (prod/)"
(cd "prod" && pnpm install --prod --frozen-lockfile)

echo "PRODUCTION BUILD COMPLETE"

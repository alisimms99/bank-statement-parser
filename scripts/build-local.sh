#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[build-local] Running typecheck..."
pnpm check

echo "[build-local] Building client and server bundles..."
pnpm build

echo "[build-local] Starting development server..."
exec pnpm dev

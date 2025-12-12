#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "LOCAL BUILD START"

pnpm install
pnpm check
pnpm build
pnpm dev

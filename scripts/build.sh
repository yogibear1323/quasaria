#!/usr/bin/env bash
# Build + test everything: contracts (native tests + wasm), bot, frontend.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Contracts: cargo test"
(cd "$ROOT/contracts" && cargo test)

echo "==> Contracts: wasm build (stellar contract build -> wasm32v1-none)"
(cd "$ROOT/contracts" && stellar contract build)
ls -la "$ROOT"/contracts/target/wasm32v1-none/release/*.wasm

echo "==> Bot: typecheck + tests"
(cd "$ROOT/bot" && npm ci --no-audit --no-fund && npm run typecheck && npm test)

echo "==> Frontend: build"
(cd "$ROOT/frontend" && npm ci --no-audit --no-fund && npm run build)
echo "All builds OK"

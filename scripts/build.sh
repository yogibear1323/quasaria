#!/usr/bin/env bash
# Build + test everything: contracts (native tests + wasm), bot, frontend.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Toolchain pins (see docs/protocol-28.md): rustc comes from contracts/rust-toolchain.toml;
# the stellar CLI version is embedded in every wasm (contractmetav0 `cliver`), so a different
# CLI gives different wasm hashes. Warn, don't fail, so local experiments still build.
STELLAR_CLI_PIN="${STELLAR_CLI_PIN:-28.0.0}"
CLI_VER="$(stellar --version | head -1 | awk '{print $2}')"
if [ "$CLI_VER" != "$STELLAR_CLI_PIN" ]; then
  echo "WARNING: stellar CLI $CLI_VER != pinned $STELLAR_CLI_PIN: wasm hashes will not match the recorded ones" >&2
fi

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

#!/usr/bin/env bash
# TESTNET ONLY: create + seed XLM/stablecoin pools from docs/stablecoin-pairs.json.
# Regenerate the pair list first with: node scripts/gen-stablecoin-pairs.ts
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "${NETWORK:-testnet}" != "testnet" ]]; then echo "TESTNET ONLY" >&2; exit 1; fi
exec node "$ROOT/scripts/seed-stablecoin-pools.ts" "$@"

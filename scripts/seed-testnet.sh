#!/usr/bin/env bash
# Seed a fresh TESTNET deployment (run after deploy-testnet.sh):
#  * mint demo QUSD (via its SAC) and QFX to the admin
#  * add initial liquidity to both AMM pools
#  * fund staking pool rewards and the leverage-vault reserve
# Usage: ./scripts/seed-testnet.sh   (DRY_RUN=1 to print commands)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEP="$ROOT/deployments/testnet.json"
IDENTITY="${IDENTITY:-quasaria-admin}"
[[ -f "$DEP" ]] || { echo "Missing $DEP — run scripts/deploy-testnet.sh first" >&2; exit 1; }
j() { python3 -c "import json,sys;print(json.load(open('$DEP'))$1)"; }
[[ "$(j "['network']")" == "testnet" ]] || { echo "Refusing: deployment is not testnet" >&2; exit 1; }
ADMIN="$(j "['admin']")"
C() { j "['contracts']['$1']"; }
inv() {
  local id="$1"; shift
  if [[ "${DRY_RUN:-0}" == "1" ]]; then echo "+ stellar contract invoke --id $id -- $*"; return; fi
  stellar contract invoke --id "$id" --source "$IDENTITY" --network testnet -- "$@"
}
U=10000000 # 7 decimals

echo "==> Mint 1,000,000 QUSD and 5,000,000 QFX to admin"
inv "$(C qusdSac)" mint --to "$ADMIN" --amount $((1000000 * U))
inv "$(C qfx)" mint --to "$ADMIN" --amount $((5000000 * U))

echo "==> Liquidity: 5,000 XLM + 600 QUSD ; 200,000 QFX + 100,000 QUSD"
inv "$(C poolXlmQusd)" deposit --to "$ADMIN" --desired_a $((5000 * U)) --desired_b $((600 * U)) --min_a 0 --min_b 0
inv "$(C poolQfxQusd)" deposit --to "$ADMIN" --desired_a $((200000 * U)) --desired_b $((100000 * U)) --min_a 0 --min_b 0

echo "==> Fund staking rewards (QFX) and vault liquidity (QUSD)"
inv "$(C staking)" fund --from "$ADMIN" --pool_id 0 --amount $((500000 * U))
inv "$(C staking)" fund --from "$ADMIN" --pool_id 1 --amount $((500000 * U))
inv "$(C vault)" fund_liquidity --from "$ADMIN" --amount $((200000 * U))
echo "Seeded."

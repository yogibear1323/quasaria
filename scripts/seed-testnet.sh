#!/usr/bin/env bash
# Seed a fresh TESTNET deployment (run after deploy-testnet.sh):
#  * mint QFX to the admin (QUSD is issued by the admin, so the admin can pay it out directly)
#  * add initial liquidity to both AMM pools
#  * fund staking rewards and the leverage-vault reserve
#  * create a public demo trader (friendbot) that: trusts QUSD, links the admin
#    as referrer, swaps through the router, stakes QFX, and opens two
#    leveraged positions with SL/TP. The frontend shows this account's live
#    data in read-only mode.
# Secrets live only in the stellar CLI keystore (~/.config/stellar), never here.
# Usage: ./scripts/seed-testnet.sh   (DRY_RUN=1 to print commands)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEP="$ROOT/deployments/testnet.json"
IDENTITY="${IDENTITY:-quasaria-admin}"
TRADER="${TRADER:-quasaria-demo-trader}"
[[ -f "$DEP" ]] || { echo "Missing $DEP — run scripts/deploy-testnet.sh first" >&2; exit 1; }
j() { python3 -c "import json;print(json.load(open('$DEP'))$1)"; }
[[ "$(j "['network']")" == "testnet" ]] || { echo "Refusing: deployment is not testnet" >&2; exit 1; }
ADMIN="$(j "['admin']")"
QUSD_ASSET="$(j "['assets']['QUSD']")"
C() { j "['contracts']['$1']"; }
inv() { # inv <source-identity> <contract-id> <fn> args...
  local src="$1" id="$2"; shift 2
  if [[ "${DRY_RUN:-0}" == "1" ]]; then echo "+ [$src] invoke $id -- $*" >&2; echo 0; return; fi
  stellar contract invoke --id "$id" --source "$src" --network testnet -- "$@"
}
U=10000000 # 7 decimals
now_price() { inv "$IDENTITY" "$(C oracle)" set_price --asset '{"Other":"XLM"}' --price "${1:-12000000000000}" --timestamp 0 >/dev/null; }

echo "==> Mint 5,000,000 QFX to admin"
inv "$IDENTITY" "$(C qfx)" mint --to "$ADMIN" --amount $((5000000 * U)) >/dev/null

echo "==> Liquidity: 5,000 XLM + 600 QUSD ; 200,000 QFX + 100,000 QUSD"
inv "$IDENTITY" "$(C poolXlmQusd)" deposit --to "$ADMIN" --desired_a $((5000 * U)) --desired_b $((600 * U)) --min_a 0 --min_b 0
inv "$IDENTITY" "$(C poolQfxQusd)" deposit --to "$ADMIN" --desired_a $((200000 * U)) --desired_b $((100000 * U)) --min_a 0 --min_b 0

echo "==> Fund staking rewards (QFX) and vault liquidity (QUSD)"
inv "$IDENTITY" "$(C staking)" fund --from "$ADMIN" --pool_id 0 --amount $((500000 * U)) >/dev/null
inv "$IDENTITY" "$(C staking)" fund --from "$ADMIN" --pool_id 1 --amount $((500000 * U)) >/dev/null
inv "$IDENTITY" "$(C vault)" fund_liquidity --from "$ADMIN" --amount $((200000 * U)) >/dev/null

echo "==> Admin stakes 100 QLP (XLM/QUSD) in staking pool 1"
inv "$IDENTITY" "$(C staking)" stake --user "$ADMIN" --pool_id 1 --amount $((100 * U)) >/dev/null

echo "==> Demo trader '$TRADER'"
if [[ "${DRY_RUN:-0}" != "1" ]]; then
  stellar keys address "$TRADER" >/dev/null 2>&1 || stellar keys generate "$TRADER" --network testnet --fund >/dev/null
  T="$(stellar keys address "$TRADER")"
  stellar tx new change-trust --source "$TRADER" --line "$QUSD_ASSET" --network testnet >/dev/null
else T="GDRYRUNTRADER"; fi
echo "   trader: $T"
inv "$IDENTITY" "$(C qusdSac)" transfer --from "$ADMIN" --to "$T" --amount $((5000 * U)) >/dev/null
inv "$IDENTITY" "$(C qfx)" transfer --from "$ADMIN" --to "$T" --amount $((50000 * U)) >/dev/null

echo "==> Trader links admin as referrer, swaps 200 XLM -> QUSD via router (referrer earns 20% of fee)"
inv "$TRADER" "$(C referral)" set_referrer --user "$T" --referrer "$ADMIN" >/dev/null 2>&1 || echo "   (referrer already set)"
DEADLINE=$(( $(date +%s) + 600 ))
inv "$TRADER" "$(C router)" swap_exact_in --user "$T" --pools "[\"$(C poolXlmQusd)\"]" --token_in "$(C xlmSac)" \
  --amount_in $((200 * U)) --min_out 0 --deadline "$DEADLINE"

echo "==> Trader stakes 10,000 QFX in pool 0 (7-day lock)"
inv "$TRADER" "$(C staking)" stake --user "$T" --pool_id 0 --amount $((10000 * U)) >/dev/null

echo "==> Trader deposits 1,000 QUSD to the vault and opens two positions with SL/TP"
inv "$TRADER" "$(C vault)" deposit --user "$T" --amount $((1000 * U)) >/dev/null
now_price 12000000000000   # 0.12 USD, 14 decimals
P1=$(inv "$TRADER" "$(C vault)" open_position --caller "$T" --owner "$T" --asset '{"Other":"XLM"}' --is_long true --margin $((100 * U)) --leverage_bps 50000 | tr -d '"')
inv "$TRADER" "$(C vault)" set_triggers --caller "$T" --id "$P1" --stop_loss 11000000000000 --take_profit 14000000000000 >/dev/null
P2=$(inv "$TRADER" "$(C vault)" open_position --caller "$T" --owner "$T" --asset '{"Other":"XLM"}' --is_long false --margin $((50 * U)) --leverage_bps 30000 | tr -d '"')
inv "$TRADER" "$(C vault)" set_triggers --caller "$T" --id "$P2" --stop_loss 13500000000000 --take_profit 10500000000000 >/dev/null
echo "   positions: #$P1 (5x long), #$P2 (3x short)"
now_price 12340000000000   # move the mark a little so PnL is visible

python3 - "$DEP" "$T" <<'PY'
import json, sys
p, t = sys.argv[1], sys.argv[2]
d = json.load(open(p)); d["demoTrader"] = t
json.dump(d, open(p, "w"), indent=2); print("   recorded demoTrader in", p)
PY
mkdir -p "$ROOT/frontend/src/config" && cp "${OUT:-$DEP}" "$ROOT/frontend/src/config/testnet.json"
echo "Seeded."

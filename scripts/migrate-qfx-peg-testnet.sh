#!/usr/bin/env bash
# =============================================================================
# Quasaria — migrate an existing TESTNET deployment to the fully backed QFX
# (1 QFX = 1 XLM). Run after `stellar contract build` in contracts/.
#
#   ./scripts/migrate-qfx-peg-testnet.sh            # run
#   DRY_RUN=1 ./scripts/migrate-qfx-peg-testnet.sh  # print commands only
#
# What it does (TESTNET ONLY, never mainnet):
#  1. deploy the new QFX wrapper (native XLM SAC collateral, 12% holder APR
#     paid from a reserve) and a fresh staking contract + QFX/QUSD pool
#     (both reference the token address, so they must be redeployed);
#  2. retire the legacy contracts: legacy QFX APR -> 0, legacy staking pools
#     deactivated, legacy QFX/QUSD pool removed as a referral fee source;
#  3. fund reserves with testnet XLM: holder-yield reserve (fund_yield) and
#     staking reward reserves (deposit XLM -> QFX, then staking.fund);
#  4. re-seed the QFX/QUSD pool at the XLM/QUSD pool price (QFX = XLM);
#  5. demo trader deposits XLM -> QFX and stakes some;
#  6. rewrite deployments/testnet.json (+ frontend copy).
# Secrets live only in the stellar CLI keystore (~/.config/stellar).
# =============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM="$ROOT/contracts/target/wasm32v1-none/release"
DEP="$ROOT/deployments/testnet.json"
IDENTITY="${IDENTITY:-quasaria-admin}"
TRADER="${TRADER:-quasaria-demo-trader}"
NETWORK=testnet
U=10000000 # 7 decimals (XLM == QFX)
# Sizing (whole XLM). Override via env.
YIELD_RESERVE="${YIELD_RESERVE:-2500}"   # holder-yield reserve
STAKE_RESERVE_0="${STAKE_RESERVE_0:-1500}" # stake QFX -> earn QFX
STAKE_RESERVE_1="${STAKE_RESERVE_1:-1500}" # stake QLP XLM/QUSD -> earn QFX
POOL_QFX="${POOL_QFX:-2500}"             # QFX side of the QFX/QUSD pool
TRADER_DEPOSIT="${TRADER_DEPOSIT:-500}"
TRADER_STAKE="${TRADER_STAKE:-200}"

j() { python3 -c "import json;print(json.load(open('$DEP'))$1)"; }
[[ "$(j "['network']")" == "testnet" ]] || { echo "Refusing: deployment is not testnet" >&2; exit 1; }
[[ "$(j "['networkPassphrase']")" == "Test SDF Network ; September 2015" ]] || { echo "Refusing: not the testnet passphrase" >&2; exit 1; }
C() { j "['contracts']['$1']"; }
run() { if [[ "${DRY_RUN:-0}" == "1" ]]; then echo "+ $*" >&2; echo "C_DRY_RUN"; else "$@"; fi; }
inv() { local src="$1" id="$2"; shift 2; run stellar contract invoke --id "$id" --source "$src" --network "$NETWORK" -- "$@"; }
deploy() { local wasm="$1" alias="$2"; shift 2
  local existing; existing="$(stellar contract alias show "$alias" --network "$NETWORK" 2>/dev/null || true)"
  if [[ -n "$existing" && "${FRESH:-0}" != "1" ]]; then echo "   (reusing $alias = $existing)" >&2; echo "$existing"; return; fi
  run stellar contract deploy --wasm "$WASM/$wasm" --source "$IDENTITY" --network "$NETWORK" --alias "$alias" "$@"; }

ADMIN="$(stellar keys address "$IDENTITY")"
XLM_SAC="$(C xlmSac)"; QUSD_SAC="$(C qusdSac)"; REFERRAL="$(C referral)"; POOL_XLM_QUSD="$(C poolXlmQusd)"
OLD_QFX="$(C qfx)"; OLD_STAKING="$(C staking)"; OLD_POOL_QFX="$(C poolQfxQusd)"
[[ "$XLM_SAC" == "$(stellar contract id asset --asset native --network "$NETWORK")" ]] || { echo "xlmSac is not the native XLM SAC" >&2; exit 1; }

echo "==> 1. Deploy QFX v2 (1 QFX = 1 XLM, fully backed), staking v2, QFX/QUSD pool v2"
QFX="$(deploy quasaria_reward_token.wasm quasaria-qfx-v2 -- --admin "$ADMIN" --xlm "$XLM_SAC" \
  --name "Quasaria Flux" --symbol QFX --apr_bps 1200)"
STAKING="$(deploy quasaria_staking.wasm quasaria-staking-v2 -- --admin "$ADMIN")"
POOL_QFX_QUSD="$(deploy quasaria_amm_pool.wasm quasaria-pool-qfx-qusd-v2 -- --admin "$ADMIN" \
  --token_a "$QFX" --token_b "$QUSD_SAC" --fee_bps 30 --referral "\"$REFERRAL\"")"
echo "   qfx=$QFX staking=$STAKING poolQfxQusd=$POOL_QFX_QUSD"

echo "==> Wiring: yield-exempt contracts, referral fee source, staking pools"
# Contracts whose internal accounting cannot absorb holder yield.
inv "$IDENTITY" "$QFX" set_yield_exempt --id "$STAKING" --exempt true >/dev/null
inv "$IDENTITY" "$QFX" set_yield_exempt --id "$POOL_QFX_QUSD" --exempt true >/dev/null
inv "$IDENTITY" "$REFERRAL" set_fee_source --source "$POOL_QFX_QUSD" --allowed true >/dev/null
N="$(inv "$IDENTITY" "$STAKING" pool_count 2>/dev/null || echo 0)"
if [[ "$N" == "0" || "${DRY_RUN:-0}" == "1" ]]; then
  inv "$IDENTITY" "$STAKING" add_pool --stake_token "$QFX" --reward_token "$QFX" --reward_rate 1000 --lock_seconds 604800 >/dev/null
  inv "$IDENTITY" "$STAKING" add_pool --stake_token "$POOL_XLM_QUSD" --reward_token "$QFX" --reward_rate 2000 --lock_seconds 0 >/dev/null
else echo "   (staking v2 already has $N pools)"; fi

echo "==> 2. Retire legacy contracts (unbacked QFX $OLD_QFX)"
if [[ "$OLD_QFX" != "$QFX" ]]; then
  inv "$IDENTITY" "$OLD_QFX" set_apr_bps --apr_bps 0 >/dev/null || echo "   (legacy QFX APR unchanged)"
  inv "$IDENTITY" "$OLD_STAKING" set_active --pool_id 0 --active false >/dev/null || true
  inv "$IDENTITY" "$OLD_STAKING" set_active --pool_id 1 --active false >/dev/null || true
  inv "$IDENTITY" "$REFERRAL" set_fee_source --source "$OLD_POOL_QFX" --allowed false >/dev/null || true
fi

echo "==> 3. Reserves from testnet XLM"
echo "   holder-yield reserve: $YIELD_RESERVE XLM -> fund_yield"
inv "$IDENTITY" "$QFX" fund_yield --from "$ADMIN" --amount $((YIELD_RESERVE * U)) >/dev/null
echo "   staking reserves: deposit $((STAKE_RESERVE_0 + STAKE_RESERVE_1)) XLM -> QFX, fund pools 0/1"
inv "$IDENTITY" "$QFX" deposit --from "$ADMIN" --amount $(((STAKE_RESERVE_0 + STAKE_RESERVE_1) * U)) >/dev/null
inv "$IDENTITY" "$STAKING" fund --from "$ADMIN" --pool_id 0 --amount $((STAKE_RESERVE_0 * U)) >/dev/null
inv "$IDENTITY" "$STAKING" fund --from "$ADMIN" --pool_id 1 --amount $((STAKE_RESERVE_1 * U)) >/dev/null

echo "==> 4. Re-seed QFX/QUSD at the XLM/QUSD pool price"
POOL_INFO="$(inv "$IDENTITY" "$POOL_XLM_QUSD" info)"
QUSD_AMT="$(python3 -c "import json,sys;i=json.loads(sys.argv[1]);print(int(int(sys.argv[2])*int(i['reserve_b'])//int(i['reserve_a'])))" "$POOL_INFO" $((POOL_QFX * U)) 2>/dev/null || echo $((POOL_QFX * U / 8)))"
echo "   $POOL_QFX QFX + $(python3 -c "print($QUSD_AMT/1e7)") QUSD"
inv "$IDENTITY" "$QFX" deposit --from "$ADMIN" --amount $((POOL_QFX * U)) >/dev/null
inv "$IDENTITY" "$POOL_QFX_QUSD" deposit --to "$ADMIN" --desired_a $((POOL_QFX * U)) --desired_b "$QUSD_AMT" --min_a 0 --min_b 0 >/dev/null

echo "==> Admin stakes 100 QLP (XLM/QUSD) in staking v2 pool 1"
inv "$IDENTITY" "$STAKING" stake --user "$ADMIN" --pool_id 1 --amount $((100 * U)) >/dev/null || echo "   (admin has no QLP to stake)"

echo "==> 5. Demo trader: deposit $TRADER_DEPOSIT XLM -> QFX, stake $TRADER_STAKE QFX (7-day lock)"
T="$(stellar keys address "$TRADER")"
inv "$TRADER" "$QFX" deposit --from "$T" --amount $((TRADER_DEPOSIT * U)) >/dev/null
inv "$TRADER" "$STAKING" stake --user "$T" --pool_id 0 --amount $((TRADER_STAKE * U)) >/dev/null

echo "==> Proof of reserves"
inv "$IDENTITY" "$QFX" reserves

[[ "${DRY_RUN:-0}" == "1" ]] && exit 0
python3 - "$DEP" "$QFX" "$STAKING" "$POOL_QFX_QUSD" "$OLD_QFX" "$OLD_STAKING" "$OLD_POOL_QFX" <<'PY'
import json, sys
p, qfx, staking, pool, oq, os_, op = sys.argv[1:]
d = json.load(open(p))
c = d["contracts"]
if c["qfx"] != qfx:
    d.setdefault("legacy", {}).update({"qfxUnbacked": oq, "staking": os_, "poolQfxQusd": op,
        "note": "Pre-peg contracts (QFX with admin mint + minted holder interest). Retired: APR 0, staking pools inactive, pool removed as referral fee source."})
c.update({"qfx": qfx, "staking": staking, "poolQfxQusd": pool})
d["qfx"] = {"peg": "1 QFX = 1 XLM", "collateral": c["xlmSac"], "decimals": 7, "holderAprBps": 1200,
            "yieldExempt": [staking, pool]}
json.dump(d, open(p, "w"), indent=2); open(p, "a").write("\n")
print("   wrote", p)
PY
cp "$DEP" "$ROOT/frontend/src/config/testnet.json"
echo "Done."

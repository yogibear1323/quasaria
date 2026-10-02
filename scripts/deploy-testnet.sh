#!/usr/bin/env bash
# =============================================================================
# Quasaria — deploy all contracts to Stellar TESTNET with the stellar CLI.
#
#   ./scripts/deploy-testnet.sh            # deploy
#   DRY_RUN=1 ./scripts/deploy-testnet.sh  # print the commands only
#
# Requirements: stellar CLI >= 23 (tested with 28.0.0), wasm built via
# scripts/build.sh (or `stellar contract build` in contracts/).
#
# SAFETY: this script refuses to run against anything but testnet. It never
# touches mainnet. Keys are throwaway identities funded by friendbot.
# =============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM="$ROOT/contracts/target/wasm32v1-none/release"
NETWORK="${NETWORK:-testnet}"
IDENTITY="${IDENTITY:-quasaria-admin}"
OUT="$ROOT/deployments/testnet.json"
# Governance: every contract gets a two-step admin, a guardian (= admin until
# rotated) and a timelock for dangerous admin actions. On testnet a short
# delay keeps demos practical; the contracts refuse anything < 48h on mainnet.
TIMELOCK_DELAY="${TIMELOCK_DELAY:-300}"
# Alias suffix for this generation of contracts (v3 = hardened: F-01..F-08).
V="${ALIAS_SUFFIX:-v3}"
# QFX holder yield: only this much eligible supply earns the full APR
# (1,000,000 QFX, 7 decimals); above it holders share the capped emission.
QFX_MAX_ELIGIBLE="${QFX_MAX_ELIGIBLE:-10000000000000}"

if [[ "$NETWORK" != "testnet" ]]; then
  echo "Refusing to deploy: NETWORK=$NETWORK. This scaffold is TESTNET ONLY." >&2
  exit 1
fi

run() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "+ $*" >&2
    echo "C_DRY_RUN_PLACEHOLDER"
  else
    "$@"
  fi
}

echo "==> Ensuring testnet network config + funded identity '$IDENTITY'"
if [[ "${DRY_RUN:-0}" != "1" ]]; then
  stellar network add testnet \
    --rpc-url https://soroban-testnet.stellar.org \
    --network-passphrase "Test SDF Network ; September 2015" 2>/dev/null || true
  stellar keys address "$IDENTITY" >/dev/null 2>&1 || stellar keys generate "$IDENTITY" --network testnet --fund
  ADMIN="$(stellar keys address "$IDENTITY")"
else
  ADMIN="GDRYRUNADMINPLACEHOLDER"
fi
echo "Admin: $ADMIN"

deploy() { # deploy <wasm> <alias> [-- constructor args...]
  local wasm="$1" alias="$2"; shift 2
  # Idempotent re-runs: reuse an existing alias unless FRESH=1.
  if [[ "${FRESH:-0}" != "1" && "${DRY_RUN:-0}" != "1" ]]; then
    local existing
    existing="$(stellar contract alias show "$alias" --network "$NETWORK" 2>/dev/null || true)"
    if [[ -n "$existing" ]]; then echo "   (reusing $alias = $existing)" >&2; echo "$existing"; return; fi
  fi
  # F-12 wasm guard (refuses mocks / non-audited wasm on mainnet).
  node "$ROOT/scripts/lib/wasm-guard.ts" --network "$NETWORK" "$WASM/$wasm" >&2
  run stellar contract deploy --wasm "$WASM/$wasm" --source "$IDENTITY" \
    --network "$NETWORK" --alias "$alias" "$@"
}

echo "==> Stellar Asset Contracts (SAC) for classic assets"
# Native XLM SAC (already exists on testnet; `deploy` is idempotent-ish, so
# fall back to `id` if it is deployed already).
XLM_SAC="$(run stellar contract asset deploy --asset native --source "$IDENTITY" --network "$NETWORK" 2>/dev/null \
  || run stellar contract id asset --asset native --network "$NETWORK")"
# A demo stablecoin issued by the admin (classic asset QUSD + its SAC).
QUSD_ASSET="QUSD:$ADMIN"
QUSD_SAC="$(run stellar contract asset deploy --asset "$QUSD_ASSET" --source "$IDENTITY" --network "$NETWORK" 2>/dev/null \
  || run stellar contract id asset --asset "$QUSD_ASSET" --network "$NETWORK")"

echo "==> Referral registry (20% of fees to referrers; hard cap 50%)"
REFERRAL="$(deploy quasaria_referral.wasm "quasaria-referral-$V" -- --admin "$ADMIN" --share_bps 2000 \
  --timelock_delay "$TIMELOCK_DELAY")"

echo "==> Quasaria Flux (QFX): 1 QFX = 1 XLM, fully backed by native XLM (SAC); 12% holder APR paid from a pre-funded reserve"
QFX="$(deploy quasaria_reward_token.wasm "quasaria-qfx-$V" -- --admin "$ADMIN" --xlm "$XLM_SAC" \
  --name "Quasaria Flux" --symbol QFX --apr_bps 1200 --max_eligible "$QFX_MAX_ELIGIBLE" \
  --timelock_delay "$TIMELOCK_DELAY")"

echo "==> AMM pools (0.30% fee) + router"
POOL_XLM_QUSD="$(deploy quasaria_amm_pool.wasm "quasaria-pool-xlm-qusd-$V" -- --admin "$ADMIN" \
  --token_a "$XLM_SAC" --token_b "$QUSD_SAC" --fee_bps 30 --referral "\"$REFERRAL\"" \
  --timelock_delay "$TIMELOCK_DELAY")"
POOL_QFX_QUSD="$(deploy quasaria_amm_pool.wasm "quasaria-pool-qfx-qusd-$V" -- --admin "$ADMIN" \
  --token_a "$QFX" --token_b "$QUSD_SAC" --fee_bps 30 --referral "\"$REFERRAL\"" \
  --timelock_delay "$TIMELOCK_DELAY")"
# The router is stateless (no admin, no storage): nothing to govern or pause.
ROUTER="$(deploy quasaria_router.wasm "quasaria-router-$V")"

echo "==> Staking"
STAKING="$(deploy quasaria_staking.wasm "quasaria-staking-$V" -- --admin "$ADMIN" \
  --timelock_delay "$TIMELOCK_DELAY")"

echo "==> Mock oracle (swap for Reflector: see README) + leverage vault"
ORACLE="$(deploy quasaria_mock_oracle.wasm "quasaria-oracle-$V" -- --admin "$ADMIN" --decimals 14 \
  --timelock_delay "$TIMELOCK_DELAY")"
# Vault limits (F-02): min margin 10 QUSD, <= 10 open positions per wallet,
# <= 1,000 open positions overall; oracle prices max 15 min old, never from
# the future (F-07).
VAULT_CONFIG='{"max_leverage_bps":100000,"maintenance_margin_bps":500,"liquidation_bonus_bps":500,"open_fee_bps":10,"max_price_age":900,"min_margin":"100000000","max_positions_per_user":10,"max_open_positions":1000}'
VAULT="$(deploy quasaria_leverage_vault.wasm "quasaria-vault-$V" -- --admin "$ADMIN" \
  --collateral "$QUSD_SAC" --oracle "$ORACLE" --referral "\"$REFERRAL\"" \
  --config "$VAULT_CONFIG" --timelock_delay "$TIMELOCK_DELAY")"

# Leeway: time-dependent accrual can use slightly more instructions than simulated.
invoke() { run stellar contract invoke --id "$1" --source "$IDENTITY" --network "$NETWORK" --instruction-leeway 1000000 -- "${@:2}"; }

echo "==> Wiring: fee sources, markets, staking pools, oracle prices"
# Mainnet Step 1: fee sources, yield exemptions and staking pools are
# timelocked admin actions (propose_action -> wait TIMELOCK_DELAY ->
# execute_action). Queue everything, wait once, then execute.
TL_QUEUE=()
queue() { # queue <contract> <action-json>
  invoke "$1" propose_action --action "$2" >/dev/null
  TL_QUEUE+=("$1|$2")
}
POOLS_N="$(invoke "$STAKING" pool_count 2>/dev/null || echo 0)"
if [[ "$POOLS_N" == "0" || "${DRY_RUN:-0}" == "1" ]]; then
queue "$REFERRAL" "{\"SetFeeSource\":[\"$POOL_XLM_QUSD\",true]}"
queue "$REFERRAL" "{\"SetFeeSource\":[\"$POOL_QFX_QUSD\",true]}"
queue "$REFERRAL" "{\"SetFeeSource\":[\"$VAULT\",true]}"
# Contracts whose internal accounting cannot absorb QFX holder yield.
queue "$QFX" "{\"SetYieldExempt\":[\"$STAKING\",true]}"
queue "$QFX" "{\"SetYieldExempt\":[\"$POOL_QFX_QUSD\",true]}"
# Stake QFX -> earn QFX (7-day lock), stake XLM/QUSD LP -> earn QFX (no lock)
# min_stake = 1 token (7 decimals): no dust stakes (F-04)
queue "$STAKING" "{\"AddPool\":{\"stake_token\":\"$QFX\",\"reward_token\":\"$QFX\",\"reward_rate\":\"1000\",\"lock_seconds\":604800,\"min_stake\":\"10000000\"}}"
queue "$STAKING" "{\"AddPool\":{\"stake_token\":\"$POOL_XLM_QUSD\",\"reward_token\":\"$QFX\",\"reward_rate\":\"2000\",\"lock_seconds\":0,\"min_stake\":\"10000000\"}}"
else echo "   (staking already has $POOLS_N pools; wiring skipped)"; fi
# Instant on purpose: vault markets (vault is deferred) and mock prices (testnet only).
invoke "$VAULT" set_market --asset '{"Other":"XLM"}' --enabled true >/dev/null
invoke "$ORACLE" set_price --asset '{"Other":"XLM"}' --price 12000000000000 --timestamp 0 >/dev/null
if [[ ${#TL_QUEUE[@]} -gt 0 ]]; then
  echo "   queued ${#TL_QUEUE[@]} timelocked actions; waiting $((TIMELOCK_DELAY + 15)) s"
  [[ "${DRY_RUN:-0}" == "1" ]] || sleep $((TIMELOCK_DELAY + 15))
  for item in "${TL_QUEUE[@]}"; do
    invoke "${item%%|*}" execute_action --action "${item#*|}" >/dev/null
  done
fi

mkdir -p "$(dirname "$OUT")"
PREV_JSON=""
if [[ -f "$OUT" ]]; then PREV_JSON="$(cat "$OUT")"; fi
cat > "$OUT" <<JSON
{
  "network": "testnet",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "horizonUrl": "https://horizon-testnet.stellar.org",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "admin": "$ADMIN",
  "contracts": {
    "xlmSac": "$XLM_SAC",
    "qusdSac": "$QUSD_SAC",
    "referral": "$REFERRAL",
    "qfx": "$QFX",
    "poolXlmQusd": "$POOL_XLM_QUSD",
    "poolQfxQusd": "$POOL_QFX_QUSD",
    "router": "$ROUTER",
    "staking": "$STAKING",
    "oracle": "$ORACLE",
    "vault": "$VAULT"
  },
  "assets": { "QUSD": "$QUSD_ASSET" },
  "qfx": { "peg": "1 QFX = 1 XLM", "collateral": "$XLM_SAC", "decimals": 7, "holderAprBps": 1200,
           "maxEligible": "$QFX_MAX_ELIGIBLE", "accrual": "per-second, time-weighted",
           "yieldExempt": ["$STAKING", "$POOL_QFX_QUSD"] },
  "governance": { "generation": "$V", "timelockDelaySeconds": $TIMELOCK_DELAY, "guardian": "$ADMIN",
                  "mainnetMinTimelockSeconds": 172800,
                  "note": "Two-step admin (propose_admin/accept_admin), guardian pause, timelocked propose_action/execute_action for every non-risk-reducing admin change (fees, referral hook + fee sources, guardian, yield exemptions, staking pools/rates, lending listings, oracle, reserve withdrawal, APR/cap, upgrades). Mainnet floors: 48 h parameters, 72 h upgrade/oracle/treasury/delay. Testnet-only, unaudited." },
  "vault": { "config": $VAULT_CONFIG },
  "staking": { "minStake": "10000000" }
}
JSON
# Carry over the demo trader and legacy contracts from the previous file; the
# previous generation's contracts become legacy entries.
if [[ -n "$PREV_JSON" && "${DRY_RUN:-0}" != "1" ]]; then
  PREV_JSON="$PREV_JSON" python3 - "$OUT" <<'PY'
import json, os, sys
out = sys.argv[1]
new = json.load(open(out)); prev = json.loads(os.environ["PREV_JSON"])
if "demoTrader" in prev: new["demoTrader"] = prev["demoTrader"]
legacy = dict(prev.get("legacy", {}))
old = {k: v for k, v in prev.get("contracts", {}).items()
       if k not in ("xlmSac", "qusdSac") and v != new["contracts"].get(k)}
if old:
    gen = prev.get("governance", {}).get("generation", "v2")
    legacy[gen] = dict(old, note="Previous generation (pre-hardening wasm: no pause/timelock/two-step admin). Retired; kept for reference.")
if legacy: new["legacy"] = legacy
json.dump(new, open(out, "w"), indent=2); open(out, "a").write("\n")
PY
fi
mkdir -p "$ROOT/frontend/src/config" && cp "${OUT:-$DEP}" "$ROOT/frontend/src/config/testnet.json"
echo "Wrote $OUT"

# Frontend + bot env files
cat > "$ROOT/frontend/.env.local" <<ENV
VITE_NETWORK=testnet
VITE_QFX_ID=$QFX
VITE_ROUTER_ID=$ROUTER
VITE_POOL_IDS=$POOL_XLM_QUSD,$POOL_QFX_QUSD
VITE_STAKING_ID=$STAKING
VITE_REFERRAL_ID=$REFERRAL
VITE_VAULT_ID=$VAULT
VITE_ORACLE_ID=$ORACLE
VITE_QUSD_ASSET=$QUSD_ASSET
ENV
cat > "$ROOT/bot/.env" <<ENV
QUASARIA_NETWORK=testnet
QUASARIA_RPC_URL=https://soroban-testnet.stellar.org
QUASARIA_VAULT_ID=$VAULT
QUASARIA_ORACLE_ID=$ORACLE
# QUASARIA_SECRET=S...   # bot/keeper key (testnet only!). Never commit.
ENV
echo "Done. Next: ./scripts/seed-testnet.sh (reserves are funded with testnet XLM: QFX can only be minted by depositing XLM)."

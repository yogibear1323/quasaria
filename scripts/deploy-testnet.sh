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

echo "==> Referral registry (20% of fees to referrers)"
REFERRAL="$(deploy quasaria_referral.wasm quasaria-referral -- --admin "$ADMIN" --share_bps 2000)"

echo "==> Quasaria Flux (QFX) holder-reward token: 12% APR compounded daily, 1B max supply"
QFX="$(deploy quasaria_reward_token.wasm quasaria-qfx -- --admin "$ADMIN" --decimals 7 \
  --name "Quasaria Flux" --symbol QFX --apr_bps 1200 --max_supply 10000000000000000)"

echo "==> AMM pools (0.30% fee) + router"
POOL_XLM_QUSD="$(deploy quasaria_amm_pool.wasm quasaria-pool-xlm-qusd -- --admin "$ADMIN" \
  --token_a "$XLM_SAC" --token_b "$QUSD_SAC" --fee_bps 30 --referral "$REFERRAL")"
POOL_QFX_QUSD="$(deploy quasaria_amm_pool.wasm quasaria-pool-qfx-qusd -- --admin "$ADMIN" \
  --token_a "$QFX" --token_b "$QUSD_SAC" --fee_bps 30 --referral "$REFERRAL")"
ROUTER="$(deploy quasaria_router.wasm quasaria-router)"

echo "==> Staking"
STAKING="$(deploy quasaria_staking.wasm quasaria-staking -- --admin "$ADMIN")"

echo "==> Mock oracle (swap for Reflector: see README) + leverage vault"
ORACLE="$(deploy quasaria_mock_oracle.wasm quasaria-oracle -- --admin "$ADMIN" --decimals 14)"
VAULT="$(deploy quasaria_leverage_vault.wasm quasaria-vault -- --admin "$ADMIN" \
  --collateral "$QUSD_SAC" --oracle "$ORACLE" --referral "$REFERRAL" \
  --config '{"max_leverage_bps":100000,"maintenance_margin_bps":500,"liquidation_bonus_bps":500,"open_fee_bps":10,"max_price_age":900}')"

invoke() { run stellar contract invoke --id "$1" --source "$IDENTITY" --network "$NETWORK" -- "${@:2}"; }

echo "==> Wiring: fee sources, markets, staking pools, oracle prices"
invoke "$REFERRAL" set_fee_source --source "$POOL_XLM_QUSD" --allowed true >/dev/null
invoke "$REFERRAL" set_fee_source --source "$POOL_QFX_QUSD" --allowed true >/dev/null
invoke "$REFERRAL" set_fee_source --source "$VAULT" --allowed true >/dev/null
invoke "$VAULT" set_market --asset '{"Other":"XLM"}' --enabled true >/dev/null
invoke "$ORACLE" set_price --asset '{"Other":"XLM"}' --price 12000000000000 --timestamp 0 >/dev/null
# Stake QFX -> earn QFX (7-day lock), stake XLM/QUSD LP -> earn QFX (no lock)
invoke "$STAKING" add_pool --stake_token "$QFX" --reward_token "$QFX" --reward_rate 1000 --lock_seconds 604800 >/dev/null
invoke "$STAKING" add_pool --stake_token "$POOL_XLM_QUSD" --reward_token "$QFX" --reward_rate 2000 --lock_seconds 0 >/dev/null

mkdir -p "$(dirname "$OUT")"
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
  "assets": { "QUSD": "$QUSD_ASSET" }
}
JSON
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
echo "Done. Next: mint QUSD / QFX to test accounts and seed pools (see README 'Seeding')."

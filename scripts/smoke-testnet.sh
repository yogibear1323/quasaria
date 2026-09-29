#!/usr/bin/env bash
# =============================================================================
# Quasaria — on-chain smoke test of a TESTNET deployment (run after
# deploy-testnet.sh + seed-testnet.sh). Exercises the user paths and the new
# governance controls:
#   QFX mint/redeem · router swap · stake · vault open+close (+ dust rejected)
#   pause (deposit blocked, redeem still works) / unpause
#   two-step admin transfer (propose + accept, then hand back)
#   timelock: early execution rejected (#904), executes after the delay;
#   timelocked WASM upgrade of the oracle to its own hash.
# Uses only testnet identities from the stellar CLI keystore. TESTNET ONLY.
# Usage: ./scripts/smoke-testnet.sh
# =============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEP="$ROOT/deployments/testnet.json"
IDENTITY="${IDENTITY:-quasaria-admin}"
TRADER="${TRADER:-quasaria-demo-trader}"
NOMINEE="${NOMINEE:-quasaria-admin-nominee}"
j() { python3 -c "import json;print(json.load(open('$DEP'))$1)"; }
[[ "$(j "['network']")" == "testnet" ]] || { echo "Refusing: deployment is not testnet" >&2; exit 1; }
C() { j "['contracts']['$1']"; }
ADMIN="$(j "['admin']")"
T="$(stellar keys address "$TRADER")"
U=10000000
DELAY="$(j "['governance']['timelockDelaySeconds']")"
PASS=0; FAIL=0
ok()   { echo "  PASS  $*"; PASS=$((PASS + 1)); }
bad()  { echo "  FAIL  $*"; FAIL=$((FAIL + 1)); }
inv()  { local src="$1" id="$2"; shift 2; stellar contract invoke --id "$id" --source "$src" --network testnet -- "$@" 2>/tmp/smoke.err; }
view() { local id="$1"; shift; stellar contract invoke --id "$id" --source "$IDENTITY" --network testnet --send=no -- "$@" 2>/dev/null; }
expect_err() { # expect_err <code> <label> <src> <id> fn args...
  local code="$1" label="$2"; shift 2
  if out="$(inv "$@" 2>&1)"; then bad "$label (unexpectedly succeeded: $out)"; return; fi
  if grep -q "#$code" /tmp/smoke.err; then ok "$label (Error #$code)"; else bad "$label (wrong error: $(grep -o 'Error([^)]*)' /tmp/smoke.err | head -1))"; fi
}
bal() { view "$1" balance --id "$2" | tr -d '"'; }

echo "==> 1. QFX mint / redeem (1 QFX = 1 XLM)"
b0="$(bal "$(C qfx)" "$T")"
inv "$TRADER" "$(C qfx)" deposit --from "$T" --amount $((10 * U)) >/dev/null
b1="$(bal "$(C qfx)" "$T")"
(( b1 - b0 >= 10 * U )) && ok "deposit 10 XLM -> +$(( (b1 - b0) )) stroops QFX" || bad "deposit ($b0 -> $b1)"
inv "$TRADER" "$(C qfx)" redeem --from "$T" --amount $((5 * U)) >/dev/null && ok "redeem 5 QFX -> 5 XLM" || bad "redeem"
res="$(view "$(C qfx)" reserves)"; echo "     reserves: $res"
echo "$res" | grep -q '"fully_backed":true' && ok "reserve == supply (fully backed)" || bad "not fully backed"

echo "==> 2. Swap 10 XLM -> QUSD via router"
q0="$(bal "$(C qusdSac)" "$T")"
DEADLINE=$(( $(date +%s) + 600 ))
inv "$TRADER" "$(C router)" swap_exact_in --user "$T" --pools "[\"$(C poolXlmQusd)\"]" --token_in "$(C xlmSac)" \
  --amount_in $((10 * U)) --min_out 1 --deadline "$DEADLINE" >/dev/null
q1="$(bal "$(C qusdSac)" "$T")"
(( q1 > q0 )) && ok "swap paid $(( q1 - q0 )) stroops QUSD" || bad "swap ($q0 -> $q1)"

echo "==> 3. Stake"
expect_err 7 "1-stroop stake rejected (BelowMinStake)" "$TRADER" "$(C staking)" stake --user "$T" --pool_id 0 --amount 1
inv "$TRADER" "$(C staking)" stake --user "$T" --pool_id 0 --amount $((2 * U)) >/dev/null && ok "stake 2 QFX in pool 0" || bad "stake"

echo "==> 4. Vault: open + close a small position"
expect_err 15 "1 QUSD margin rejected (BelowMinMargin, min 10 QUSD)" "$TRADER" "$(C vault)" open_position --caller "$T" --owner "$T" --asset '{"Other":"XLM"}' --is_long true --margin $((1 * U)) --leverage_bps 20000
inv "$IDENTITY" "$(C oracle)" set_price --asset '{"Other":"XLM"}' --price 12340000000000 --timestamp 0 >/dev/null
PID="$(inv "$TRADER" "$(C vault)" open_position --caller "$T" --owner "$T" --asset '{"Other":"XLM"}' --is_long true --margin $((10 * U)) --leverage_bps 20000 | tr -d '"')"
[[ -n "$PID" ]] && ok "opened position #$PID (10 QUSD, 2x long)" || bad "open"
PAY="$(inv "$TRADER" "$(C vault)" close_position --caller "$T" --id "$PID" | tr -d '"')"
[[ -n "$PAY" ]] && ok "closed #$PID, payout $PAY stroops" || bad "close"
FUT=$(( $(date +%s) + 3600 ))
inv "$IDENTITY" "$(C oracle)" set_price --asset '{"Other":"XLM"}' --price 12340000000000 --timestamp "$FUT" >/dev/null
expect_err 14 "future-dated oracle price rejected (FuturePrice)" "$TRADER" "$(C vault)" open_position --caller "$T" --owner "$T" --asset '{"Other":"XLM"}' --is_long true --margin $((10 * U)) --leverage_bps 20000
inv "$IDENTITY" "$(C oracle)" set_price --asset '{"Other":"XLM"}' --price 12340000000000 --timestamp 0 >/dev/null

echo "==> 5. Pause / unpause (QFX)"
inv "$IDENTITY" "$(C qfx)" pause --caller "$ADMIN" >/dev/null && ok "guardian/admin paused QFX"
[[ "$(view "$(C qfx)" paused)" == "true" ]] && ok "paused() == true" || bad "paused flag"
expect_err 900 "deposit blocked while paused" "$TRADER" "$(C qfx)" deposit --from "$T" --amount $U
inv "$TRADER" "$(C qfx)" redeem --from "$T" --amount $U >/dev/null && ok "redeem still works while paused" || bad "redeem while paused"
inv "$IDENTITY" "$(C qfx)" unpause >/dev/null && ok "admin unpaused QFX"
inv "$TRADER" "$(C qfx)" deposit --from "$T" --amount $U >/dev/null && ok "deposit works again" || bad "deposit after unpause"

echo "==> 6. Two-step admin transfer (oracle): admin -> nominee -> admin"
stellar keys address "$NOMINEE" >/dev/null 2>&1 || stellar keys generate "$NOMINEE" --network testnet --fund >/dev/null
N="$(stellar keys address "$NOMINEE")"
inv "$IDENTITY" "$(C oracle)" propose_admin --new_admin "$N" >/dev/null && ok "admin proposed nominee $N"
[[ "$(view "$(C oracle)" admin | tr -d '"')" == "$ADMIN" ]] && ok "admin unchanged until accepted" || bad "admin changed early"
if inv "$TRADER" "$(C oracle)" accept_admin >/dev/null 2>&1; then bad "stranger accepted admin"; else ok "only the nominee can accept (auth)"; fi
inv "$NOMINEE" "$(C oracle)" accept_admin >/dev/null && ok "nominee accepted"
[[ "$(view "$(C oracle)" admin | tr -d '"')" == "$N" ]] && ok "admin() == nominee" || bad "accept"
inv "$NOMINEE" "$(C oracle)" propose_admin --new_admin "$ADMIN" >/dev/null
inv "$IDENTITY" "$(C oracle)" accept_admin >/dev/null && ok "admin handed back"

echo "==> 7. Timelock (delay ${DELAY}s)"
FEE_ACT='{"SetFeeBps":30}'
HASH="$(stellar contract upload --wasm "$ROOT/contracts/target/wasm32v1-none/release/quasaria_mock_oracle.wasm" --source "$IDENTITY" --network testnet 2>/dev/null)"
UPG_ACT="{\"Upgrade\":\"$HASH\"}"
inv "$IDENTITY" "$(C poolXlmQusd)" propose_action --action "$FEE_ACT" >/dev/null && ok "queued pool SetFeeBps(30)"
inv "$IDENTITY" "$(C oracle)" propose_action --action "$UPG_ACT" >/dev/null && ok "queued oracle Upgrade($HASH)"
expect_err 904 "early execution rejected (TimelockNotReady)" "$IDENTITY" "$(C poolXlmQusd)" execute_action --action "$FEE_ACT"
expect_err 904 "early upgrade rejected (TimelockNotReady)" "$IDENTITY" "$(C oracle)" execute_action --action "$UPG_ACT"
echo "     waiting $((DELAY + 15))s for the timelock..."
sleep $((DELAY + 15))
inv "$IDENTITY" "$(C poolXlmQusd)" execute_action --action "$FEE_ACT" >/dev/null && ok "SetFeeBps executed after the delay" || bad "execute fee: $(tail -2 /tmp/smoke.err)"
inv "$IDENTITY" "$(C oracle)" execute_action --action "$UPG_ACT" >/dev/null && ok "oracle upgraded via timelock" || bad "execute upgrade: $(tail -2 /tmp/smoke.err)"
[[ "$(view "$(C oracle)" decimals)" == "14" ]] && ok "oracle still serves after upgrade" || bad "oracle after upgrade"
expect_err 903 "replay rejected (NotQueued)" "$IDENTITY" "$(C poolXlmQusd)" execute_action --action "$FEE_ACT"

echo
echo "Smoke test: $PASS passed, $FAIL failed"
[[ "$FAIL" == "0" ]]

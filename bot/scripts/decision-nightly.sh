#!/usr/bin/env bash
# Decision desk nightly review (TESTNET research). Once a day after 00:10 UTC: score the shadow journal
# (Brier, reliability, gate failures) and refresh the Back Office snapshot locally. Report only: it never edits
# config, models or thresholds, and never deploys anything.
set -uo pipefail
BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="${QUASARIA_OFFICE_HOME:-$HOME/.quasaria-office}"
mkdir -p "$HOME_DIR/nightly"
while true; do
  now=$(date -u +%s); next=$(( (now / 86400 + 1) * 86400 + 600 ))
  sleep $(( next - now ))
  cd "$BOT_DIR" && npx tsx src/office/decision/cli.ts review >> "$HOME_DIR/nightly/decision-review.out" 2>&1
done

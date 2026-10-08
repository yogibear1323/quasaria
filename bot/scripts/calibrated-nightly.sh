#!/usr/bin/env bash
# Nightly review / self-improvement job for the calibrated desk (TESTNET research only).
#   scripts/calibrated-nightly.sh start|stop|status|run-now
# Runs research/quant/nightly.py once a day at ~03:15 box-local time. It writes a review + proposal under
# ~/.quasaria-office/nightly/<date>/ and replaces the model file ONLY if the proposal re-clears the strategy gate.
set -uo pipefail
BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$BOT_DIR/.." && pwd)"
HOME_DIR="${QUASARIA_OFFICE_HOME:-$HOME/.quasaria-office}"
PIDFILE="$HOME_DIR/nightly.pid"; LOG="$HOME_DIR/logs/nightly.log"
mkdir -p "$HOME_DIR/logs"
run_once() { cd "$REPO" && python3 research/quant/nightly.py --ship --model-dest "$BOT_DIR/office.calibrated.model.json" >> "$LOG" 2>&1; }
case "${1:-status}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "already running ($(cat "$PIDFILE"))"; exit 0; fi
    nohup setsid "$0" __loop > /dev/null 2>&1 & sleep 1; echo "started nightly job $(cat "$PIDFILE" 2>/dev/null) — log: $LOG";;
  __loop)
    echo $$ > "$PIDFILE"
    while true; do
      next=$(date -d "tomorrow 03:15" +%s); [ "$(date +%H%M)" -lt 0315 ] && next=$(date -d "today 03:15" +%s)
      sleep $(( next - $(date +%s) ))
      echo "$(date -Is) nightly run" >> "$LOG"; run_once
    done;;
  run-now) run_once; tail -n 5 "$LOG";;
  stop) [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null && rm -f "$PIDFILE" && echo stopped || echo "not running";;
  status) [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null && echo "running ($(cat "$PIDFILE"))" || echo "not running";;
esac

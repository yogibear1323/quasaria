#!/usr/bin/env bash
# Back Office fleet supervisor (TESTNET only).
#   scripts/back-office.sh start|stop|status|logs|restart
# Runs `office run --publish --admin-port 52610` with auto-restart, a heartbeat watchdog and crash-loop protection.
# State/keys/logs live in ~/.quasaria-office (never in the repo).
set -uo pipefail
BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="${QUASARIA_OFFICE_HOME:-$HOME/.quasaria-office}"
LOG_DIR="$HOME_DIR/logs"; mkdir -p "$LOG_DIR" "$HOME_DIR/state"; chmod 700 "$HOME_DIR"
PIDFILE="$HOME_DIR/supervisor.pid"; CHILDPID="$HOME_DIR/runner.pid"
ADMIN_PORT="${OFFICE_ADMIN_PORT:-52610}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
log() { echo "$(date -u +%FT%TZ) [supervisor] $*" >> "$LOG_DIR/fleet.log"; }

supervise() {
  local restarts=() child
  trap 'log "supervisor stopping"; [ -n "${child:-}" ] && kill "$child" 2>/dev/null; wait "$child" 2>/dev/null; rm -f "$PIDFILE" "$CHILDPID"; exit 0' TERM INT
  while true; do
    cd "$BOT_DIR"
    "$NODE_BIN" --import tsx src/office/cli.ts run --publish --admin-port "$ADMIN_PORT" >> "$LOG_DIR/fleet.log" 2>&1 &
    child=$!; echo "$child" > "$CHILDPID"; log "runner started pid $child"
    # heartbeat watchdog: kill a hung runner (no completed loop for 5 min)
    while kill -0 "$child" 2>/dev/null; do
      sleep 30
      hb="$HOME_DIR/state/heartbeat"
      if [ -f "$hb" ]; then
        age=$(( $(date +%s) - $(cat "$hb" 2>/dev/null || echo 0) ))
        if [ "$age" -gt 300 ]; then log "heartbeat stale ${age}s — killing runner $child"; kill "$child" 2>/dev/null; sleep 5; kill -9 "$child" 2>/dev/null; fi
      fi
    done
    wait "$child"; code=$?
    log "runner $child exited ($code)"
    now=$(date +%s); restarts+=("$now"); recent=0
    for t in "${restarts[@]}"; do [ $((now - t)) -lt 600 ] && recent=$((recent + 1)); done
    if [ "$recent" -ge 5 ]; then
      log "crash loop ($recent restarts in 10 min) — setting global KILL (runner will flatten on next start)"
      echo "crash loop: $recent restarts in 10 min" > "$HOME_DIR/state/KILL"
      sleep 120
    else
      sleep $(( recent * 10 + 5 ))
    fi
  done
}

case "${1:-status}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "already running (supervisor $(cat "$PIDFILE"))"; exit 0; fi
    nohup setsid "$0" __supervise > /dev/null 2>&1 &
    sleep 1; echo "started supervisor $(cat "$PIDFILE" 2>/dev/null) — logs: $LOG_DIR/fleet.log, admin: http://127.0.0.1:$ADMIN_PORT/";;
  __supervise) echo $$ > "$PIDFILE"; supervise;;
  stop)
    if [ -f "$PIDFILE" ]; then kill "$(cat "$PIDFILE")" 2>/dev/null && echo "stopped supervisor $(cat "$PIDFILE") (open positions keep their on-chain stops)"; else echo "not running"; fi;;
  restart) "$0" stop; sleep 3; "$0" start;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "supervisor $(cat "$PIDFILE") runner $(cat "$CHILDPID" 2>/dev/null)"; else echo "not running"; fi
    cd "$BOT_DIR" && "$NODE_BIN" --import tsx src/office/cli.ts status;;
  logs) tail -n 60 "$LOG_DIR/fleet.log";;
  *) echo "usage: $0 start|stop|restart|status|logs"; exit 1;;
esac

#!/usr/bin/env bash
# Oracle price feed supervisor + watchdog (TESTNET only).
#   scripts/oracle-feed.sh start|stop|restart|status|logs
# Runs `npm run oracle-feed -- $ORACLE_FEED_ARGS` (default: --identity quasaria-admin --interval 300) and restarts it when
#   * the process exits for any reason, or
#   * it stops pushing: the heartbeat file (epoch of the last successful on-chain XLM push, written by cli.ts) is older
#     than ORACLE_FEED_STALE_SEC (default 180 s) after a start-up grace of 120 s.
# A wall-clock jump (VM suspended/resumed) restarts the stale timer instead of killing a feed that is about to push.
# Crash-loop protection: >= 5 restarts in 10 min -> back off 5 min. Keys stay in the stellar CLI keystore / bot/.env;
# nothing secret is written here. Log: bot/state/oracle-feed.log (feed + supervisor lines).
set -uo pipefail
BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$BOT_DIR/state"; mkdir -p "$STATE"
LOG="$STATE/oracle-feed.log"; HB="$STATE/oracle-feed.heartbeat"
PIDFILE="$STATE/oracle-feed-supervisor.pid"; CHILDPID="$STATE/oracle-feed.pid"
ARGS="${ORACLE_FEED_ARGS:---identity quasaria-admin --interval 300}"
STALE="${ORACLE_FEED_STALE_SEC:-180}"; GRACE=120; CHECK=15
export PATH="$HOME/.local/node22/bin:$HOME/.local/bin:$PATH"
log() { echo "$(date -u +%FT%TZ) [feed-supervisor] $*" >> "$LOG"; }

stop_child() {
  local c="$1"
  kill -TERM -- "-$c" 2>/dev/null || kill -TERM "$c" 2>/dev/null
  for _ in $(seq 1 10); do kill -0 "$c" 2>/dev/null || return 0; sleep 1; done
  kill -KILL -- "-$c" 2>/dev/null || kill -KILL "$c" 2>/dev/null
}

supervise() {
  local restarts=() child=""
  trap 'log "supervisor stopping"; [ -n "$child" ] && stop_child "$child"; rm -f "$PIDFILE" "$CHILDPID"; exit 0' TERM INT
  while true; do
    cd "$BOT_DIR"
    started=$(date +%s)
    # own process group so the watchdog can stop npm -> sh -> tsx -> node together
    setsid npm run oracle-feed -- $ARGS >> "$LOG" 2>&1 < /dev/null &
    child=$!; echo "$child" > "$CHILDPID"; log "feed started pid $child (args: $ARGS)"
    last_loop=$started; stale_since=0
    while kill -0 "$child" 2>/dev/null; do
      sleep "$CHECK" & wait $!
      now=$(date +%s)
      if [ $((now - last_loop)) -gt $((CHECK * 4)) ]; then
        log "clock jumped $((now - last_loop))s (VM suspend/resume?) — restarting the stale timer"; stale_since=0
      fi
      last_loop=$now
      [ $((now - started)) -lt "$GRACE" ] && continue
      hb=$(cat "$HB" 2>/dev/null || echo 0); age=$((now - hb))
      if [ "$hb" -lt "$started" ] || [ "$age" -gt "$STALE" ]; then
        [ "$stale_since" -eq 0 ] && stale_since=$now
        if [ $((now - stale_since)) -ge 30 ] && { [ "$hb" -lt "$started" ] || [ "$age" -gt "$STALE" ]; }; then
          log "no XLM push for ${age}s (> ${STALE}s) — restarting feed pid $child"; stop_child "$child"; break
        fi
      else stale_since=0; fi
    done
    wait "$child" 2>/dev/null; code=$?
    log "feed $child exited ($code)"
    now=$(date +%s); restarts+=("$now"); recent=0
    for t in "${restarts[@]}"; do [ $((now - t)) -lt 600 ] && recent=$((recent + 1)); done
    if [ "$recent" -ge 5 ]; then log "crash loop ($recent restarts in 10 min) — backing off 300 s"; sleep 300; else sleep 5; fi
  done
}

case "${1:-status}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "already running (supervisor $(cat "$PIDFILE"))"; exit 0; fi
    nohup setsid "$0" __supervise > /dev/null 2>&1 < /dev/null &
    sleep 1; echo "started feed supervisor $(cat "$PIDFILE" 2>/dev/null) — log: $LOG";;
  __supervise) echo $$ > "$PIDFILE"; supervise;;
  stop)
    if [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null; then
      sp=$(cat "$PIDFILE"); for _ in $(seq 1 40); do kill -0 "$sp" 2>/dev/null || break; sleep 1; done
      echo "stopped feed supervisor $sp"
    else echo "not running"; rm -f "$PIDFILE"; fi;;
  restart) "$0" stop; "$0" start;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      hb=$(cat "$HB" 2>/dev/null || echo 0)
      echo "supervisor $(cat "$PIDFILE") feed $(cat "$CHILDPID" 2>/dev/null) · last XLM push $(( $(date +%s) - hb ))s ago"
    else echo "not running"; fi;;
  logs) tail -n 40 "$LOG";;
  *) echo "usage: $0 start|stop|restart|status|logs"; exit 1;;
esac

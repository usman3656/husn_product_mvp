#!/usr/bin/env bash
# Control script for the husn.io audit watcher daemon.
#
# Usage:
#   .claude/bin/audit-watcher.sh start    — start daemon (nohup)
#   .claude/bin/audit-watcher.sh stop     — stop daemon
#   .claude/bin/audit-watcher.sh status   — show running state + last few log lines
#   .claude/bin/audit-watcher.sh tail     — follow the watcher log
#
# Watcher pid: /tmp/husn-audit-watcher.pid
# Watcher log: /tmp/husn-audit-watcher.log  (separate from .claude/audit.log)
set -uo pipefail

PROJECT_ROOT="/Users/bawani/idea/go_big_product"
WATCHER_PY="${PROJECT_ROOT}/.claude/bin/audit-watcher.py"
PID_FILE="/tmp/husn-audit-watcher.pid"
LOG_FILE="/tmp/husn-audit-watcher.log"

cmd="${1:-status}"

is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null
}

case "$cmd" in
  start)
    if is_running; then
      echo "already running (pid $(cat "$PID_FILE"))"
      exit 0
    fi
    nohup python3 "$WATCHER_PY" > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 1
    if is_running; then
      echo "started (pid $(cat "$PID_FILE"))"
      echo "log: $LOG_FILE"
    else
      echo "failed to start — check $LOG_FILE"
      exit 1
    fi
    ;;
  stop)
    if ! is_running; then
      echo "not running"
      rm -f "$PID_FILE"
      exit 0
    fi
    pid="$(cat "$PID_FILE")"
    kill "$pid"
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid"
    fi
    rm -f "$PID_FILE"
    echo "stopped"
    ;;
  status)
    if is_running; then
      echo "running (pid $(cat "$PID_FILE"))"
      echo "log: $LOG_FILE"
      echo "--- last 10 log lines ---"
      tail -n 10 "$LOG_FILE" 2>/dev/null
    else
      echo "not running"
    fi
    ;;
  tail)
    tail -f "$LOG_FILE"
    ;;
  *)
    echo "usage: $0 {start|stop|status|tail}"
    exit 1
    ;;
esac

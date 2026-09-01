#!/usr/bin/env bash
# 镜场 CineForge — merge-watch 健康检查与自动重启（LaunchAgent 优先）
# 用法：./projects/cineforge/scripts/daemon-health.sh
# 可选：RESTART=1 自动重启 dead；PIDFILE=/tmp/cineforge-merge-watch.pid
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
PIDFILE="${PIDFILE:-/tmp/cineforge-merge-watch.pid}"
LOG="${LOG:-/tmp/cineforge-merge-watch.log}"
RESTART="${RESTART:-0}"

LABEL="com.autocompony.cineforge.merge-watch"
UID_NUM="$(id -u)"
SERVICE="gui/${UID_NUM}/${LABEL}"
LAUNCHAGENT="${CF}/scripts/merge-watch-launchagent.sh"

status="dead"
via=""
pid=""
la_loaded="no"

if [[ "$(uname -s)" == "Darwin" ]]; then
  if launchctl print "$SERVICE" >/dev/null 2>&1; then
    la_loaded="yes"
  elif launchctl list 2>/dev/null | grep -q "$LABEL"; then
    la_loaded="yes"
  fi
fi

if [[ -f "$PIDFILE" ]]; then
  pid=$(cat "$PIDFILE" 2>/dev/null || true)
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    status="alive"
    if [[ "$la_loaded" == "yes" ]]; then
      via="launchagent"
    else
      via="daemon"
    fi
  fi
fi

echo "== Merge Watch Daemon Health =="
echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
echo "status: $status${via:+ (via=$via)}"
echo "launchagent loaded: $la_loaded"
echo "pid: ${pid:-n/a}"
echo "pidfile: $PIDFILE"
echo "log: $LOG"

if [[ "$status" == "alive" ]]; then
  echo "OK: merge-watch 运行中 (pid=$pid${via:+ via=$via})"
  exit 0
fi

if [[ -f "$PIDFILE" ]]; then
  echo "WARN: stale pidfile — 清理"
  rm -f "$PIDFILE"
fi

if [[ "$RESTART" == "1" ]]; then
  echo
  if [[ "$(uname -s)" == "Darwin" && -x "$LAUNCHAGENT" ]]; then
    echo "-- 自动重启 via LaunchAgent"
    "$LAUNCHAGENT"
    exit $?
  fi
  echo "-- 自动重启 via nohup daemon（回退）"
  "${CF}/scripts/merge-watch-daemon.sh"
  exit $?
fi

echo "DEAD: merge-watch 未运行 — RESTART=1 $0 或 make cineforge-daemon-health"
exit 1

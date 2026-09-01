#!/usr/bin/env bash
# 镜场 CineForge — merge-watch daemon 健康检查与自动重启
# 用法：./projects/cineforge/scripts/daemon-health.sh
# 可选：RESTART=1 自动重启 dead daemon；PIDFILE=/tmp/cineforge-merge-watch.pid
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
PIDFILE="${PIDFILE:-/tmp/cineforge-merge-watch.pid}"
LOG="${LOG:-/tmp/cineforge-merge-watch.log}"
RESTART="${RESTART:-0}"

status="dead"
pid=""

if [[ -f "$PIDFILE" ]]; then
  pid=$(cat "$PIDFILE" 2>/dev/null || true)
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    status="alive"
  fi
fi

echo "== Merge Watch Daemon Health =="
echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
echo "status: $status"
echo "pid: ${pid:-n/a}"
echo "pidfile: $PIDFILE"
echo "log: $LOG"

if [[ "$status" == "alive" ]]; then
  echo "OK: daemon 运行中 (pid=$pid)"
  exit 0
fi

if [[ -f "$PIDFILE" ]]; then
  echo "WARN: stale pidfile — 清理"
  rm -f "$PIDFILE"
fi

if [[ "$RESTART" == "1" ]]; then
  echo
  echo "-- 自动重启 daemon"
  "${CF}/scripts/merge-watch-daemon.sh"
  exit $?
fi

echo "DEAD: daemon 未运行 — RESTART=1 $0 或 make cineforge-daemon-health"
exit 1

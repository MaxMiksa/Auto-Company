#!/usr/bin/env bash
# 镜场 CineForge — macOS/Linux 兼容的后台 merge-watch 守护
# 用法：./projects/cineforge/scripts/merge-watch-daemon.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19 POLL_SEC=120 LOG=/tmp/cineforge-merge-watch.log
#       STOP=1 停止已有守护
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
POLL_SEC="${POLL_SEC:-120}"
MAX_WAIT="${MAX_WAIT:-86400}"
LOG="${LOG:-/tmp/cineforge-merge-watch.log}"
PIDFILE="${PIDFILE:-/tmp/cineforge-merge-watch.pid}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

stop_daemon() {
  if [[ -f "$PIDFILE" ]]; then
    local pid
    pid=$(cat "$PIDFILE" 2>/dev/null || true)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "OK: 已停止 merge-watch (pid=$pid)"
    else
      echo "WARN: pidfile 存在但进程不在 — 清理 $PIDFILE"
    fi
    rm -f "$PIDFILE"
  else
    echo "无运行中的 merge-watch daemon"
  fi
  exit 0
}

[[ "${STOP:-0}" == "1" ]] && stop_daemon

WATCH="${CF}/scripts/merge-watch.sh"
[[ -x "$WATCH" ]] || die "缺少 merge-watch.sh: $WATCH"

if [[ -f "$PIDFILE" ]]; then
  old_pid=$(cat "$PIDFILE" 2>/dev/null || true)
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "merge-watch 已在运行 (pid=$old_pid)"
    echo "  log: $LOG"
    echo "  tail: tail -f $LOG"
    exit 0
  fi
  rm -f "$PIDFILE"
fi

echo "== 启动 Merge Watch Daemon =="
echo "UPSTREAM=$UPSTREAM PR=$PR POLL_SEC=$POLL_SEC MAX_WAIT=$MAX_WAIT"
echo "LOG=$LOG PIDFILE=$PIDFILE"
echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
echo

START_TS=$(date '+%Y-%m-%d %H:%M:%S %z')

# macOS 无 setsid — 双 fork + disown 避免 agent shell 退出时 SIGHUP 杀 daemon
(
  nohup env UPSTREAM="$UPSTREAM" PR="$PR" POLL_SEC="$POLL_SEC" MAX_WAIT="$MAX_WAIT" \
    PIDFILE="$PIDFILE" \
    bash -c "echo '=== merge-watch daemon start @ ${START_TS} ==='; exec \"${WATCH}\"" \
    >>"$LOG" 2>&1 </dev/null &
  daemon_pid=$!
  echo "$daemon_pid" >"$PIDFILE"
  disown -h "$daemon_pid" 2>/dev/null || true
) >/dev/null 2>&1 &

sleep 2
daemon_pid=""
if [[ -f "$PIDFILE" ]]; then
  daemon_pid=$(cat "$PIDFILE" 2>/dev/null || true)
fi

if [[ -n "$daemon_pid" ]] && kill -0 "$daemon_pid" 2>/dev/null; then
  echo "OK: merge-watch daemon 已启动 (pid=$daemon_pid)"
  echo "  PR: https://github.com/${UPSTREAM}/pull/${PR}"
  echo "  log: $LOG"
  echo "  停止: STOP=1 $0"
  exit 0
fi

rm -f "$PIDFILE"
die "daemon 启动失败 — 查看 $LOG"

#!/usr/bin/env bash
# 镜场 CineForge — macOS LaunchAgent for merge-watch（跨 session 存活）
# 用法：./projects/cineforge/scripts/merge-watch-launchagent.sh
# 可选：STOP=1 卸载；REMOVE=1 同时删 plist；STATUS=1 查状态
#       UPSTREAM=MaxMiksa/Auto-Company PR=19 POLL_SEC=120 MAX_WAIT=86400
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
POLL_SEC="${POLL_SEC:-120}"
MAX_WAIT="${MAX_WAIT:-86400}"
LOG="${LOG:-/tmp/cineforge-merge-watch.log}"
PIDFILE="${PIDFILE:-/tmp/cineforge-merge-watch.pid}"

LABEL="com.autocompony.cineforge.merge-watch"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
WATCH="${CF}/scripts/merge-watch.sh"
DAEMON="${CF}/scripts/merge-watch-daemon.sh"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"
SERVICE="${DOMAIN}/${LABEL}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || die "LaunchAgent 仅支持 macOS"
}

stop_legacy_daemon() {
  if [[ -x "$DAEMON" ]]; then
    STOP=1 "$DAEMON" 2>/dev/null || true
  elif [[ -f "$PIDFILE" ]]; then
    local pid
    pid=$(cat "$PIDFILE" 2>/dev/null || true)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "OK: 已停止旧 nohup daemon (pid=$pid)"
    fi
    rm -f "$PIDFILE"
  fi
}

is_loaded() {
  launchctl print "$SERVICE" >/dev/null 2>&1
}

bootout_if_loaded() {
  if is_loaded; then
    launchctl bootout "$SERVICE" 2>/dev/null || true
    # 短暂等待 unload 完成
    sleep 0.5
  fi
}

status_cmd() {
  need_macos
  echo "== Merge Watch LaunchAgent Status =="
  echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
  echo "label: $LABEL"
  echo "plist: $PLIST"
  echo "service: $SERVICE"

  local loaded="no"
  if is_loaded; then
    loaded="yes"
  fi
  echo "launchagent loaded: $loaded"

  local pid=""
  local alive="no"
  if [[ -f "$PIDFILE" ]]; then
    pid=$(cat "$PIDFILE" 2>/dev/null || true)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      alive="yes"
    fi
  fi
  echo "pidfile: $PIDFILE"
  echo "pid: ${pid:-n/a}"
  echo "process alive: $alive"
  echo "log: $LOG"

  if [[ "$loaded" == "yes" ]]; then
    echo
    echo "-- launchctl print (摘要) --"
    launchctl print "$SERVICE" 2>/dev/null | head -n 40 || true
  fi

  if [[ "$loaded" == "yes" && "$alive" == "yes" ]]; then
    echo
    echo "OK: LaunchAgent loaded + process alive (pid=$pid)"
    exit 0
  fi
  if [[ "$loaded" == "yes" ]]; then
    echo
    echo "WARN: LaunchAgent loaded 但进程未活（可能已完成或尚未 kickstart）"
    exit 0
  fi
  echo
  echo "DEAD: LaunchAgent 未加载"
  exit 1
}

stop_cmd() {
  need_macos
  echo "== 停止 Merge Watch LaunchAgent =="
  bootout_if_loaded
  stop_legacy_daemon
  if [[ "${REMOVE:-0}" == "1" ]]; then
    rm -f "${PLIST}"
    echo "OK: 已 bootout 并删除 plist: ${PLIST}"
  else
    echo "OK: 已 bootout (plist 保留: ${PLIST}; REMOVE=1 可删除)"
  fi
  exit 0
}

install_cmd() {
  need_macos
  [[ -x "$WATCH" ]] || die "缺少可执行 merge-watch.sh: $WATCH"
  mkdir -p "${HOME}/Library/LaunchAgents"

  echo "== 安装 Merge Watch LaunchAgent =="
  echo "UPSTREAM=$UPSTREAM PR=$PR POLL_SEC=$POLL_SEC MAX_WAIT=$MAX_WAIT"
  echo "ROOT=$ROOT"
  echo "plist=$PLIST"
  echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
  echo

  # 先停旧 nohup daemon，避免双跑
  stop_legacy_daemon

  # 幂等：先 bootout 再写 plist / bootstrap
  bootout_if_loaded

  cat >"$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>${WATCH}</string>
	</array>
	<key>WorkingDirectory</key>
	<string>${ROOT}</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>UPSTREAM</key>
		<string>${UPSTREAM}</string>
		<key>PR</key>
		<string>${PR}</string>
		<key>POLL_SEC</key>
		<string>${POLL_SEC}</string>
		<key>MAX_WAIT</key>
		<string>${MAX_WAIT}</string>
		<key>PIDFILE</key>
		<string>${PIDFILE}</string>
		<key>PATH</key>
		<string>${HOME}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
	</dict>
	<key>StandardOutPath</key>
	<string>${LOG}</string>
	<key>StandardErrorPath</key>
	<string>${LOG}</string>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<false/>
</dict>
</plist>
PLIST_EOF

  launchctl bootstrap "$DOMAIN" "$PLIST"
  launchctl enable "$SERVICE" 2>/dev/null || true
  launchctl kickstart -k "$SERVICE" 2>/dev/null || launchctl kickstart "$SERVICE" 2>/dev/null || true

  sleep 2

  local loaded="no"
  if is_loaded; then
    loaded="yes"
  fi

  local pid=""
  local alive="no"
  if [[ -f "$PIDFILE" ]]; then
    pid=$(cat "$PIDFILE" 2>/dev/null || true)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      alive="yes"
    fi
  fi

  echo "launchagent loaded: $loaded"
  echo "process alive: $alive"
  echo "pid: ${pid:-n/a}"
  echo "log: $LOG"
  echo "  PR: https://github.com/${UPSTREAM}/pull/${PR}"
  echo "  状态: STATUS=1 $0"
  echo "  停止: STOP=1 $0"
  echo "  卸载+删: STOP=1 REMOVE=1 $0"

  if [[ "$loaded" != "yes" ]]; then
    die "launchctl bootstrap 后未 loaded — 检查 $PLIST / $LOG"
  fi

  echo
  echo "OK: LaunchAgent 已安装并加载 ($LABEL)"
  exit 0
}

[[ "${STATUS:-0}" == "1" ]] && status_cmd
[[ "${STOP:-0}" == "1" ]] && stop_cmd
install_cmd

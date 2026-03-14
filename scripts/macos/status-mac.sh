#!/bin/bash
# ============================================================
# Auto Company — macOS Status Report for Dashboard
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
STATE_FILE="$PROJECT_DIR/.auto-loop-state"
PID_FILE="$PROJECT_DIR/.auto-loop.pid"
PAUSE_FLAG="$PROJECT_DIR/.auto-loop-paused"
CONSENSUS_FILE="$PROJECT_DIR/memories/consensus.md"
LABEL="com.autocompany.loop"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

loop_pid=""
if [ -f "$PID_FILE" ]; then
    loop_pid="$(cat "$PID_FILE")"
fi

echo "=== Guardian ==="
guardian_state="stopped"
guardian_pid=""
guardian_raw="Sleep guard: not active"
if [ -n "$loop_pid" ] && kill -0 "$loop_pid" 2>/dev/null; then
    guardian_pid="$(pgrep -f "caffeinate.*-w $loop_pid" | head -1 || true)"
    if [ -n "$guardian_pid" ]; then
        guardian_state="running"
        guardian_raw="caffeinate -w $loop_pid"
    else
        guardian_raw="Sleep guard: loop running without caffeinate"
    fi
fi
echo "State=$guardian_state"
if [ -n "$guardian_pid" ]; then
    echo "Pid=$guardian_pid"
fi
echo "Raw=$guardian_raw"

echo ""
echo "=== Daemon ==="
daemon_state="not_installed"
daemon_raw="LaunchAgent plist not installed"
daemon_pid=""
if [ -f "$PLIST_PATH" ]; then
    if [ -f "$PAUSE_FLAG" ]; then
        daemon_state="inactive"
        daemon_raw="LaunchAgent paused (.auto-loop-paused present)"
    elif launchctl list 2>/dev/null | grep -q "$LABEL"; then
        daemon_state="active"
        daemon_raw="launchd agent loaded"
        daemon_pid="$(launchctl list 2>/dev/null | awk -v label="$LABEL" '$3 == label { print $1; exit }' || true)"
    else
        daemon_state="inactive"
        daemon_raw="LaunchAgent plist installed but not loaded"
    fi
fi
echo "State=$daemon_state"
if [[ "$daemon_pid" =~ ^[0-9]+$ ]]; then
    echo "MainPID=$daemon_pid"
fi
echo "Raw=$daemon_raw"

echo ""
echo "=== Autostart ==="
if [ -f "$PLIST_PATH" ]; then
    echo "State=configured"
    echo "Raw=LaunchAgent plist present"
else
    echo "State=not_configured"
    echo "Raw=LaunchAgent plist absent"
fi

echo ""
echo "=== Loop ==="
loop_state="stopped"
loop_raw="Loop not running"
if [ -n "$loop_pid" ]; then
    if kill -0 "$loop_pid" 2>/dev/null; then
        loop_state="running"
        loop_raw="Loop running"
    else
        loop_raw="Loop stopped (stale PID $loop_pid)"
    fi
fi
echo "State=$loop_state"
if [ "$loop_state" = "running" ]; then
    echo "Pid=$loop_pid"
fi
echo "Raw=$loop_raw"

echo ""
echo "=== State File ==="
if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE"
fi

echo ""
echo "=== Latest Consensus ==="
if [ -f "$CONSENSUS_FILE" ]; then
    head -30 "$CONSENSUS_FILE"
else
    echo "(no consensus file)"
fi

echo ""
echo "=== Recent Log ==="
if [ -f "$LOG_DIR/auto-loop.log" ]; then
    tail -20 "$LOG_DIR/auto-loop.log"
else
    echo "(no log file)"
fi

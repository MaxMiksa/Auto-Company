#!/bin/bash
# ============================================================
# Auto Company — macOS Status Report for Dashboard
# ============================================================
# Outputs structured status for parsing by dashboard/server.py
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

# === Guardian Status (awake-caffeinate process) ===
echo "=== macOS Guardian ==="

guardian_pid=""
guardian_state="stopped"
if [ -f "$PID_FILE" ]; then
    loop_pid=$(cat "$PID_FILE")
    if kill -0 "$loop_pid" 2>/dev/null; then
        # Check if caffeinate is attached
        if pgrep -P "$loop_pid" caffeinate >/dev/null 2>&1; then
            guardian_state="running"
            guardian_pid=$(pgrep -P "$loop_pid" caffeinate | head -1)
        else
            guardian_state="running"
            guardian_pid="$loop_pid"
        fi
    fi
fi

if [ "$guardian_state" = "running" ]; then
    echo "Guardian: RUNNING (PID $guardian_pid)"
else
    echo "Guardian: STOPPED"
fi

# === launchd Daemon Status ===
echo ""
echo "=== macOS Daemon (launchd) ==="

if [ -f "$PAUSE_FLAG" ]; then
    echo "Daemon: PAUSED (.auto-loop-paused present)"
elif launchctl list 2>/dev/null | grep -q "$LABEL"; then
    echo "Daemon: ACTIVE ($LABEL)"
    daemon_info=$(launchctl list 2>/dev/null | grep "$LABEL" || true)
    if [ -n "$daemon_info" ]; then
        echo "$daemon_info"
    fi
else
    echo "Daemon: NOT LOADED"
    if [ -f "$HOME/Library/LaunchAgents/$LABEL.plist" ]; then
        echo "Daemon: PLIST exists but not loaded"
    else
        echo "Daemon: PLIST not installed"
    fi
fi

# === Loop Status ===
echo ""
echo "=== Loop Status ==="

if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
        echo "Loop: RUNNING (PID $pid)"
    else
        echo "Loop: STOPPED (stale PID $pid)"
    fi
else
    echo "Loop: NOT RUNNING"
fi

# === State File ===
if [ -f "$STATE_FILE" ]; then
    echo ""
    echo "=== State File ==="
    cat "$STATE_FILE"
fi

# === Consensus Preview ===
echo ""
echo "=== Latest Consensus ==="
if [ -f "$CONSENSUS_FILE" ]; then
    head -30 "$CONSENSUS_FILE"
else
    echo "(no consensus file)"
fi

# === Recent Log ===
echo ""
echo "=== Recent Log ==="
if [ -f "$LOG_DIR/auto-loop.log" ]; then
    tail -20 "$LOG_DIR/auto-loop.log"
else
    echo "(no log file)"
fi

echo ""
echo "=== End Status ==="

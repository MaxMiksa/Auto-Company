#!/bin/bash
# ============================================================
# Auto Company — Linux Status Report for Dashboard
# ============================================================
# Outputs Key=Value sections parsed by dashboard/server.py's parse_linux_status_output().

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
STATE_FILE="$PROJECT_DIR/.auto-loop-state"
PID_FILE="$PROJECT_DIR/.auto-loop.pid"
PAUSE_FLAG="$PROJECT_DIR/.auto-loop-paused"
CONSENSUS_FILE="$PROJECT_DIR/memories/consensus.md"
LOG_FILE="$LOG_DIR/auto-loop.log"

# --- Loop ---
echo "=== Loop ==="
loop_state="stopped"
loop_pid=""
loop_raw="Loop not running"
if [ -f "$PID_FILE" ]; then
    loop_pid="$(cat "$PID_FILE")"
fi
if [ -n "$loop_pid" ] && kill -0 "$loop_pid" 2>/dev/null; then
    loop_state="running"
    loop_raw="Loop running"
elif [ -n "$loop_pid" ]; then
    loop_raw="Loop stopped (stale PID $loop_pid)"
else
    loop_raw="No PID file found"
fi
echo "State=$loop_state"
if [ "$loop_state" = "running" ] && [ -n "$loop_pid" ]; then
    echo "Pid=$loop_pid"
fi
echo "Raw=$loop_raw"

# --- Daemon ---
echo ""
echo "=== Daemon ==="
daemon_state="not_installed"
daemon_raw="systemd --user service not installed"
daemon_main_pid=""
daemon_active="inactive"
daemon_substate="dead"
if command -v systemctl >/dev/null 2>&1; then
    daemon_active="$(systemctl --user is-active auto-company.service 2>/dev/null || true)"
    case "$daemon_active" in
        active)
            daemon_state="active"
            daemon_raw="systemd --user auto-company.service active"
            daemon_main_pid="$(systemctl --user show --property=MainPID auto-company.service 2>/dev/null | cut -d= -f2)"
            daemon_substate="$(systemctl --user show --property=SubState auto-company.service 2>/dev/null | cut -d= -f2)"
            ;;
        failed)
            daemon_state="failed"
            daemon_raw="systemd --user auto-company.service failed"
            ;;
        active/*|activating|deactivating)
            daemon_state="inactive"
            daemon_raw="systemd --user auto-company.service $daemon_active"
            ;;
        *)
            # Check if enabled
            daemon_enabled="$(systemctl --user is-enabled auto-company.service 2>/dev/null || true)"
            case "$daemon_enabled" in
                enabled)
                    daemon_state="stopped"
                    daemon_raw="systemd --user auto-company.service enabled but inactive"
                    ;;
                disabled|masked)
                    daemon_state="disabled"
                    daemon_raw="systemd --user auto-company.service $daemon_enabled"
                    ;;
                *)
                    daemon_state="not_installed"
                    daemon_raw="systemd --user auto-company.service not installed"
                    ;;
            esac
            ;;
    esac
else
    daemon_raw="systemctl not available"
fi
echo "State=$daemon_state"
echo "ActiveState=$daemon_active"
echo "SubState=$daemon_substate"
if [[ "$daemon_main_pid" =~ ^[0-9]+$ ]]; then
    echo "MainPID=$daemon_main_pid"
fi
echo "Raw=$daemon_raw"

# --- State File ---
echo ""
echo "=== State File ==="
if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE"
else
    echo "(no state file)"
fi

# --- Latest Consensus ---
echo ""
echo "=== Latest Consensus ==="
if [ -f "$CONSENSUS_FILE" ]; then
    head -30 "$CONSENSUS_FILE"
else
    echo "(no consensus file)"
fi

# --- Recent Log ---
echo ""
echo "=== Recent Log ==="
if [ -f "$LOG_FILE" ]; then
    tail -20 "$LOG_FILE"
else
    echo "(no log file)"
fi

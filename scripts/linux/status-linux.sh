#!/bin/bash
# ============================================================
# Auto Company — Linux Status Report for Dashboard
# ============================================================
# Emits the same "=== Section ===" / "Key=Value" format as
# scripts/macos/status-mac.sh, backed by systemd --user
# instead of launchd.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
STATE_FILE="$PROJECT_DIR/.auto-loop-state"
PID_FILE="$PROJECT_DIR/.auto-loop.pid"
PAUSE_FLAG="$PROJECT_DIR/.auto-loop-paused"
CONSENSUS_FILE="$PROJECT_DIR/memories/consensus.md"
SERVICE_NAME="auto-company.service"
UNIT_PATH="$HOME/.config/systemd/user/$SERVICE_NAME"

systemd_user_available() {
    command -v systemctl >/dev/null 2>&1 && systemctl --user --version >/dev/null 2>&1
}

# Walk up the parent chain from $1 looking for a systemd-inhibit ancestor.
# systemd-inhibit wraps the command it guards (unlike macOS caffeinate -w,
# which names the PID it waits on), so the lock shows up as an ancestor.
find_inhibit_ancestor() {
    local pid="$1"
    local depth=0
    local comm
    while [ -n "$pid" ] && [ "$pid" != "0" ] && [ "$pid" != "1" ] && [ "$depth" -lt 24 ]; do
        comm="$(cat "/proc/$pid/comm" 2>/dev/null || true)"
        if [ "$comm" = "systemd-inhibit" ]; then
            echo "$pid"
            return 0
        fi
        pid="$(awk '/^PPid:/ { print $2; exit }' "/proc/$pid/status" 2>/dev/null || true)"
        depth=$((depth + 1))
    done
    return 1
}

# Fallback for the "make awake" form, where systemd-inhibit watches the loop
# from the side (tail --pid) instead of wrapping it. Columns are
# WHO UID USER PID COMM WHAT WHY MODE.
find_inhibit_by_who() {
    command -v systemd-inhibit >/dev/null 2>&1 || return 1
    local found
    found="$(systemd-inhibit --list --no-legend --no-pager 2>/dev/null \
        | awk '$1 == "auto-company" && $6 ~ /sleep/ { print $4; exit }' || true)"
    if [ -n "$found" ]; then
        echo "$found"
        return 0
    fi
    return 1
}

loop_pid=""
if [ -f "$PID_FILE" ]; then
    loop_pid="$(cat "$PID_FILE")"
fi

echo "=== Guardian ==="
# Linux has no caffeinate. The closest equivalent is wrapping the loop in a
# systemd-inhibit sleep lock, e.g.:
#   systemd-inhibit --what=sleep --who=auto-company make start
# With no such lock the card reads "unsupported" (amber), not "bad".
guardian_state="unsupported"
guardian_pid=""
guardian_raw="Sleep guard: not active (loop not running)"
if [ -n "$loop_pid" ] && kill -0 "$loop_pid" 2>/dev/null; then
    guardian_pid="$(find_inhibit_ancestor "$loop_pid" || find_inhibit_by_who || true)"
    if [ -n "$guardian_pid" ]; then
        guardian_state="running"
        guardian_raw="systemd-inhibit (PID $guardian_pid) holding sleep lock for loop PID $loop_pid"
    else
        guardian_raw="Sleep guard: loop running without systemd-inhibit"
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
daemon_raw="systemd user unit not installed"
daemon_pid=""
daemon_active=""
daemon_sub=""
if ! systemd_user_available; then
    daemon_state="unsupported"
    daemon_raw="systemctl --user unavailable in this session"
elif [ -f "$UNIT_PATH" ] || systemctl --user cat "$SERVICE_NAME" >/dev/null 2>&1; then
    daemon_active="$(systemctl --user is-active "$SERVICE_NAME" 2>/dev/null || true)"
    daemon_sub="$(systemctl --user show "$SERVICE_NAME" -p SubState --value --no-pager 2>/dev/null || true)"
    daemon_pid="$(systemctl --user show "$SERVICE_NAME" -p MainPID --value --no-pager 2>/dev/null || true)"
    case "$daemon_active" in
        active)
            daemon_state="active"
            daemon_raw="systemd --user unit active"
            ;;
        activating|reloading)
            daemon_state="inactive"
            daemon_raw="systemd --user unit $daemon_active"
            ;;
        failed)
            daemon_state="inactive"
            daemon_raw="systemd --user unit failed (journalctl --user -u $SERVICE_NAME)"
            ;;
        *)
            daemon_state="inactive"
            daemon_raw="systemd --user unit installed but not running"
            ;;
    esac
    if [ -f "$PAUSE_FLAG" ] && [ "$daemon_state" != "active" ]; then
        daemon_raw="systemd --user unit paused (.auto-loop-paused present)"
    fi
fi
echo "State=$daemon_state"
if [[ "$daemon_pid" =~ ^[0-9]+$ ]] && [ "$daemon_pid" != "0" ]; then
    echo "MainPID=$daemon_pid"
fi
if [ -n "$daemon_active" ]; then
    echo "ActiveState=$daemon_active"
fi
if [ -n "$daemon_sub" ]; then
    echo "SubState=$daemon_sub"
fi
echo "Raw=$daemon_raw"

echo ""
echo "=== Autostart ==="
if ! systemd_user_available; then
    echo "State=unsupported"
    echo "Raw=systemctl --user unavailable in this session"
else
    enabled_state="$(systemctl --user is-enabled "$SERVICE_NAME" 2>/dev/null || true)"
    linger_state=""
    if command -v loginctl >/dev/null 2>&1; then
        linger_state="$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)"
    fi
    if [ "$enabled_state" = "enabled" ]; then
        echo "State=configured"
        if [ "$linger_state" = "no" ]; then
            echo "Raw=unit enabled; linger disabled (sudo loginctl enable-linger $(id -un))"
        else
            echo "Raw=unit enabled at login (linger=${linger_state:-unknown})"
        fi
    else
        echo "State=not_configured"
        echo "Raw=unit not enabled (${enabled_state:-absent})"
    fi
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
case "$daemon_state" in
    active) echo "DaemonSummary=ACTIVE (systemd --user $SERVICE_NAME)" ;;
    inactive) echo "DaemonSummary=INACTIVE (systemd --user $SERVICE_NAME)" ;;
    not_installed) echo "DaemonSummary=NOT INSTALLED (systemd --user $SERVICE_NAME)" ;;
    *) echo "DaemonSummary=UNSUPPORTED (systemd --user unavailable)" ;;
esac
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

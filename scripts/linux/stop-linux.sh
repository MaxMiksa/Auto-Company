#!/bin/bash
# ============================================================
# Auto Company — Linux Stop (systemd --user)
# ============================================================
# Dashboard "Stop" action for Linux hosts. Stops the systemd
# user unit when installed, and signals any foreground loop
# to finish its current cycle and exit.
#
# Usage:
#   ./stop-linux.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_NAME="auto-company.service"
UNIT_PATH="$HOME/.config/systemd/user/$SERVICE_NAME"

stopped_something=0

if command -v systemctl >/dev/null 2>&1 \
    && systemctl --user --version >/dev/null 2>&1 \
    && { [ -f "$UNIT_PATH" ] || systemctl --user cat "$SERVICE_NAME" >/dev/null 2>&1; }; then
    # Mark as paused so the status report distinguishes "stopped by the
    # operator" from "installed but never started".
    touch "$PROJECT_DIR/.auto-loop-paused"
    systemctl --user stop "$SERVICE_NAME"
    echo "Stopped: $SERVICE_NAME (Restart=always does not re-trigger on an explicit stop)"
    stopped_something=1
else
    echo "systemd user unit not installed; skipping service stop."
fi

# Also signal a foreground loop (make start) if one is running.
"$PROJECT_DIR/scripts/core/stop-loop.sh"

if [ "$stopped_something" -eq 1 ]; then
    echo "Resume with: systemctl --user start $SERVICE_NAME  (or make resume)"
fi

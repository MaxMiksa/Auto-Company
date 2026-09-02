#!/bin/bash
# ============================================================
# Auto Company — Linux Start (systemd --user)
# ============================================================
# Dashboard "Start" action for Linux hosts. Installs the
# systemd user unit on first run, then starts it.
#
# Usage:
#   ./start-linux.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_NAME="auto-company.service"
UNIT_PATH="$HOME/.config/systemd/user/$SERVICE_NAME"

if ! command -v systemctl >/dev/null 2>&1; then
    echo "Error: systemctl not found. Install systemd or run 'make start' in the foreground."
    exit 1
fi

if ! systemctl --user --version >/dev/null 2>&1; then
    echo "Error: systemctl --user is unavailable for this session."
    echo "Check that a user D-Bus session exists (loginctl show-user \$(id -un))."
    exit 1
fi

# Clear any stale stop signal so the unit does not exit on its first cycle.
rm -f "$PROJECT_DIR/.auto-loop-stop"
rm -f "$PROJECT_DIR/.auto-loop-paused"

if [ ! -f "$UNIT_PATH" ]; then
    echo "Unit not installed. Installing $SERVICE_NAME..."
    # install-wsl-daemon.sh is the generic systemd --user installer;
    # it is WSL-named for historical reasons but has no WSL dependency.
    "$PROJECT_DIR/scripts/wsl/install-wsl-daemon.sh"
fi

systemctl --user start "$SERVICE_NAME"
echo "Started: $SERVICE_NAME"
systemctl --user show "$SERVICE_NAME" -p ActiveState -p SubState -p MainPID --no-pager

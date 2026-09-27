#!/bin/bash
# ============================================================
# Auto Company — Install WSL/Linux systemd user daemon
# ============================================================
# Installs a per-user systemd service:
#   ~/.config/systemd/user/auto-company.service
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$PROJECT_DIR/scripts/core/ui-messages.sh"
if [ -e "$PROJECT_DIR/.auto-company-center.json" ] || [ -L "$PROJECT_DIR/.auto-company-center.json" ]; then
    ui_message center.managed >&2
    exit 1
fi
SERVICE_NAME="auto-company.service"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SERVICE_PATH="$SYSTEMD_USER_DIR/$SERVICE_NAME"
CURRENT_USER="$(id -un)"

if ! command -v systemctl >/dev/null 2>&1; then
    ui_message systemd.missing
    exit 1
fi

if ! systemctl --user --version >/dev/null 2>&1; then
    ui_message systemd.unavailable
    exit 1
fi

mkdir -p "$SYSTEMD_USER_DIR"

# ExecStart parses command arguments, so quote and escape its checkout path.
UNIT_EXEC_DIR="${PROJECT_DIR//\\/\\\\}"
UNIT_EXEC_DIR="${UNIT_EXEC_DIR//\"/\\\"}"
UNIT_EXEC_DIR="${UNIT_EXEC_DIR//%/%%}"

# WorkingDirectory and EnvironmentFile keep quotes as literal path characters.
# These whole-line paths need only literal percent signs escaped as specifiers.
UNIT_PROJECT_DIR="${PROJECT_DIR//%/%%}"

cat > "$SERVICE_PATH" << EOF
[Unit]
Description=Auto Company Loop
After=default.target

[Service]
Type=simple
WorkingDirectory=$UNIT_PROJECT_DIR
EnvironmentFile=-$UNIT_PROJECT_DIR/.auto-loop.env
ExecStart=/usr/bin/bash "$UNIT_EXEC_DIR/scripts/core/auto-loop.sh"
Restart=always
RestartPreventExitStatus=78
RestartSec=10
TimeoutStopSec=45

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME" >/dev/null

ui_message systemd.installed "$SERVICE_PATH" "$SERVICE_NAME"

if command -v loginctl >/dev/null 2>&1; then
    linger_state="$(loginctl show-user "$CURRENT_USER" -p Linger --value 2>/dev/null || true)"
    if [ "$linger_state" = "no" ]; then
        echo ""
        ui_message systemd.linger "$CURRENT_USER"
    fi
fi

echo ""
ui_message systemd.next "$SERVICE_NAME"

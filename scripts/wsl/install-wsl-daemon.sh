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
SERVICE_NAME="auto-company.service"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SERVICE_PATH="$SYSTEMD_USER_DIR/$SERVICE_NAME"
CURRENT_USER="$(id -un)"
PREPARE_ONLY=0
[ "${1:-}" != "--prepare" ] || PREPARE_ONLY=1
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--prepare" ]; }; then
    ui_message install.invalid_argument >&2
    exit 2
fi

# Render the same bytes for new units and idempotent ownership verification.
UNIT_EXEC_DIR="${PROJECT_DIR//\\/\\\\}"
UNIT_EXEC_DIR="${UNIT_EXEC_DIR//\"/\\\"}"
UNIT_EXEC_DIR="${UNIT_EXEC_DIR//%/%%}"
UNIT_PROJECT_DIR="${PROJECT_DIR//%/%%}"
render_unit() {
cat << EOF
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
}

if [ -e "$PROJECT_DIR/.auto-company/maintenance.json" ] || [ -L "$PROJECT_DIR/.auto-company/maintenance.json" ]; then
    python3 "$SCRIPT_DIR/../core/installation_state.py" check --root "$PROJECT_DIR"
fi

if ! command -v systemctl >/dev/null 2>&1; then
    ui_message systemd.missing
    exit 1
fi

if ! systemctl --user --version >/dev/null 2>&1; then
    ui_message systemd.unavailable
    exit 1
fi

if [ "$PREPARE_ONLY" -eq 1 ]; then
    if ! systemctl --user show-environment >/dev/null 2>&1; then
        ui_message systemd.unavailable >&2
        exit 1
    fi
    if [ -e "$SERVICE_PATH" ] || [ -L "$SERVICE_PATH" ] || systemctl --user cat "$SERVICE_NAME" >/dev/null 2>&1; then
        if [ -L "$SERVICE_PATH" ] || [ ! -f "$SERVICE_PATH" ] || ! cmp -s "$SERVICE_PATH" <(render_unit); then
            ui_message install.service_conflict >&2
            exit 1
        fi
        fragment="$(systemctl --user show "$SERVICE_NAME" -p FragmentPath --value --no-pager)"
        dropins="$(systemctl --user show "$SERVICE_NAME" -p DropInPaths --value --no-pager)"
        if [ "$fragment" != "$SERVICE_PATH" ] || [ -n "$dropins" ]; then
            ui_message install.service_conflict >&2
            exit 1
        fi
        installed_dir="$(systemctl --user show "$SERVICE_NAME" -p WorkingDirectory --value --no-pager)"
        resolved_dir="$(cd "$installed_dir" 2>/dev/null && pwd -P)" || { ui_message install.service_conflict >&2; exit 1; }
        if [ "$resolved_dir" != "$(cd "$PROJECT_DIR" && pwd -P)" ]; then
            ui_message install.service_conflict >&2
            exit 1
        fi
        active_state="$(systemctl --user is-active "$SERVICE_NAME" 2>/dev/null || true)"
        enabled_state="$(systemctl --user is-enabled "$SERVICE_NAME" 2>/dev/null || true)"
        if [ "$active_state" != "inactive" ] || [ "$enabled_state" != "disabled" ]; then
            ui_message install.service_busy >&2
            exit 1
        fi
        ui_message install.service_prepared
        exit 0
    fi
fi

mkdir -p "$SYSTEMD_USER_DIR"

render_unit > "$SERVICE_PATH"

systemctl --user daemon-reload
if [ "$PREPARE_ONLY" -eq 1 ]; then
    ui_message install.service_prepared
    exit 0
fi
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

#!/bin/bash
# ============================================================
# Auto Company — Linux/WSL Dashboard Service Adapter
# ============================================================
# Dashboard controls intentionally go through the installed
# systemd --user unit. They never launch auto-loop.sh directly.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$PROJECT_DIR/scripts/core/ui-messages.sh"
LOG_DIR="$PROJECT_DIR/logs"
STATE_FILE="$PROJECT_DIR/.auto-loop-state"
PID_FILE="$PROJECT_DIR/.auto-loop.pid"
CONSENSUS_FILE="$PROJECT_DIR/memories/consensus.md"
SERVICE_NAME="auto-company.service"

systemd_user_available() {
    command -v systemctl >/dev/null 2>&1 && \
        systemctl --user --version >/dev/null 2>&1 && \
        systemctl --user show-environment >/dev/null 2>&1
}

service_installed() {
    systemctl --user cat "$SERVICE_NAME" >/dev/null 2>&1
}

service_matches_project() {
    local installed_dir resolved_dir
    installed_dir="$(systemctl --user show "$SERVICE_NAME" -p WorkingDirectory --value --no-pager 2>/dev/null)" || return 1
    resolved_dir="$(cd "$installed_dir" 2>/dev/null && pwd -P)" || return 1
    [ "$resolved_dir" = "$(cd "$PROJECT_DIR" && pwd -P)" ]
}

print_tail_sections() {
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
}

print_loop_section() {
    local daemon_summary="$1"
    local loop_pid=""
    local loop_state="stopped"
    local loop_raw="Loop not running"

    if [ -f "$PID_FILE" ]; then
        loop_pid="$(cat "$PID_FILE")"
        if [[ "$loop_pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$loop_pid" 2>/dev/null && \
            tr '\0' '\n' < "/proc/$loop_pid/cmdline" 2>/dev/null | grep -Fxq "$PROJECT_DIR/scripts/core/auto-loop.sh"; then
            loop_state="running"
            loop_raw="Loop running"
        else
            loop_raw="Loop stopped (stale PID ${loop_pid:-unknown})"
        fi
    fi

    echo "=== Loop ==="
    echo "State=$loop_state"
    if [ "$loop_state" = "running" ]; then
        echo "Pid=$loop_pid"
    fi
    echo "DaemonSummary=$daemon_summary"
    echo "Raw=$loop_raw"
}

print_status() {
    echo "=== Guardian ==="
    echo "State=unsupported"
    echo "Raw=No separate awake guardian on Linux/WSL"
    echo ""

    if ! systemd_user_available; then
        echo "=== Daemon ==="
        echo "State=unavailable"
        echo "ActiveState=unknown"
        echo "SubState=unknown"
        echo "Raw=systemctl --user is unavailable; enable systemd for this Linux/WSL session"
        echo ""
        echo "=== Autostart ==="
        echo "State=unavailable"
        echo "EnabledState=unknown"
        echo "Raw=Cannot inspect auto-company.service without systemctl --user"
        echo ""
        print_loop_section "UNAVAILABLE (systemd --user)"
        print_tail_sections
        return 1
    fi

    if ! service_installed; then
        echo "=== Daemon ==="
        echo "State=not_installed"
        echo "ActiveState=unknown"
        echo "SubState=unknown"
        echo "Raw=auto-company.service is not installed; run make install"
        echo ""
        echo "=== Autostart ==="
        echo "State=not_configured"
        echo "EnabledState=not-found"
        echo "Raw=auto-company.service is not installed; run make install"
        echo ""
        print_loop_section "NOT INSTALLED (systemd --user auto-company.service)"
        print_tail_sections
        return 0
    fi

    local active_state enabled_state main_pid sub_state daemon_state autostart_state
    active_state="$(systemctl --user is-active "$SERVICE_NAME" 2>/dev/null || true)"
    enabled_state="$(systemctl --user is-enabled "$SERVICE_NAME" 2>/dev/null || true)"
    main_pid="$(systemctl --user show "$SERVICE_NAME" -p MainPID --value --no-pager 2>/dev/null || true)"
    sub_state="$(systemctl --user show "$SERVICE_NAME" -p SubState --value --no-pager 2>/dev/null || true)"

    case "$active_state" in
        active|activating|deactivating|failed|inactive|reloading)
            daemon_state="$active_state"
            ;;
        *)
            daemon_state="unknown"
            ;;
    esac

    case "$enabled_state" in
        enabled|enabled-runtime)
            autostart_state="configured"
            ;;
        *)
            autostart_state="not_configured"
            ;;
    esac

    local daemon_raw="systemd --user $SERVICE_NAME: ${active_state:-unknown}/${sub_state:-unknown}"
    if ! service_matches_project; then
        daemon_state="mismatched"
        daemon_raw="Installed service belongs to a different checkout (or its WorkingDirectory cannot be verified); controls are blocked. Open that checkout's dashboard or deliberately reinstall with make install."
    fi

    echo "=== Daemon ==="
    echo "State=$daemon_state"
    echo "ActiveState=${active_state:-unknown}"
    echo "SubState=${sub_state:-unknown}"
    if [[ "$main_pid" =~ ^[1-9][0-9]*$ ]]; then
        echo "MainPID=$main_pid"
    fi
    echo "Raw=$daemon_raw"
    echo ""

    echo "=== Autostart ==="
    echo "State=$autostart_state"
    echo "EnabledState=${enabled_state:-unknown}"
    echo "Raw=systemd --user $SERVICE_NAME is ${enabled_state:-unknown}"
    echo ""

    print_loop_section "${active_state:-unknown} (systemd --user $SERVICE_NAME)"
    print_tail_sections
}

require_installed_service() {
    if ! systemd_user_available; then
        ui_message systemd.unavailable >&2
        return 1
    fi
    if ! service_installed; then
        ui_message systemd.not_installed >&2
        return 2
    fi
    if ! service_matches_project; then
        ui_message systemd.mismatch >&2
        return 3
    fi
}

case "${1:-status}" in
    status|refresh)
        print_status
        ;;
    check)
        require_installed_service
        ;;
    start)
        if [ -e "$PROJECT_DIR/.auto-company/maintenance.json" ] || [ -L "$PROJECT_DIR/.auto-company/maintenance.json" ]; then
            python3 "$SCRIPT_DIR/../core/installation_state.py" check --root "$PROJECT_DIR" || exit $?
        fi
        require_installed_service || exit $?
        if ! systemctl --user start "$SERVICE_NAME"; then
            ui_message systemd.start_failed "$SERVICE_NAME" >&2
            exit 1
        fi
        current_state="$(systemctl --user is-active "$SERVICE_NAME" 2>/dev/null || true)"
        if [ "$current_state" != "active" ]; then
            ui_message systemd.not_active "$SERVICE_NAME" "${current_state:-unknown}" >&2
            exit 1
        fi
        ui_message systemd.started "$SERVICE_NAME"
        ;;
    stop)
        require_installed_service || exit $?
        touch "$PROJECT_DIR/.auto-loop-stop"
        # Let the existing owner stop its model tree and seal logs/usage first.
        # systemd's default control-group TERM can interrupt these final writes.
        graceful_status=0
        bash "$PROJECT_DIR/scripts/core/stop-loop.sh" --wait || graceful_status=$?
        if ! systemctl --user stop "$SERVICE_NAME"; then
            ui_message systemd.stop_failed "$SERVICE_NAME" >&2
            exit 1
        fi
        current_state="$(systemctl --user is-active "$SERVICE_NAME" 2>/dev/null || true)"
        main_pid="$(systemctl --user show "$SERVICE_NAME" -p MainPID --value --no-pager 2>/dev/null)" || exit 1
        control_group="$(systemctl --user show "$SERVICE_NAME" -p ControlGroup --value --no-pager 2>/dev/null)" || exit 1
        remaining_processes=""
        if [ -n "$control_group" ] && [ -e "/sys/fs/cgroup$control_group/cgroup.procs" ]; then
            remaining_processes="$(cat "/sys/fs/cgroup$control_group/cgroup.procs")" || exit 1
        fi
        if { [ "$current_state" != "inactive" ] && [ "$current_state" != "failed" ]; } ||
           [ "$main_pid" != "0" ] || [ -n "$remaining_processes" ]; then
            ui_message systemd.still_active "$SERVICE_NAME" "$current_state" >&2
            exit 1
        fi
        if [ "$graceful_status" -ne 0 ]; then
            ui_message systemd.stop_failed "$SERVICE_NAME" >&2
            exit 1
        fi
        ui_message systemd.stopped "$SERVICE_NAME" "${current_state:-inactive}"
        ;;
    *)
        ui_message systemd.usage "$0" >&2
        exit 2
        ;;
esac

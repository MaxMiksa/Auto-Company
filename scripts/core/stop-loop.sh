#!/bin/bash
# ============================================================
# Auto Company — Stop Loop
# ============================================================
# Gracefully stops the auto-loop process.
# Can also pause/resume launchd daemon mode.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -e "$PROJECT_DIR/.auto-company-center.json" ] || [ -L "$PROJECT_DIR/.auto-company-center.json" ]; then
    # Managed stop belongs to the dispatch owner. Ordinary stop/pause/resume
    # must never signal a different request or clear its protection markers.
    python3 "$SCRIPT_DIR/center_runner.py" admit --root "$PROJECT_DIR" || exit 78
    case "${1:-}" in
        --pause|--resume|--pause-daemon|--resume-daemon) echo "Managed context: use the product center." >&2; exit 78 ;;
    esac
fi
source "$PROJECT_DIR/scripts/core/ui-messages.sh"
PID_FILE="$PROJECT_DIR/.auto-loop.pid"
PAUSE_FLAG="$PROJECT_DIR/.auto-loop-paused"
LABEL="com.autocompany.loop"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
OS_NAME="$(uname -s)"

is_launchd_supported() {
    [ "$OS_NAME" = "Darwin" ] && command -v launchctl >/dev/null 2>&1
}

stop_loop_process() {
    # The flag also stops startup/idle paths before another cycle can begin.
    touch "$PROJECT_DIR/.auto-loop-stop"
    ui_message loop.stop_requested
    if ! command -v python3 >/dev/null 2>&1; then
        ui_message python.required >&2
        return 1
    fi

    # Validate the held lock and exact script identity before signalling a PID.
    python3 "$SCRIPT_DIR/loop-lock.py" --stop "$PID_FILE" "$SCRIPT_DIR/auto-loop.sh" "${1:-0}"
}

pause_daemon() {
    if ! is_launchd_supported; then
        ui_message mac.only "$OS_NAME"
        exit 1
    fi

    if [ ! -f "$PLIST_PATH" ]; then
        ui_message mac.plist_missing "$PLIST_PATH"
        exit 1
    fi
    # Check both saved and loaded ownership before touching either stop marker
    # or signalling a process. A different checkout may own the shared label.
    python3 "$SCRIPT_DIR/launchd-config.py" --project "$PROJECT_DIR" --validate "$PLIST_PATH"
    local jobs loaded=0
    if ! jobs="$(launchctl list)"; then
        ui_message mac.query_failed >&2
        return 1
    fi
    if printf '%s\n' "$jobs" | awk -v label="$LABEL" '$3 == label { found=1 } END { exit !found }'; then
        loaded=1
        python3 "$SCRIPT_DIR/../macos/launchd-job.py" "$LABEL" | python3 "$SCRIPT_DIR/launchd-config.py" \
            --project "$PROJECT_DIR" --validate-loaded
    fi

    printf 'PAUSE_REASON=manual\n' > "$PAUSE_FLAG"
    ui_message mac.pause_created "$PAUSE_FLAG"
    stop_loop_process

    if [ "$loaded" -eq 1 ]; then
        if ! launchctl unload "$PLIST_PATH"; then
            # Keep both markers so the loop stays paused and Stop can retry.
            ui_message mac.unload_failed >&2
            return 1
        fi
        ui_message mac.unloaded
    fi
    ui_message mac.paused
}

resume_daemon() {
    if ! is_launchd_supported; then
        ui_message mac.only "$OS_NAME"
        exit 1
    fi

    if [ ! -f "$PLIST_PATH" ]; then
        ui_message mac.plist_missing "$PLIST_PATH"
        exit 1
    fi

    # Validate ownership before changing the agent or the operator's pause flag.
    python3 "$SCRIPT_DIR/launchd-config.py" --project "$PROJECT_DIR" --validate "$PLIST_PATH"
    if launchctl list "$LABEL" >/dev/null 2>&1; then
        python3 "$SCRIPT_DIR/../macos/launchd-job.py" "$LABEL" | python3 "$SCRIPT_DIR/launchd-config.py" \
            --project "$PROJECT_DIR" --validate-loaded
        # Start is idempotent for a running agent and preserves its environment.
        launchctl start "$LABEL"
    else
        launchctl load "$PLIST_PATH"
    fi

    # A failed load/start must leave the existing pause marker intact.
    rm -f "$PAUSE_FLAG"
    ui_message mac.resumed
}

case "${1:-}" in
    --wait)
        stop_loop_process 20
        ;;
    --pause-daemon)
        pause_daemon
        ;;
    --resume-daemon)
        resume_daemon
        ;;
    --help|-h)
        ui_message stop.help
        ;;
    *)
        stop_loop_process
        ;;
esac

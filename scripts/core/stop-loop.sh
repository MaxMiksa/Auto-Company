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
PID_FILE="$PROJECT_DIR/.auto-loop.pid"
PAUSE_FLAG="$PROJECT_DIR/.auto-loop-paused"
LABEL="com.autocompany.loop"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
OS_NAME="$(uname -s)"

is_launchd_supported() {
    [ "$OS_NAME" = "Darwin" ] && command -v launchctl >/dev/null 2>&1
}

stop_loop_process() {
    # Method 1: Signal file (graceful, waits for current cycle to finish)
    touch "$PROJECT_DIR/.auto-loop-stop"
    echo "Stop signal sent. Loop will stop after current cycle completes."

    # Method 2: Also send SIGTERM if PID file exists
    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            echo "Sending SIGTERM to PID $pid..."
            kill -TERM "$pid"
        else
            echo "Process $pid not running. Cleaning up PID file."
            rm -f "$PID_FILE"
        fi
    else
        echo "No PID file found."
    fi
}

pause_daemon() {
    if ! is_launchd_supported; then
        echo "Daemon pause is only supported on macOS launchd."
        echo "On Windows/WSL, run ./stop-loop.sh to stop the foreground loop."
        exit 1
    fi

    touch "$PAUSE_FLAG"
    echo "Pause flag created: $PAUSE_FLAG"
    stop_loop_process

    if launchctl list 2>/dev/null | grep -q "$LABEL"; then
        launchctl unload "$PLIST_PATH" 2>/dev/null || true
        echo "Daemon unloaded."
    fi
    echo "Daemon paused. Resume with: ./stop-loop.sh --resume-daemon"
}

resume_daemon() {
    if ! is_launchd_supported; then
        echo "Daemon resume is only supported on macOS launchd."
        echo "On Windows/WSL, start the loop with ./auto-loop.sh or make start."
        exit 1
    fi

    rm -f "$PAUSE_FLAG"
    echo "Pause flag removed."

    if [ ! -f "$PLIST_PATH" ]; then
        echo "LaunchAgent plist not found: $PLIST_PATH"
        echo "Install daemon first: ./install-daemon.sh"
        exit 1
    fi

    if launchctl list 2>/dev/null | grep -q "$LABEL"; then
        launchctl unload "$PLIST_PATH" 2>/dev/null || true
    fi

    launchctl load "$PLIST_PATH"
    echo "Daemon resumed and started."
}

case "${1:-}" in
    --pause-daemon)
        pause_daemon
        ;;
    --resume-daemon)
        resume_daemon
        ;;
    --help|-h)
        echo "Usage:"
        echo "  ./stop-loop.sh                 # Stop current loop process"
        echo "  ./stop-loop.sh --pause-daemon  # Pause launchd daemon and stop loop (macOS only)"
        echo "  ./stop-loop.sh --resume-daemon # Resume launchd daemon (macOS only)"
        ;;
    *)
        stop_loop_process
        ;;
esac

#!/bin/bash
# ============================================================
# Auto Company — Install/Uninstall launchd Daemon (macOS)
# ============================================================
# Generates a launchd plist dynamically based on current paths,
# installs it to ~/Library/LaunchAgents/, and loads it.
#
# Usage:
#   ./install-daemon.sh             # Install and start
#   ./install-daemon.sh --uninstall # Stop and remove
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LABEL="com.autocompany.loop"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
PAUSE_FLAG="${PROJECT_DIR}/.auto-loop-paused"
OS_NAME="$(uname -s)"
ENGINE="${ENGINE:-claude}"
ENGINE="$(echo "$ENGINE" | tr '[:upper:]' '[:lower:]')"
MODEL="${MODEL:-}"
CLAUDE_BIN="${CLAUDE_BIN:-}"
CLAUDE_PERMISSION_MODE="${CLAUDE_PERMISSION_MODE:-bypassPermissions}"
CODEX_BIN="${CODEX_BIN:-}"
CODEX_SANDBOX_MODE="${CODEX_SANDBOX_MODE:-danger-full-access}"

if [ "$ENGINE" != "claude" ] && [ "$ENGINE" != "codex" ]; then
    echo "Error: ENGINE must be 'claude' or 'codex' (received: '$ENGINE')."
    exit 1
fi

if [ "$OS_NAME" != "Darwin" ]; then
    echo "install-daemon.sh supports macOS launchd only."
    echo "Current OS: $OS_NAME"
    echo "Use foreground mode instead: make start"
    exit 1
fi

# --- Uninstall ---
if [ "${1:-}" = "--uninstall" ]; then
    echo "Uninstalling Auto Company daemon..."
    if launchctl list | grep -q "$LABEL"; then
        launchctl unload "$PLIST_PATH" 2>/dev/null || true
        echo "Service unloaded."
    fi
    if [ -f "$PLIST_PATH" ]; then
        rm -f "$PLIST_PATH"
        echo "Plist removed: $PLIST_PATH"
    fi
    echo "Done. Daemon uninstalled."
    exit 0
fi

# --- Install ---

# Check dependencies by selected engine
ENGINE_PATH=""
case "$ENGINE" in
    claude)
        if [ -n "$CLAUDE_BIN" ]; then
            if [ -x "$CLAUDE_BIN" ]; then
                ENGINE_PATH="$CLAUDE_BIN"
            elif command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
                ENGINE_PATH="$(command -v "$CLAUDE_BIN")"
            fi
        fi
        if [ -z "$ENGINE_PATH" ] && command -v claude >/dev/null 2>&1; then
            ENGINE_PATH="$(command -v claude)"
        fi
        if [ -z "$ENGINE_PATH" ]; then
            echo "Error: 'claude' CLI not found. Install Claude Code first or set CLAUDE_BIN."
            exit 1
        fi
        ;;
    codex)
        if [ -n "$CODEX_BIN" ]; then
            if [ -x "$CODEX_BIN" ]; then
                ENGINE_PATH="$CODEX_BIN"
            elif command -v "$CODEX_BIN" >/dev/null 2>&1; then
                ENGINE_PATH="$(command -v "$CODEX_BIN")"
            fi
        fi
        if [ -z "$ENGINE_PATH" ] && command -v codex >/dev/null 2>&1; then
            ENGINE_PATH="$(command -v codex)"
        fi
        if [ -z "$ENGINE_PATH" ]; then
            echo "Error: 'codex' CLI not found. Install Codex CLI first or set CODEX_BIN."
            exit 1
        fi
        ;;
esac

ENGINE_DIR="$(dirname "$ENGINE_PATH")"

# Detect node path (for wrangler/npx)
NODE_DIR=""
if command -v node &>/dev/null; then
    NODE_DIR="$(dirname "$(command -v node)")"
fi

# Build PATH: include all tool directories
DAEMON_PATH="${ENGINE_DIR}"
[ -n "$NODE_DIR" ] && DAEMON_PATH="${DAEMON_PATH}:${NODE_DIR}"
DAEMON_PATH="${DAEMON_PATH}:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

echo "Installing Auto Company daemon..."
echo "  Project: $PROJECT_DIR"
echo "  Engine:  $ENGINE"
echo "  CLI:     $ENGINE_PATH"
engine_version="$("$ENGINE_PATH" --version 2>/dev/null | head -n1 || true)"
if [ -n "$engine_version" ]; then
    echo "  Version: $engine_version"
fi
echo "  PATH:    $DAEMON_PATH"

mkdir -p "$HOME/Library/LaunchAgents" "$PROJECT_DIR/logs"
# Install implies active running state
rm -f "$PAUSE_FLAG"

# Unload existing if running
if launchctl list 2>/dev/null | grep -q "$LABEL"; then
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# Generate plist
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${PROJECT_DIR}/scripts/core/auto-loop.sh</string>
        <string>--daemon</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${PROJECT_DIR}</string>

    <key>KeepAlive</key>
    <dict>
        <key>PathState</key>
        <dict>
            <key>${PAUSE_FLAG}</key>
            <false/>
        </dict>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${PROJECT_DIR}/logs/launchd-stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${PROJECT_DIR}/logs/launchd-stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${DAEMON_PATH}</string>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>ENGINE</key>
        <string>${ENGINE}</string>
        <key>MODEL</key>
        <string>${MODEL}</string>
        <key>CLAUDE_PERMISSION_MODE</key>
        <string>${CLAUDE_PERMISSION_MODE}</string>
        <key>CLAUDE_BIN</key>
        <string>${CLAUDE_BIN}</string>
        <key>CODEX_BIN</key>
        <string>${CODEX_BIN}</string>
        <key>CODEX_SANDBOX_MODE</key>
        <string>${CODEX_SANDBOX_MODE}</string>
    </dict>

    <key>ThrottleInterval</key>
    <integer>30</integer>
</dict>
</plist>
EOF

echo "Plist written: $PLIST_PATH"

# Load
launchctl load "$PLIST_PATH"
echo ""
echo "Daemon installed and started!"
echo ""
echo "Commands:"
echo "  ./monitor.sh            # Watch live logs"
echo "  ./monitor.sh --status   # Check status"
echo "  ./stop-loop.sh          # Stop the loop (daemon will restart it)"
echo "  ./stop-loop.sh --pause-daemon   # Pause daemon (no auto-restart)"
echo "  ./stop-loop.sh --resume-daemon  # Resume daemon"
echo "  ./install-daemon.sh --uninstall  # Remove daemon completely"

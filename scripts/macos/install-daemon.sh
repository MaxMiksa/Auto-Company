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
source "$PROJECT_DIR/scripts/core/ui-messages.sh"
LABEL="com.autocompany.loop"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
PAUSE_FLAG="${PROJECT_DIR}/.auto-loop-paused"
OS_NAME="$(uname -s)"
PREPARE_ONLY=0
[ "${1:-}" != "--prepare" ] || PREPARE_ONLY=1
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--prepare" ] && [ "$1" != "--uninstall" ]; }; then
    ui_message install.invalid_argument >&2
    exit 2
fi
ENGINE="${ENGINE:-claude}"
ENGINE="$(echo "$ENGINE" | tr '[:upper:]' '[:lower:]')"
MODEL="${MODEL:-}"
CLAUDE_BIN="${CLAUDE_BIN:-}"
CLAUDE_PERMISSION_MODE="${CLAUDE_PERMISSION_MODE:-bypassPermissions}"
CODEX_BIN="${CODEX_BIN:-}"
CODEX_SANDBOX_MODE="${CODEX_SANDBOX_MODE:-danger-full-access}"

source "$SCRIPT_DIR/../core/engine-adapters.sh"

if [ "$OS_NAME" != "Darwin" ]; then
    ui_message mac.only "$OS_NAME"
    exit 1
fi

# --- Uninstall ---
if [ "${1:-}" = "--uninstall" ]; then
    ui_message mac.uninstalling
    if launchctl list | grep -q "$LABEL"; then
        launchctl unload "$PLIST_PATH" 2>/dev/null || true
        ui_message mac.unloaded
    fi
    if [ -f "$PLIST_PATH" ]; then
        rm -f "$PLIST_PATH"
        ui_message mac.removed "$PLIST_PATH"
    fi
    ui_message mac.uninstalled
    exit 0
fi

# --- Install ---

if [ -e "$PROJECT_DIR/.auto-company/maintenance.json" ] || [ -L "$PROJECT_DIR/.auto-company/maintenance.json" ]; then
    python3 "$SCRIPT_DIR/../core/installation_state.py" check --root "$PROJECT_DIR"
fi

if [ "$PREPARE_ONLY" -eq 1 ]; then
    if launchctl list "$LABEL" >/dev/null 2>&1; then
        ui_message install.service_busy >&2
        exit 1
    fi
    if [ -e "$PLIST_PATH" ] || [ -L "$PLIST_PATH" ]; then
        [ ! -L "$PLIST_PATH" ] || { ui_message install.service_conflict >&2; exit 1; }
        python3 "$SCRIPT_DIR/../core/launchd-config.py" --project "$PROJECT_DIR" --validate "$PLIST_PATH"
        if ! python3 "$SCRIPT_DIR/../core/launchd-config.py" --project "$PROJECT_DIR" --is-prepared "$PLIST_PATH"; then
            ui_message install.service_busy >&2
            exit 1
        fi
        ui_message install.service_prepared
        exit 0
    fi
fi

if ! engine_adapter_validate; then
    ui_message engine.invalid >&2
    exit 1
fi
command -v python3 >/dev/null 2>&1 || {
    echo "Error: Python 3 is required for runtime accounting and launchd configuration."
    ui_message python.required
    exit 1
}

# Check dependencies by selected engine
ENGINE_PATH=""
if ! ENGINE_PATH="$(engine_adapter_resolve)"; then
    echo "Error: $(engine_adapter_missing_dependency_message)"
    ui_message engine.missing
    exit 1
fi

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

ui_message mac.installing
echo "  Project: $PROJECT_DIR"
echo "  Engine:  $ENGINE"
echo "  CLI:     $ENGINE_PATH"
engine_version="$("$ENGINE_PATH" --version 2>/dev/null | head -n1 | adapter_redact || true)"
if [ -n "$engine_version" ]; then
    echo "  Version: $engine_version"
fi
echo "  PATH:    $DAEMON_PATH"
if [ "$ENGINE" = "openai-compatible" ] && [ -n "${OPENAI_COMPATIBLE_API_KEY:-}" ]; then
    echo "  Notice: OPENAI_COMPATIBLE_API_KEY is intentionally not written to the launchd plist."
    echo "          Use a secure process-environment injector for authenticated endpoints."
fi

mkdir -p "$HOME/Library/LaunchAgents" "$PROJECT_DIR/logs"
# Install implies active running state
if [ "$PREPARE_ONLY" -eq 0 ]; then rm -f "$PAUSE_FLAG"; fi

# Unload existing if running
if [ "$PREPARE_ONLY" -eq 0 ] && launchctl list 2>/dev/null | grep -q "$LABEL"; then
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# Export resolved defaults; explicit timeout and budget settings are inherited.
# The renderer allowlists settings, excludes API keys, and escapes XML values.
export ENGINE MODEL CLAUDE_BIN CLAUDE_PERMISSION_MODE CODEX_BIN CODEX_SANDBOX_MODE
export CURSOR_BIN CURSOR_ADAPTER_ENABLED CURSOR_SANDBOX_MODE CURSOR_FORCE CURSOR_ALLOW_UNSANDBOXED
export OPENAI_COMPATIBLE_ADAPTER_ENABLED OPENAI_COMPATIBLE_ENDPOINT OPENAI_COMPATIBLE_MODEL
export OPENAI_COMPATIBLE_ALLOW_SHELL OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP
render_args=(--project "$PROJECT_DIR" --path "$DAEMON_PATH" --output "$PLIST_PATH")
if [ "$PREPARE_ONLY" -eq 1 ]; then render_args+=(--prepare); fi
python3 "$SCRIPT_DIR/../core/launchd-config.py" "${render_args[@]}"

ui_message mac.written "$PLIST_PATH"

# Load
if [ "$PREPARE_ONLY" -eq 1 ]; then
    ui_message install.service_prepared
    exit 0
fi
launchctl load "$PLIST_PATH"
echo ""
ui_message mac.installed
echo ""
ui_message mac.commands

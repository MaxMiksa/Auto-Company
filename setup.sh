#!/bin/bash
# Downloaded release entry point. Works with macOS Bash 3.2.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)" || exit 1
exec bash "$SCRIPT_DIR/scripts/install/bootstrap.sh" "$@"

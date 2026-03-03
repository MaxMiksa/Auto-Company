#!/bin/bash
set -euo pipefail

BIND_HOST="${1:-127.0.0.1}"
PORT="${2:-8787}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_DIR"
python3 dashboard/server-macos.py --host "$BIND_HOST" --port "$PORT"

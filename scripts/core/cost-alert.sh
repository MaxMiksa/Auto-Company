#!/bin/bash
# ============================================================
# Auto Company — Cost Alert wrapper (launchd-triggered)
# ============================================================
# Runs cost-monitor.sh --check against the daily threshold; when
# today's spend exceeds it, pops a macOS desktop notification and
# records the event. Designed to be scheduled by launchd.
#
# Config:
#   COST_THRESHOLD_DAILY  daily spend threshold in USD (default 20)
#
# Logs one line per run to logs/cost-daily.log regardless of outcome.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COST_MONITOR="$SCRIPT_DIR/cost-monitor.sh"
RUN_LOG="$PROJECT_DIR/logs/cost-daily.log"
THRESHOLD="${COST_THRESHOLD_DAILY:-20}"

[ -f "$COST_MONITOR" ] || { echo "cost-monitor.sh missing at $COST_MONITOR" >&2; exit 1; }
mkdir -p "$PROJECT_DIR/logs"

rc=0
output="$("$COST_MONITOR" --check --threshold "$THRESHOLD" 2>&1)" || rc=$?

echo "$(date '+%Y-%m-%d %H:%M:%S') [rc=$rc] $output" >> "$RUN_LOG"

if [ "$rc" -ne 0 ]; then
    # Threshold exceeded: desktop notification (best effort) + keep log
    osascript -e "display notification \"$output\" with title \"Auto-Company 成本告警\" sound name \"Glass\"" 2>/dev/null \
        || echo "$(date '+%Y-%m-%d %H:%M:%S') [notify-failed]" >> "$RUN_LOG"
fi

exit 0

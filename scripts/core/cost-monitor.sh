#!/bin/bash
# ============================================================
# Auto Company — Cost Monitor (daily summary + threshold alert)
# ============================================================
# Parses per-cycle cost from logs/auto-loop.log and summarizes
# by calendar day.
#
# Usage:
#   ./cost-monitor.sh                  # today's summary
#   ./cost-monitor.sh --days 7         # last 7 days, oldest first
#   ./cost-monitor.sh --threshold 25   # daily threshold in USD (default 20)
#   ./cost-monitor.sh --check          # alert mode: exit 1 if today exceeds
#                                      #   threshold, else 0 (cron-friendly)
#   ./cost-monitor.sh --date 2026-08-02  # single day (or "yesterday")
#
# Exit codes:
#   0  OK (no alert, or no data)
#   1  threshold exceeded (--check mode)
#   2  usage error
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_FILE="$PROJECT_DIR/logs/auto-loop.log"
ALERT_LOG="$PROJECT_DIR/logs/cost-alerts.log"

THRESHOLD="${COST_THRESHOLD_DAILY:-20}"
DAYS=1
MODE="summary"
TARGET_DAY=""

# macOS `date -v` vs GNU `date -d`: support both.
days_ago() {
    local n="$1"
    if date -v-"${n}"d '+%Y-%m-%d' >/dev/null 2>&1; then
        date -v-"${n}"d '+%Y-%m-%d'
    else
        date -d "-${n} days" '+%Y-%m-%d'
    fi
}
today() { days_ago 0; }

while [ $# -gt 0 ]; do
    case "$1" in
        --days)       DAYS="$2"; shift 2 ;;
        --threshold)  THRESHOLD="$2"; shift 2 ;;
        --date)       TARGET_DAY="$2"; shift 2 ;;
        --check)      MODE="check"; shift ;;
        --help|-h)
            grep -E '^#   ' "$0" | sed 's/^#   //'
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

case "$TARGET_DAY" in
    ""|today)   TARGET_DAY="$(today)" ;;
    yesterday)  TARGET_DAY="$(days_ago 1)" ;;
esac

if [ ! -f "$LOG_FILE" ]; then
    echo "No log file at $LOG_FILE"
    exit 0
fi

# Emit "<YYYY-MM-DD> <cost>" for every line carrying a real cost
# (skips "cost: N/A" and empty values).
raw="$(awk '
    match($0, /cost: [0-9]+(\.[0-9]+)?/) {
        cost = substr($0, RSTART + 6, RLENGTH - 6)
        day  = substr($0, 2, 10)   # [YYYY-MM-DD ...
        if (cost != "" && day ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) {
            print day, cost
        }
    }
' "$LOG_FILE")"

if [ -z "$raw" ]; then
    echo "No cycle cost data found in $LOG_FILE yet."
    exit 0
fi

# Aggregate per day: <date> <total> <runs> <max>
agg="$(echo "$raw" | awk '
    { s[$1] += $2; n[$1]++; if ($2 > m[$1]) m[$1] = $2 }
    END { for (d in s) printf "%s %.6f %d %.6f\n", d, s[d], n[d], m[d] }
' | sort)"

# Build the list of days to show.
days_list=""
for i in $(seq 0 "$((DAYS - 1))"); do
    days_list="$days_list $(days_ago "$i")"
done

# Filter aggregated rows to the requested window.
rows=""
while read -r d total runs maxcost; do
    [ -z "$d" ] && continue
    if [ "$DAYS" -eq 1 ] && [ "$d" != "$TARGET_DAY" ]; then
        continue
    fi
    case " $days_list " in
        *" $d "*) rows="$rows$d $total $runs $maxcost\n" ;;
    esac
done <<< "$agg"
# Keep the trailing \n: bash `read` treats a final line without a newline
# as EOF and would skip the row entirely.

if [ "$MODE" = "check" ]; then
    today_total="$(printf '%b' "$rows" | awk -v t="$TARGET_DAY" '$1 == t { print $2; exit }')"
    today_total="${today_total:-0}"
    today_fmt="$(awk -v t="$today_total" 'BEGIN { printf "%.2f", t }')"
    if awk -v t="$today_total" -v th="$THRESHOLD" 'BEGIN { exit !(t > th) }'; then
        msg="$(date '+%Y-%m-%d %H:%M:%S') ALERT: $TARGET_DAY cost \$$today_fmt exceeds threshold \$$THRESHOLD"
        echo "$msg"
        echo "$msg" >> "$ALERT_LOG"
        exit 1
    fi
    echo "$(date '+%Y-%m-%d %H:%M:%S') OK: $TARGET_DAY cost \$$today_fmt within threshold \$$THRESHOLD"
    exit 0
fi

# Summary table (pure printf alignment; macOS column lacks -t)
printf '%-12s %9s %6s %9s %9s\n' "Date" "Total\$" "Runs" "Avg\$" "Max\$"
printf '%-12s %9s %6s %9s %9s\n' "----------" "---------" "------" "--------" "--------"
printf '%b' "$rows" | while read -r d total runs maxcost; do
    avg=$(awk -v t="$total" -v n="$runs" 'BEGIN { printf "%.2f", (n ? t/n : 0) }')
    printf '%-12s %9.2f %6s %9s %9.2f\n' "$d" "$total" "$runs" "$avg" "$maxcost"
done
grand=$(printf '%b' "$rows" | awk '{ s += $2 } END { printf "%.2f", s }')
printf '%-12s %9s\n' "----------" "---------"
printf '%-12s %9s\n' "Total" "\$$grand"

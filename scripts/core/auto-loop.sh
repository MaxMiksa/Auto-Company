#!/bin/bash
# ============================================================
# Auto Company — 24/7 Autonomous Loop
# ============================================================
# Keeps the selected engine adapter running continuously.
# Uses fresh sessions with consensus.md as the relay baton.
#
# Usage:
#   ./auto-loop.sh              # Run in foreground
#   ./auto-loop.sh --daemon     # Run via launchd (macOS only)
#
# Stop:
#   ./stop-loop.sh              # Graceful stop
#   kill $(cat .auto-loop.pid)  # Force stop
#
# Config (env vars):
#   ENGINE=claude               # claude|codex|cursor|openai-compatible
#   MODEL=...                   # Optional model override (empty = engine default)
#   AUTO_COMPANY_LANGUAGE=zh-CN # Initial fallback only; saved preference wins
#   CLAUDE_BIN=...              # Optional Claude executable override
#   CLAUDE_PERMISSION_MODE=bypassPermissions
#                               # Claude permission mode (default: bypassPermissions)
#   CODEX_BIN=...               # Optional Codex executable override
#   CODEX_SANDBOX_MODE=danger-full-access
#                               # Codex sandbox mode (only for ENGINE=codex)
#   CURSOR_ADAPTER_ENABLED=1    # Required opt-in for ENGINE=cursor
#   CURSOR_SANDBOX_MODE=enabled # Safe default
#   OPENAI_COMPATIBLE_ADAPTER_ENABLED=1
#                               # Required opt-in for ENGINE=openai-compatible
#   OPENAI_COMPATIBLE_ENDPOINT=...  # Required exact endpoint (no default)
#   OPENAI_COMPATIBLE_MODEL=...     # Required model (MODEL also accepted)
#   OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP=1
#                               # Explicit opt-in for non-loopback plain HTTP
#   LOOP_INTERVAL=30            # Seconds between cycles (default: 30)
#   CYCLE_TIMEOUT_SECONDS=1800  # Max seconds per cycle before force-kill
#   CYCLE_TERM_GRACE_SECONDS=5  # Grace after TERM before KILL
#   CYCLE_KILL_WAIT_SECONDS=5   # Max wait to confirm the killed tree is gone
#   MAX_CONSECUTIVE_ERRORS=5    # Circuit breaker threshold
#   COOLDOWN_SECONDS=300        # Cooldown after circuit break
#   LIMIT_WAIT_SECONDS=3600     # Wait on usage limit
#   MAX_LOGS=200                # Max cycle logs to keep
#   USAGE_BUDGET_PERIOD=day     # Budget window: day|week
#   USAGE_WARNING_USD=          # Alert only; no price is inferred
#   USAGE_HARD_LIMIT_USD=       # Pause after the current cycle
#   USAGE_WARNING_TOKENS=       # Alert only on reported total tokens
#   USAGE_HARD_LIMIT_TOKENS=    # Pause after the current cycle
#   AUTO_LOOP_PROTECT_GITIGNORE=1
#                               # Restore .gitignore if a cycle mutates it
# ============================================================

set -euo pipefail

# === Resolve project root (always relative to this script) ===
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# Managed roots have one explicit dispatch owner. Unmanaged CLI entry points
# retain their original behavior; this check runs before any root mutation.
center_admission_check() {
    { [ ! -e "$PROJECT_DIR/.auto-company-center.json" ] && [ ! -L "$PROJECT_DIR/.auto-company-center.json" ]; } ||
        python3 "$SCRIPT_DIR/center_runner.py" admit --root "$PROJECT_DIR"
}
center_admission_check || exit 78
source "$PROJECT_DIR/scripts/core/ui-messages.sh"
source "$SCRIPT_DIR/process-supervisor.sh"

LOG_DIR="$PROJECT_DIR/logs"
CONSENSUS_FILE="$PROJECT_DIR/memories/consensus.md"
PROMPT_FILE="$PROJECT_DIR/PROMPT.md"
PID_FILE="$PROJECT_DIR/.auto-loop.pid"
STATE_FILE="$PROJECT_DIR/.auto-loop-state"
PAUSE_FLAG="$PROJECT_DIR/.auto-loop-paused"
CONSENSUS_GUARD="$SCRIPT_DIR/consensus-guard.sh"
PROJECT_CONTEXT_TOOL="$SCRIPT_DIR/project-context.py"
PRODUCT_IDENTITY_TOOL="$SCRIPT_DIR/product_identity.py"
LOCALIZATION_TOOL="$SCRIPT_DIR/localization.py"
USAGE_FILE="$LOG_DIR/usage.jsonl"
USAGE_TOOL="$PROJECT_DIR/scripts/core/usage.py"
BUDGET_PAUSE_FILE="$PROJECT_DIR/.auto-loop-budget-paused"
LOOP_SLEEP_PID=""
CURRENT_PRODUCT_CYCLE_ID=""
MEDIA_FINALIZER_PID=""

# Loop settings (all overridable via env vars)
ENGINE="${ENGINE:-claude}"
ENGINE="$(echo "$ENGINE" | tr '[:upper:]' '[:lower:]')"
MODEL="${MODEL:-}"
MODEL_LABEL="${MODEL:-config-default}"
CLAUDE_BIN="${CLAUDE_BIN:-}"
CLAUDE_PERMISSION_MODE="${CLAUDE_PERMISSION_MODE:-bypassPermissions}"
CODEX_BIN="${CODEX_BIN:-}"
CODEX_SANDBOX_MODE="${CODEX_SANDBOX_MODE:-danger-full-access}"
LOOP_INTERVAL="${LOOP_INTERVAL:-30}"
CYCLE_TIMEOUT_SECONDS="${CYCLE_TIMEOUT_SECONDS:-1800}"
CYCLE_TERM_GRACE_SECONDS="${CYCLE_TERM_GRACE_SECONDS:-5}"
CYCLE_KILL_WAIT_SECONDS="${CYCLE_KILL_WAIT_SECONDS:-5}"
MAX_CONSECUTIVE_ERRORS="${MAX_CONSECUTIVE_ERRORS:-5}"
COOLDOWN_SECONDS="${COOLDOWN_SECONDS:-300}"
LIMIT_WAIT_SECONDS="${LIMIT_WAIT_SECONDS:-3600}"
MAX_LOGS="${MAX_LOGS:-200}"
AUTO_LOOP_PROTECT_GITIGNORE="${AUTO_LOOP_PROTECT_GITIGNORE:-1}"
BUDGET_PAUSE_POLL_SECONDS="${BUDGET_PAUSE_POLL_SECONDS:-10}"
RESOLVED_ENGINE_BIN=""

source "$SCRIPT_DIR/engine-adapters.sh"
if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required for process ownership and structured usage accounting."
    ui_message python.required
    exit 1
fi
if [ "$ENGINE" = "openai-compatible" ]; then
    MODEL_LABEL="$OPENAI_COMPATIBLE_MODEL"
fi
if ! engine_adapter_validate; then
    ui_message engine.invalid >&2
    # EX_CONFIG lets service managers distinguish operator configuration errors
    # from runtime failures and avoid a restart loop.
    exit 78
fi

if ! cycle_supervisor_validate_config "$CYCLE_TIMEOUT_SECONDS" "$CYCLE_TERM_GRACE_SECONDS" "$CYCLE_KILL_WAIT_SECONDS"; then
    ui_message loop.timeout_invalid
    exit 1
fi

# Keep Agent Teams compatibility for legacy prompts/config.
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

# === Functions ===

log() {
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local msg="[$timestamp] $1"
    echo "$msg" >> "$LOG_DIR/auto-loop.log"
    if [ -t 1 ]; then
        echo "$msg"
    fi
}

log_cycle() {
    local cycle_num=$1
    local status=$2
    local msg=$3
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] Cycle #$cycle_num [$status] $msg" >> "$LOG_DIR/auto-loop.log"
    if [ -t 1 ]; then
        echo "[$timestamp] Cycle #$cycle_num [$status] $msg"
    fi
}

# Bash defers a TERM trap while a foreground sleep runs. Waiting on a tracked
# background sleep lets stop requests interrupt long cooldowns immediately.
loop_sleep() {
    sleep "$1" &
    LOOP_SLEEP_PID=$!
    wait "$LOOP_SLEEP_PID" || true
    LOOP_SLEEP_PID=""
}

check_usage_limit() {
    local output="$1"
    if echo "$output" | grep -qi "usage limit\|rate limit\|too many requests\|resource_exhausted\|overloaded\|quota\|429\|billing\|insufficient credits"; then
        return 0
    fi
    return 1
}

check_stop_requested() {
    if [ -f "$PROJECT_DIR/.auto-loop-stop" ]; then
        rm -f "$PROJECT_DIR/.auto-loop-stop"
        return 0
    fi
    return 1
}

read_pause_reason() {
    local pause_file="$1" fallback="$2" reason=""
    [ -f "$pause_file" ] || {
        printf '%s\n' "$fallback"
        return
    }
    reason=$(sed -n -E 's/^PAUSE_REASON=([^[:space:]]+).*$/\1/p' "$pause_file" | head -n1)
    if [ -z "$reason" ]; then
        reason=$(sed -n -E 's/.*"reason"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$pause_file" | head -n1)
    fi
    printf '%s\n' "${reason:-$fallback}"
}

wait_while_paused() {
    local pause_reason
    [ -f "$PAUSE_FLAG" ] || return 0
    pause_reason=$(read_pause_reason "$PAUSE_FLAG" "manual_or_governance")
    log "Loop paused (${pause_reason}). Remove .auto-loop-paused only after reviewing the reason."
    log "$(ui_message loop.paused "$pause_reason")"
    while [ -f "$PAUSE_FLAG" ]; do
        save_state "paused" "$pause_reason"
        if check_stop_requested; then
            log "Stop requested while paused. Shutting down gracefully."
            cleanup
        fi
        loop_sleep 5
    done
    log "Governance pause cleared. Resuming preflight checks."
    log "$(ui_message loop.resuming)"
}

save_state() {
    local status="$1" pause_reason="${2:-}" state_tmp
    state_tmp="$(mktemp "${STATE_FILE}.XXXXXX")"
    cat > "$state_tmp" << EOF
LOOP_COUNT=$loop_count
ERROR_COUNT=$error_count
LAST_RUN=$(date '+%Y-%m-%d %H:%M:%S')
STATUS=$status
PAUSE_REASON=$pause_reason
MODEL=$MODEL_LABEL
ENGINE=$ENGINE
PRODUCT_ID=${PRODUCT_ID:-}
PRODUCT_CYCLE_NUMBER=${PRODUCT_CYCLE_NUMBER:-}
PRODUCT_CYCLE_ID=$CURRENT_PRODUCT_CYCLE_ID
EOF
    mv "$state_tmp" "$STATE_FILE"
}

wait_for_budget_resume() {
    local pause_reason
    if [ ! -f "$BUDGET_PAUSE_FILE" ]; then
        return
    fi

    pause_reason=$(read_pause_reason "$BUDGET_PAUSE_FILE" "usage_budget")
    log "Usage governance pause is active (${pause_reason}). Next cycle is blocked until manual 'make resume'."
    log "$(ui_message budget.paused "$pause_reason")"
    while [ -f "$BUDGET_PAUSE_FILE" ]; do
        save_state "paused" "$pause_reason"
        if check_stop_requested; then
            log "Stop requested while budget-paused. Shutting down gracefully."
            cleanup
        fi
        loop_sleep "$BUDGET_PAUSE_POLL_SECONDS"
    done
    log "Budget pause cleared manually. Cycles may resume."
    log "$(ui_message budget.resumed)"
}

record_cycle_usage() {
    local budget_state cycle_id
    cycle_id=$(basename "$cycle_log" .log)

    if budget_state=$(python3 "$USAGE_TOOL" record \
        --ledger "$USAGE_FILE" \
        --pause-file "$BUDGET_PAUSE_FILE" \
        --cycle-id "$cycle_id" \
        --cycle-number "$loop_count" \
        --started-at "$cycle_started_at" \
        --ended-at "$cycle_ended_at" \
        --status "$CYCLE_LEDGER_STATUS" \
        --exit-code "$EXIT_CODE" \
        --engine "$ENGINE" \
        --model "$MODEL_LABEL" \
        --metadata-file "$cycle_record" \
        --result-format state); then
        echo "$budget_state"
        return
    fi

    echo "record_error"
}

cancel_media_finalizer() {
    if [ -n "$MEDIA_FINALIZER_PID" ]; then
        kill -TERM "$MEDIA_FINALIZER_PID" 2>/dev/null || true
        wait "$MEDIA_FINALIZER_PID" 2>/dev/null || true
        MEDIA_FINALIZER_PID=""
    fi
}

finalize_cycle_media() {
    [ ! -f "$PROJECT_DIR/.auto-loop-stop" ] || return 0
    python3 "$SCRIPT_DIR/runtime_artifacts.py" --root "$PROJECT_DIR" finalize \
        --cycle "$CURRENT_PRODUCT_CYCLE_ID" >/dev/null 2>&1 &
    MEDIA_FINALIZER_PID=$!
    # Waiting on a tracked background process lets TERM run cleanup immediately.
    # A plain stop flag also cancels optional media while retaining cycle facts.
    while kill -0 "$MEDIA_FINALIZER_PID" 2>/dev/null; do
        if [ -f "$PROJECT_DIR/.auto-loop-stop" ]; then
            cancel_media_finalizer
            return 0
        fi
        loop_sleep 0.1
    done
    wait "$MEDIA_FINALIZER_PID" 2>/dev/null || true
    MEDIA_FINALIZER_PID=""
}

cleanup() {
    local requested_exit="${1:-0}" final_state="${2:-stopped}"
    trap '' SIGTERM SIGINT SIGHUP
    if [ -n "$LOOP_SLEEP_PID" ]; then
        kill -TERM "$LOOP_SLEEP_PID" 2>/dev/null || true
        wait "$LOOP_SLEEP_PID" 2>/dev/null || true
        LOOP_SLEEP_PID=""
    fi
    cancel_media_finalizer
    if ! cycle_supervisor_cleanup; then
        requested_exit=1
        final_state="process_cleanup_failed"
        log "Process-tree cleanup could not be confirmed for cycle PGID ${CYCLE_SUPERVISOR_LAST_PGID}"
    else
        if [ -n "${AUTO_COMPANY_CYCLE_ID:-}" ]; then
            python3 "$SCRIPT_DIR/runtime_artifacts.py" --root "$PROJECT_DIR" finalize \
                --cycle "$AUTO_COMPANY_CYCLE_ID" --cleanup-only >/dev/null 2>&1 || true
        fi
        # A signal interrupts adapter_execute before it can publish its output.
        # Preserve already emitted evidence after the owned process tree exits.
        if [ -n "${ADAPTER_OUTPUT_FILE:-}" ] && [ -f "$ADAPTER_OUTPUT_FILE" ] &&
           [ -f "${USAGE_FILE}.pending" ]; then
            ADAPTER_OUTPUT=$(adapter_redact < "$ADAPTER_OUTPUT_FILE")
            printf '%s\n' "$ADAPTER_OUTPUT" > "$cycle_log"
            ADAPTER_RESULT_SOURCE="$ADAPTER_OUTPUT"
            ADAPTER_EXIT_CODE=130
            ADAPTER_TIMED_OUT=0
            engine_adapter_extract_metadata
            cycle_record="${cycle_log%.log}.json"
            engine_adapter_write_record "$cycle_record" interrupted "Stopped by operator"
            cycle_ended_at=$(date '+%Y-%m-%dT%H:%M:%S%z')
            CYCLE_LEDGER_STATUS=interrupted
            EXIT_CODE=130
            record_cycle_usage >/dev/null
            rm -f "$ADAPTER_OUTPUT_FILE"
            ADAPTER_OUTPUT_FILE=""
        fi
        # The engine must be stopped before restoring its interrupted governance baseline.
        "$CONSENSUS_GUARD" recover || true
    fi
    python3 "$USAGE_TOOL" recover --ledger "$USAGE_FILE" --pause-file "$BUDGET_PAUSE_FILE" || log "Interrupted usage recovery failed; pending identity retained for restart"
    if [ "$CYCLE_SUPERVISOR_CLEANUP_FAILED" -eq 0 ]; then
        python3 "$PRODUCT_IDENTITY_TOOL" --root "$PROJECT_DIR" recover >/dev/null || log "Product cycle recovery failed; reservation retained for restart"
    fi
    log "=== Auto Loop Shutting Down (PID $$) ==="
    log "$(ui_message loop.stopping)"
    # Keep the inode: unlinking a held lock lets another process lock a new file.
    : > "$PID_FILE"
    save_state "$final_state"
    exit "$requested_exit"
}

snapshot_gitignore() {
    if [ "$AUTO_LOOP_PROTECT_GITIGNORE" = "0" ]; then
        echo ""
        return
    fi

    local gitignore_file="$PROJECT_DIR/.gitignore"
    local snapshot_file=""
    if [ -f "$gitignore_file" ]; then
        snapshot_file=$(mktemp)
        cp "$gitignore_file" "$snapshot_file"
    fi
    echo "$snapshot_file"
}

restore_gitignore_if_changed() {
    local snapshot_file="$1"
    if [ "$AUTO_LOOP_PROTECT_GITIGNORE" = "0" ]; then
        [ -n "$snapshot_file" ] && rm -f "$snapshot_file"
        return
    fi

    local gitignore_file="$PROJECT_DIR/.gitignore"
    local changed=0

    if [ -f "$gitignore_file" ]; then
        if [ -z "$snapshot_file" ] || [ ! -f "$snapshot_file" ]; then
            changed=1
        elif ! cmp -s "$gitignore_file" "$snapshot_file"; then
            changed=1
        fi
    else
        if [ -n "$snapshot_file" ] && [ -f "$snapshot_file" ]; then
            changed=1
        fi
    fi

    if [ "$changed" -eq 1 ]; then
        if [ -n "$snapshot_file" ] && [ -f "$snapshot_file" ]; then
            cp "$snapshot_file" "$gitignore_file"
            log_cycle "$loop_count" "GUARD" "Blocked cycle mutation of .gitignore and restored baseline"
        else
            rm -f "$gitignore_file"
            log_cycle "$loop_count" "GUARD" "Blocked cycle-created .gitignore and removed it"
        fi
    fi

    [ -n "$snapshot_file" ] && rm -f "$snapshot_file"
    return 0
}

get_file_size_bytes() {
    local target_file="$1"
    if [ ! -f "$target_file" ]; then
        echo 0
        return
    fi

    if stat -c%s "$target_file" >/dev/null 2>&1; then
        stat -c%s "$target_file"
        return
    fi

    if stat -f%z "$target_file" >/dev/null 2>&1; then
        stat -f%z "$target_file"
        return
    fi

    wc -c < "$target_file" | tr -d ' '
}

rotate_logs() {
    # Keep the latest N by write time, independent of per-process cycle numbers.
    local removed
    removed=$(python3 "$SCRIPT_DIR/rotate-logs.py" "$LOG_DIR" "$MAX_LOGS")
    if [ "$removed" -gt 0 ]; then
        log "Log rotation: removed $removed old cycle logs"
    fi

    # Rotate main log if over 10MB
    local log_size
    log_size=$(get_file_size_bytes "$LOG_DIR/auto-loop.log")
    if [ "$log_size" -gt 10485760 ]; then
        mv "$LOG_DIR/auto-loop.log" "$LOG_DIR/auto-loop.log.old"
        log "Main log rotated (was ${log_size} bytes)"
    fi
}

cleanup_accidental_root_artifacts() {
    local removed=0
    local removed_names=""
    local f base

    # Known accidental artifacts caused by malformed shell redirections in generated commands.
    for f in "$PROJECT_DIR"/=* "$PROJECT_DIR"/口径说明*; do
        [ -f "$f" ] || continue
        if [ ! -s "$f" ]; then
            rm -f "$f"
            removed=$((removed + 1))
            base=$(basename "$f")
            if [ -z "$removed_names" ]; then
                removed_names="$base"
            else
                removed_names="$removed_names, $base"
            fi
        fi
    done

    if [ "$removed" -gt 0 ]; then
        log_cycle "$loop_count" "GUARD" "Removed accidental root zero-byte artifact(s): $removed_names"
    fi
}

backup_consensus() {
    if [ -f "$CONSENSUS_FILE" ]; then
        cp "$CONSENSUS_FILE" "$CONSENSUS_FILE.bak"
    fi
}

restore_consensus() {
    if [ -f "$CONSENSUS_FILE.bak" ]; then
        cp "$CONSENSUS_FILE.bak" "$CONSENSUS_FILE"
        log "Consensus restored from backup after failed cycle"
    fi
}

validate_consensus() {
    if [ ! -s "$CONSENSUS_FILE" ]; then
        return 1
    fi
    if ! grep -q "^# Auto Company Consensus" "$CONSENSUS_FILE"; then
        return 1
    fi
    if ! grep -q "^## Next Action" "$CONSENSUS_FILE"; then
        return 1
    fi
    if ! grep -q "^## Company State" "$CONSENSUS_FILE"; then
        return 1
    fi
    return 0
}

consensus_changed_since_backup() {
    if [ ! -f "$CONSENSUS_FILE" ]; then
        return 1
    fi

    if [ ! -f "$CONSENSUS_FILE.bak" ]; then
        return 0
    fi

    if cmp -s "$CONSENSUS_FILE" "$CONSENSUS_FILE.bak"; then
        return 1
    fi

    return 0
}

resolve_engine_bin() {
    engine_adapter_resolve
}

run_engine_cycle() {
    local prompt="$1"
    center_admission_check || cleanup 1 center_admission_lost
    # The mandatory adapter creates the OS boundary and maps this context.
    export AUTO_COMPANY_ROOT="$PROJECT_DIR"
    export AUTO_COMPANY_CYCLE=1
    export AUTO_COMPANY_CYCLE_ID="$(basename "$cycle_log" .log)"
    export ACTIVE_PROJECT ACTIVE_PROJECT_PATH
    python3 "$SCRIPT_DIR/runtime_artifacts.py" --root "$PROJECT_DIR" --project "$ACTIVE_PROJECT" context \
        --cycle "$AUTO_COMPANY_CYCLE_ID" >/dev/null 2>&1 || true
    if ! python3 "$PRODUCT_IDENTITY_TOOL" --root "$PROJECT_DIR" update \
        --cycle "$AUTO_COMPANY_CYCLE_ID" --state dispatching >/dev/null; then
        cleanup 1 product_cycle_state_error
    fi
    engine_adapter_run "$prompt"
    # Observation cleanup does not classify the cycle or replace supervision.
    if [ "$CYCLE_SUPERVISOR_CLEANUP_FAILED" -eq 0 ]; then
        python3 "$SCRIPT_DIR/runtime_artifacts.py" --root "$PROJECT_DIR" finalize \
            --cycle "$AUTO_COMPANY_CYCLE_ID" --cleanup-only >/dev/null 2>&1 || true
    fi
    unset AUTO_COMPANY_CYCLE
    unset AUTO_COMPANY_CYCLE_ID
    OUTPUT="$ADAPTER_OUTPUT"
    EXIT_CODE="$ADAPTER_EXIT_CODE"
    CYCLE_TIMED_OUT="$ADAPTER_TIMED_OUT"
}

extract_cycle_metadata() {
    engine_adapter_extract_metadata
    RESULT_TEXT="$ADAPTER_RESULT"
    CYCLE_COST="${ADAPTER_COST_USD:-N/A}"
    CYCLE_SUBTYPE="$ADAPTER_SUBTYPE"
    CYCLE_TYPE="$ADAPTER_TYPE"
}

# === Setup ===

if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required for process ownership and structured usage accounting."
    ui_message python.required
    exit 1
fi

if [ "${AUTO_COMPANY_LOCK_PID:-}" != "$$" ]; then
    exec python3 "$SCRIPT_DIR/loop-lock.py" "$PID_FILE" "$0" "$@"
fi

mkdir -p "$LOG_DIR" "$PROJECT_DIR/memories"

if [ ! -x "$CONSENSUS_GUARD" ]; then
    echo "Error: Consensus guard is missing or not executable: $CONSENSUS_GUARD"
    exit 1
fi

# Clean up stale stop file from previous run
rm -f "$PROJECT_DIR/.auto-loop-stop"

# Check dependencies
set +e
"$CONSENSUS_GUARD" recover
governance_recovery_status=$?
set -e
if [ "$governance_recovery_status" -ne 0 ] && [ "$governance_recovery_status" -ne 42 ]; then
    echo "Error: interrupted-cycle governance recovery failed before startup"
    exit 1
fi
"$CONSENSUS_GUARD" init
if ! python3 "$PRODUCT_IDENTITY_TOOL" --root "$PROJECT_DIR" recover >/dev/null; then
    echo "Error: unfinished product cycle recovery failed; no new cycle was started."
    exit 1
fi

# Recover human-owned configuration before interpreting its language setting.
if ! python3 "$LOCALIZATION_TOOL" check --root "$PROJECT_DIR" >/dev/null; then
    echo "Error: language configuration is invalid; no cycle was started."
    exit 78
fi

if ! RESOLVED_ENGINE_BIN="$(resolve_engine_bin)"; then
    echo "Error: $(engine_adapter_missing_dependency_message)"
    ui_message engine.missing
    exit 1
fi

if [ ! -f "$PROMPT_FILE" ]; then
    echo "Error: PROMPT.md not found at $PROMPT_FILE"
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required for structured usage accounting."
    ui_message python.required
    exit 1
fi

# Reject invalid policy before invoking a provider and reconstruct a missing
# hard-budget pause from the durable ledger after restart.
if ! python3 "$USAGE_TOOL" check --ledger "$USAGE_FILE" --pause-file "$BUDGET_PAUSE_FILE" --result-format state >/dev/null; then
    echo "Error: usage budget preflight failed; no cycle was started."
    ui_message budget.invalid
    exit 78
fi

# Write PID file
echo $$ > "$PID_FILE"

# Initialize counters
loop_count=0
error_count=0
run_id=$(python3 -c 'import uuid; print(uuid.uuid4().hex[:12])')

# Trap signals for graceful shutdown
trap 'cleanup 0 stopped' SIGTERM SIGINT SIGHUP

wait_for_budget_resume

log "=== Auto Company Loop Started (PID $$) ==="
log "$(ui_message loop.started "$$")"
log "Project: $PROJECT_DIR"
log "$(engine_adapter_description)"
log "Engine bin: $RESOLVED_ENGINE_BIN"
engine_version=$(python3 "$SCRIPT_DIR/project_isolation.py" --engine-version "$RESOLVED_ENGINE_BIN" 2>/dev/null | head -n1 | adapter_redact || true)
case "$RESOLVED_ENGINE_BIN" in
    /mnt/c/*)
        log "Warning: $ENGINE binary resolves to a Windows-mounted path. Prefer a WSL-local runtime for stability."
        ;;
esac
if [ -n "$engine_version" ]; then
    case "$ENGINE" in
        claude) log "Claude version: $engine_version" ;;
        codex) log "Codex version: $engine_version" ;;
        *) log "Engine version: $engine_version" ;;
    esac
fi
log "Interval: ${LOOP_INTERVAL}s | Timeout: ${CYCLE_TIMEOUT_SECONDS}s | Breaker: ${MAX_CONSECUTIVE_ERRORS} errors"

# === Main Loop ===

while true; do
    center_admission_check || cleanup 1 center_admission_lost
    # Check for stop request
    if check_stop_requested; then
        log "Stop requested. Shutting down gracefully."
        cleanup
    fi

    wait_while_paused
    wait_for_budget_resume

    next_cycle=$((loop_count + 1))
    set +e
    "$CONSENSUS_GUARD" preflight "$next_cycle"
    preflight_status=$?
    set -e
    if [ "$preflight_status" -eq 41 ]; then
        loop_sleep "$LOOP_INTERVAL"
        continue
    fi
    if [ "$preflight_status" -eq 42 ]; then
        wait_while_paused
        continue
    fi
    if [ "$preflight_status" -ne 0 ]; then
        log_cycle "$next_cycle" "FAIL" "Consensus preflight failed with exit code $preflight_status"
        loop_sleep "$LOOP_INTERVAL"
        continue
    fi

    # Consume human selection on every cycle; never source the local file as shell.
    if ! ACTIVE_PROJECT_PATH=$(python3 "$PROJECT_CONTEXT_TOOL" active --root "$PROJECT_DIR" --optional); then
        log_cycle "$next_cycle" "FAIL" "Invalid ACTIVE_PROJECT configuration; engine invocation blocked"
        printf 'PAUSE_REASON=active_project_invalid\n' > "$PAUSE_FLAG"
        wait_while_paused
        continue
    fi
    ACTIVE_PROJECT=""
    PROJECT_CONTEXT_SOURCE="human selection"
    if [ -n "$ACTIVE_PROJECT_PATH" ]; then
        ACTIVE_PROJECT="projects/${ACTIVE_PROJECT_PATH##*/}"
    else
        # Creation links exploration to a product without editing human selection.
        if ! ACTIVE_PROJECT=$(python3 "$PRODUCT_IDENTITY_TOOL" --root "$PROJECT_DIR" continuation) ||
           { [ -n "$ACTIVE_PROJECT" ] && ! ACTIVE_PROJECT_PATH=$(python3 "$PROJECT_CONTEXT_TOOL" validate --root "$PROJECT_DIR" --project "$ACTIVE_PROJECT"); }; then
            log_cycle "$next_cycle" "FAIL" "Registered product continuation is invalid; engine invocation blocked"
            printf 'PAUSE_REASON=product_continuation_invalid\n' > "$PAUSE_FLAG"
            wait_while_paused
            continue
        fi
        PROJECT_CONTEXT_SOURCE="registered exploration continuation"
    fi

    # Pin once for the whole product, including later iterations and restarts.
    if ! python3 "$LOCALIZATION_TOOL" start --root "$PROJECT_DIR" >/dev/null ||
       ! AUTO_COMPANY_LANGUAGE=$(python3 "$LOCALIZATION_TOOL" check --root "$PROJECT_DIR") ||
       ! PROMPT=$(python3 "$LOCALIZATION_TOOL" prompt --root "$PROJECT_DIR"); then
        log_cycle "$next_cycle" "FAIL" "Invalid language configuration or prompt; engine invocation blocked"
        printf 'PAUSE_REASON=language_invalid\n' > "$PAUSE_FLAG"
        wait_while_paused
        continue
    fi
    export AUTO_COMPANY_LANGUAGE

    loop_count=$next_cycle
    cycle_started_at=$(date '+%Y-%m-%dT%H:%M:%S%z')

    # Log rotation
    rotate_logs

    # Capture the full consensus and protected human section before cycle.
    "$CONSENSUS_GUARD" begin "$loop_count"
    gitignore_snapshot=$(snapshot_gitignore)

    # Build prompt with consensus pre-injected
    CONSENSUS=$(cat "$CONSENSUS_FILE" 2>/dev/null || echo "No consensus file found. This is the very first cycle.")
    # Optional observation instructions must never block the existing cycle.
    REPORT_INSTRUCTIONS=$(python3 "$SCRIPT_DIR/cycle_reports.py" prompt 2>/dev/null) || REPORT_INSTRUCTIONS=""
    ARTIFACT_INSTRUCTIONS=$(python3 "$SCRIPT_DIR/runtime_artifacts.py" prompt 2>/dev/null) || ARTIFACT_INSTRUCTIONS=""
    # All preflight checks passed. Allocate identity, number and pending record
    # atomically immediately before invoking the provider; logs never count work.
    if ! cycle_reservation=$(python3 "$PRODUCT_IDENTITY_TOOL" --root "$PROJECT_DIR" --project "$ACTIVE_PROJECT" reserve \
        --attempt "${run_id}-${loop_count}" --run-cycle "$loop_count" --engine "$ENGINE" --model "$MODEL_LABEL" --shell); then
        log_cycle "$loop_count" "FAIL" "Cannot reserve durable product cycle identity"
        cleanup 1 product_cycle_state_error
    fi
    read -r CURRENT_PRODUCT_CYCLE_ID PRODUCT_ID PRODUCT_CYCLE_NUMBER PRODUCT_IDENTITY_KIND <<< "$cycle_reservation"
    cycle_log="$LOG_DIR/${CURRENT_PRODUCT_CYCLE_ID}.log"
    export AUTO_COMPANY_STABLE_PRODUCT_ID="$PRODUCT_ID"
    export AUTO_COMPANY_PRODUCT_CYCLE_NUMBER="$PRODUCT_CYCLE_NUMBER"
    log_cycle "$loop_count" "START" "Beginning $PRODUCT_IDENTITY_KIND cycle #$PRODUCT_CYCLE_NUMBER"
    save_state "running"
    FULL_PROMPT="$PROMPT

---

## Runtime Guardrails (must follow)

1. Early in the cycle, create or update \`memories/consensus.md\` with the required section skeleton.
2. If work scope is large, persist partial decisions to \`memories/consensus.md\` before deep dives.
3. Prefer shipping one completed milestone over broad parallel exploration.
4. Never write files via shell heredoc (\`cat <<EOF\`). Use \`apply_patch\` for file creates/edits.
5. Never execute shell lines that begin with \`>\` or \`>=\`; treat them as text and keep them inside markdown/files.
6. Preserve the entire \`## Human Overrides\` section byte-for-byte. Never delete, edit, reorder, or reformat it.
7. Create products only through \`make project-new NAME=<slug>\`. Never add a product remote or push outside the explicit human-run \`project-publish\` gate.
8. Human-owned selection is \`$PROJECT_DIR/.auto-company.local\`; never create, edit, or select it during a cycle. Creating a candidate does not change the selection.
9. Preserve existing P1 items and their continuation text in \`## Priority Issues\` exactly. You may add unresolved P1 items as \`- [ ] P1: description\`; never add a resolved P1 or close, delete, rewrite, or downgrade an existing P1. Only a human editing after the loop stops and interrupted recovery completes may change the baseline.

## Authoritative Project Context

- Framework working directory: \`$PROJECT_DIR\`
- Consensus baton: \`$CONSENSUS_FILE\`
- Bound ACTIVE_PROJECT: \`${ACTIVE_PROJECT:-none (framework exploration)}\` (source: $PROJECT_CONTEXT_SOURCE)
- Selected product repository: \`${ACTIVE_PROJECT_PATH:-none}\`
- If a project is selected, perform all product source work there and use \`git -C \"$ACTIVE_PROJECT_PATH\"\` for product Git operations. Keep product commits and remotes out of the framework repository.
- The isolated framework view contains this product and its company coordination files. Other products, host files and host-local services are unavailable.

$REPORT_INSTRUCTIONS

$ARTIFACT_INSTRUCTIONS

---

## Current Consensus (pre-loaded, do NOT re-read this file)

$CONSENSUS

---

This is $PRODUCT_IDENTITY_KIND cycle #$PRODUCT_CYCLE_NUMBER (process-local attempt #$loop_count).
The stable runtime identity is $PRODUCT_ID. Process restarts and model changes do not restart product discovery.
Resume the work and phase in the current consensus. First-exploration rules apply only when this is exploration cycle #1 and no earlier decision is recorded. Act decisively."

    # Run selected engine in headless mode with per-cycle timeout
    if ! python3 "$USAGE_TOOL" begin --ledger "$USAGE_FILE" \
        --cycle-id "$(basename "$cycle_log" .log)" --cycle-number "$loop_count" \
        --started-at "$cycle_started_at" --engine "$ENGINE" --model "$MODEL_LABEL"; then
        log_cycle "$loop_count" "USAGE" "Could not reserve durable usage identity; refusing to invoke the provider"
        cleanup 1 usage_accounting_error
    fi
    run_engine_cycle "$FULL_PROMPT"

    if [ "$CYCLE_SUPERVISOR_CLEANUP_FAILED" -ne 0 ]; then
        log_cycle "$loop_count" "FAIL" "Process-tree cleanup could not be confirmed for cycle PGID ${CYCLE_SUPERVISOR_LAST_PGID}; refusing to start another cycle"
        cleanup 1 process_cleanup_failed
    fi

    # Save full output to cycle log
    echo "$OUTPUT" > "$cycle_log"

    # Clean up known malformed-redirection artifacts created by bad generated shell commands.
    cleanup_accidental_root_artifacts
    restore_gitignore_if_changed "$gitignore_snapshot"

    # Extract result fields for status classification
    extract_cycle_metadata
    cycle_ended_at=$(date '+%Y-%m-%dT%H:%M:%S%z')

    # A cycle may fail for other reasons, but it may never alter human instructions.
    set +e
    "$CONSENSUS_GUARD" verify "$loop_count"
    consensus_guard_status=$?
    set -e

    cycle_failed_reason=""
    cycle_soft_timeout=0
    governance_pause_required=0
    if [ "$consensus_guard_status" -eq 42 ]; then
        cycle_failed_reason="Human Overrides protection violation"
        if [ "$(read_pause_reason "$PAUSE_FLAG" "")" = "active_project_mutated" ]; then
            cycle_failed_reason="Human project selection protection violation"
        elif [ "$(read_pause_reason "$PAUSE_FLAG" "")" = "priority_issue_mutated" ]; then
            cycle_failed_reason="Priority Issues protection violation"
        fi
        governance_pause_required=1
    elif [ "$consensus_guard_status" -ne 0 ]; then
        cycle_failed_reason="Consensus guard failed with exit code $consensus_guard_status"
    elif [ "$CYCLE_TIMED_OUT" -eq 1 ]; then
        if validate_consensus && consensus_changed_since_backup; then
            cycle_soft_timeout=1
        else
            cycle_failed_reason="Timed out after ${CYCLE_TIMEOUT_SECONDS}s"
        fi
    elif [ "$EXIT_CODE" -ne 0 ]; then
        cycle_failed_reason="Exit code $EXIT_CODE"
    elif [ "$ADAPTER_STATUS" != "success" ]; then
        cycle_failed_reason="Adapter reported $ADAPTER_STATUS ($CYCLE_SUBTYPE)"
    elif ! validate_consensus; then
        cycle_failed_reason="consensus.md validation failed after cycle"
    fi

    if [ "$cycle_soft_timeout" -eq 1 ] || [ -z "$cycle_failed_reason" ]; then
        set +e
        consensus_snapshot=$("$CONSENSUS_GUARD" snapshot "$loop_count")
        snapshot_status=$?
        set -e
        if [ "$snapshot_status" -ne 0 ]; then
            cycle_soft_timeout=0
            cycle_failed_reason="consensus snapshot failed after otherwise successful cycle"
        else
            log_cycle "$loop_count" "SNAPSHOT" "Saved ${consensus_snapshot#$PROJECT_DIR/}"
        fi
    fi

    if [ "$cycle_soft_timeout" -eq 1 ]; then
        cycle_outcome="soft_timeout"
    elif [ -z "$cycle_failed_reason" ]; then
        cycle_outcome="success"
    else
        cycle_outcome="failure"
    fi
    cycle_record="${cycle_log%.log}.json"
    engine_adapter_write_record "$cycle_record" "$cycle_outcome" "$cycle_failed_reason"

    cycle_is_failure=0
    cycle_has_usage_limit=0
    if [ "$cycle_soft_timeout" -eq 1 ]; then
        CYCLE_LEDGER_STATUS="completed_with_timeout"
        log_cycle "$loop_count" "OK" "Timed out after ${CYCLE_TIMEOUT_SECONDS}s but consensus was updated; keeping progress (cost: ${CYCLE_COST}, subtype: ${CYCLE_SUBTYPE})"
        if [ -n "$RESULT_TEXT" ]; then
            log_cycle "$loop_count" "SUMMARY" "$(echo "$RESULT_TEXT" | head -c 300)"
        fi
        error_count=0
    elif [ -z "$cycle_failed_reason" ]; then
        CYCLE_LEDGER_STATUS="completed"
        log_cycle "$loop_count" "OK" "Completed (cost: ${CYCLE_COST}, subtype: ${CYCLE_SUBTYPE})"
        if [ -n "$RESULT_TEXT" ]; then
            log_cycle "$loop_count" "SUMMARY" "$(echo "$RESULT_TEXT" | head -c 300)"
        fi
        error_count=0
    else
        CYCLE_LEDGER_STATUS="failed"
        cycle_is_failure=1
        error_count=$((error_count + 1))
        log_cycle "$loop_count" "FAIL" "$cycle_failed_reason (cost: ${CYCLE_COST}, subtype: ${CYCLE_SUBTYPE}, errors: $error_count/$MAX_CONSECUTIVE_ERRORS)"

        # Restore consensus on hard failure
        restore_consensus

        if check_usage_limit "$OUTPUT"; then
            cycle_has_usage_limit=1
        fi
    fi

    # Close after successful validation or failure rollback, before any budget pause.
    if ! "$CONSENSUS_GUARD" close "$loop_count"; then
        log_cycle "$loop_count" "FAIL" "Cannot close governance baseline; refusing another cycle"
        cleanup 1 governance_recovery_failed
    fi

    budget_state=$(record_cycle_usage)
    if ! python3 "$PRODUCT_IDENTITY_TOOL" --root "$PROJECT_DIR" update \
        --cycle "$CURRENT_PRODUCT_CYCLE_ID" --state "$CYCLE_LEDGER_STATUS" --reason "$cycle_failed_reason" >/dev/null; then
        log_cycle "$loop_count" "FAIL" "Cannot close the durable product cycle; refusing another cycle"
        cleanup 1 product_cycle_state_error
    fi
    # Seal the AI result before optional media: stopping a slow capture must not
    # discard output or relabel an already completed provider invocation.
    finalize_cycle_media
    case "$budget_state" in
        warning)
            log_cycle "$loop_count" "BUDGET" "Warning threshold reached; next cycle remains enabled"
            ;;
        hard_limit|unverifiable)
            log_cycle "$loop_count" "BUDGET" "Budget state $budget_state after cycle close; pausing before next cycle"
            wait_for_budget_resume
            ;;
        indeterminate)
            log_cycle "$loop_count" "USAGE" "Budget cannot be fully evaluated because configured usage is unavailable"
            ;;
        record_error)
            log_cycle "$loop_count" "USAGE" "Structured usage record failed; inspect usage tooling before trusting budget enforcement"
            if printf '{"reason":"usage_record_error","cycle_id":"%s"}\n' "$(basename "$cycle_log" .log)" > "$BUDGET_PAUSE_FILE"; then
                wait_for_budget_resume
            else
                log_cycle "$loop_count" "USAGE" "Cannot persist the safety pause; holding this process to prevent an unmetered next cycle"
                while true; do
                    save_state "paused" "usage_accounting_error"
                    if check_stop_requested; then
                        cleanup
                    fi
                    loop_sleep "$BUDGET_PAUSE_POLL_SECONDS"
                done
            fi
            ;;
    esac

    if [ "$governance_pause_required" -eq 1 ]; then
        wait_while_paused
        continue
    fi

    if [ "$cycle_is_failure" -eq 1 ]; then
        if [ "$cycle_has_usage_limit" -eq 1 ]; then
            log_cycle "$loop_count" "LIMIT" "API usage limit detected. Waiting ${LIMIT_WAIT_SECONDS}s..."
            save_state "waiting_limit"
            loop_sleep "$LIMIT_WAIT_SECONDS"
            error_count=0
            continue
        fi

        if [ "$error_count" -ge "$MAX_CONSECUTIVE_ERRORS" ]; then
            log_cycle "$loop_count" "BREAKER" "Circuit breaker tripped! Cooling down ${COOLDOWN_SECONDS}s..."
            save_state "circuit_break"
            loop_sleep "$COOLDOWN_SECONDS"
            error_count=0
            log "Circuit breaker reset. Resuming..."
        fi
    fi

    save_state "idle"
    log_cycle "$loop_count" "WAIT" "Sleeping ${LOOP_INTERVAL}s before next cycle..."
    loop_sleep "$LOOP_INTERVAL"
done

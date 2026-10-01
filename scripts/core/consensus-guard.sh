#!/bin/bash
# Safety boundary for the cross-cycle consensus baton.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="${AUTO_COMPANY_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
MEMORY_DIR="$FRAMEWORK_DIR/memories"
CONSENSUS_FILE="$MEMORY_DIR/consensus.md"
TEMPLATE_FILE="$MEMORY_DIR/consensus.template.md"
BACKUP_FILE="$CONSENSUS_FILE.bak"
SNAPSHOT_DIR="$MEMORY_DIR/snapshots"
INITIALIZED_FILE="$MEMORY_DIR/.consensus-initialized"
PENDING_FILE="$MEMORY_DIR/.consensus-cycle-pending"
LOG_DIR="$FRAMEWORK_DIR/logs"
LOG_FILE="$LOG_DIR/auto-loop.log"
PAUSE_FLAG="$FRAMEWORK_DIR/.auto-loop-paused"
STATE_FILE="$FRAMEWORK_DIR/.auto-loop-state"
FORMAT_TOOL="$SCRIPT_DIR/consensus-format.py"
PROJECT_CONTEXT_TOOL="$SCRIPT_DIR/project-context.py"

die() {
    echo "Error: $*" >&2
    exit 1
}

timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

log_guard() {
    local cycle="$1" level="$2" message="$3"
    # Diagnostics must never prevent restoring a rejected or interrupted cycle.
    if ! { mkdir -p "$LOG_DIR" && printf '[%s] Cycle #%s [%s] %s\n' "$(timestamp)" "$cycle" "$level" "$message" >> "$LOG_FILE"; }; then
        printf 'Error: cannot append consensus guard log: %s\n' "$LOG_FILE" >&2 || true
    fi
    printf 'Cycle #%s [%s] %s\n' "$cycle" "$level" "$message" >&2 || true
}

write_guard_state() {
    local cycle="$1" status="$2" pause_reason="$3" error="$4" state_tmp
    state_tmp="$(mktemp "$FRAMEWORK_DIR/.auto-loop-state.XXXXXX")"
    {
        printf 'LOOP_COUNT=%s\n' "$cycle"
        printf 'LAST_RUN=%s\n' "$(timestamp)"
        printf 'STATUS=%s\n' "$status"
        printf 'PAUSE_REASON=%s\n' "$pause_reason"
        printf 'LAST_ERROR=%s\n' "$error"
    } > "$state_tmp"
    mv "$state_tmp" "$STATE_FILE"
}

write_pause_flag() {
    printf 'PAUSE_REASON=%s\n' "$1" > "$PAUSE_FLAG"
}

init_consensus() {
    mkdir -p "$MEMORY_DIR"
    if [ ! -e "$CONSENSUS_FILE" ] && [ ! -L "$CONSENSUS_FILE" ]; then
        if [ -e "$INITIALIZED_FILE" ] || [ -e "$BACKUP_FILE" ] || [ -e "$STATE_FILE" ] || [ -e "$SNAPSHOT_DIR" ] || [ -e "$MEMORY_DIR/resets" ]; then
            echo "Error: existing consensus is missing; restore it explicitly before resuming" >&2
            return 42
        fi
        [ -f "$TEMPLATE_FILE" ] || die "consensus template not found: $TEMPLATE_FILE"
        cp "$TEMPLATE_FILE" "$CONSENSUS_FILE"
    fi
    touch "$INITIALIZED_FILE"
}

has_unresolved_p1() {
    python3 "$FORMAT_TOOL" p1 "$1"
}

preflight() {
    local cycle="$1"
    recover_pending || return $?
    if ! init_consensus || ! python3 "$FORMAT_TOOL" validate "$CONSENSUS_FILE"; then
        local message="HIGH PRIORITY: consensus must contain exactly one canonical Human Overrides and Priority Issues section"
        log_guard "$cycle" "CRITICAL" "$message"
        write_pause_flag "human_override_invalid"
        write_guard_state "$cycle" "paused" "human_override_invalid" "$message"
        return 42
    fi
    if has_unresolved_p1 "$CONSENSUS_FILE"; then
        local message="Unresolved P1 blocks this cycle before engine invocation"
        log_guard "$cycle" "P1_BLOCK" "$message"
        write_guard_state "$cycle" "paused" "unresolved_p1" "$message"
        return 41
    fi
}

begin_cycle() {
    local cycle="$1" pending_tmp
    preflight "$cycle" || return $?
    cp "$CONSENSUS_FILE" "$BACKUP_FILE"
    python3 "$PROJECT_CONTEXT_TOOL" capture --root "$FRAMEWORK_DIR"
    pending_tmp="$(mktemp "$MEMORY_DIR/.consensus-pending.XXXXXX")"
    printf '%s\n' "$cycle" > "$pending_tmp"
    mv "$pending_tmp" "$PENDING_FILE"
    log_guard "$cycle" "GUARD" "Consensus baseline captured"
}

recover_pending() {
    [ -e "$PENDING_FILE" ] || [ -L "$PENDING_FILE" ] || return 0
    local cycle="" selection_status=0 recovery_failed=0
    if [ -f "$PENDING_FILE" ] && [ ! -L "$PENDING_FILE" ]; then
        IFS= read -r cycle < "$PENDING_FILE" || true
    fi
    write_pause_flag "interrupted_cycle"
    if ! [[ "$cycle" =~ ^[0-9]+$ ]]; then
        local message="HIGH PRIORITY: interrupted-cycle marker is invalid; retain baselines and repair governance before resuming"
        log_guard 0 "CRITICAL" "$message"
        write_guard_state 0 "paused" "interrupted_cycle" "$message"
        return 42
    fi

    # A killed cycle may have unfinished product side effects even if human bytes match.
    # Persist the pause before recovery, and remove the marker only after both restores succeed.
    python3 "$PROJECT_CONTEXT_TOOL" verify --root "$FRAMEWORK_DIR" || selection_status=$?
    if [ "$selection_status" -ne 0 ] && [ "$selection_status" -ne 42 ]; then
        recovery_failed=1
    fi
    python3 "$FORMAT_TOOL" restore "$CONSENSUS_FILE" "$BACKUP_FILE" || recovery_failed=1
    if [ "$recovery_failed" -ne 0 ]; then
        local message="HIGH PRIORITY: interrupted-cycle governance recovery failed; pending marker and available baselines retained"
        log_guard "$cycle" "CRITICAL" "$message"
        write_guard_state "$cycle" "paused" "interrupted_cycle" "$message"
        return 42
    fi
    rm -f "$PENDING_FILE"
    local message="Interrupted cycle restored pre-cycle consensus and human project configuration; review product side effects before resuming"
    log_guard "$cycle" "INTERRUPTED" "$message"
    write_guard_state "$cycle" "paused" "interrupted_cycle" "$message"
    return 42
}

close_cycle() {
    local cycle="$1"
    [ -e "$PENDING_FILE" ] || [ -L "$PENDING_FILE" ] || return 0
    verify_cycle "$cycle" || return $?
    rm -f "$PENDING_FILE"
}

human_overrides_unchanged() {
    python3 "$FORMAT_TOOL" unchanged "$CONSENSUS_FILE" "$BACKUP_FILE"
}

archive_rejected_consensus() {
    local cycle="$1" archive
    if archive="$(python3 "$FORMAT_TOOL" archive-rejected "$CONSENSUS_FILE" "$cycle")"; then
        log_guard "$cycle" "REJECTED" "Saved rejected consensus for human review: ${archive#$FRAMEWORK_DIR/}"
    else
        log_guard "$cycle" "CRITICAL" "Could not save rejected consensus; proceeding with baseline restoration"
    fi
}

snapshot_consensus() {
    local cycle="$1" snapshot
    verify_cycle "$cycle" || return $?
    mkdir -p "$SNAPSHOT_DIR"
    snapshot="$SNAPSHOT_DIR/consensus-cycle-$(printf '%04d' "$cycle")-$(date -u '+%Y%m%dT%H%M%SZ')-$$.md"
    cp "$CONSENSUS_FILE" "$snapshot"
    printf '%s\n' "$snapshot"
}

verify_cycle() {
    local cycle="$1" selection_status=0
    python3 "$PROJECT_CONTEXT_TOOL" verify --root "$FRAMEWORK_DIR" || selection_status=$?
    if ! human_overrides_unchanged; then
        write_pause_flag "human_override_mutated"
        archive_rejected_consensus "$cycle"
        if ! python3 "$FORMAT_TOOL" restore "$CONSENSUS_FILE" "$BACKUP_FILE"; then
            local message="HIGH PRIORITY: consensus restoration failed; inspect baseline at $BACKUP_FILE and repair consensus before resuming"
            log_guard "$cycle" "CRITICAL" "$message"
            write_guard_state "$cycle" "paused" "human_override_mutated" "$message"
            return 42
        fi
        local message="HIGH PRIORITY: Cycle changed or deleted Human Overrides; restored pre-cycle consensus and paused subsequent cycles"
        log_guard "$cycle" "CRITICAL" "$message"
        write_pause_flag "human_override_mutated"
        write_guard_state "$cycle" "paused" "human_override_mutated" "$message"
        return 42
    fi
    if ! python3 "$FORMAT_TOOL" p1-preserved "$CONSENSUS_FILE" "$BACKUP_FILE"; then
        write_pause_flag "priority_issue_mutated"
        archive_rejected_consensus "$cycle"
        if ! python3 "$FORMAT_TOOL" restore "$CONSENSUS_FILE" "$BACKUP_FILE"; then
            local message="HIGH PRIORITY: P1 protection restoration failed; inspect baseline at $BACKUP_FILE and repair consensus before resuming"
            log_guard "$cycle" "CRITICAL" "$message"
            write_guard_state "$cycle" "paused" "priority_issue_mutated" "$message"
            return 42
        fi
        local message="HIGH PRIORITY: Cycle changed or deleted an existing P1 or added a resolved P1; restored pre-cycle consensus and paused subsequent cycles"
        log_guard "$cycle" "CRITICAL" "$message"
        write_guard_state "$cycle" "paused" "priority_issue_mutated" "$message"
        return 42
    fi
    if [ "$selection_status" -ne 0 ]; then
        local message="HIGH PRIORITY: Cycle changed human-owned project configuration or its baseline is unavailable; review configuration and resume explicitly"
        log_guard "$cycle" "CRITICAL" "$message"
        write_pause_flag "active_project_mutated"
        write_guard_state "$cycle" "paused" "active_project_mutated" "$message"
        return 42
    fi
}

reset_consensus() {
    [ "$#" -eq 2 ] && [ "$1" = "--confirm" ] && [ "$2" = "RESET" ] || die "reset requires --confirm RESET"
    [ "${AUTO_COMPANY_CYCLE:-0}" != "1" ] || die "consensus reset is human-only"
    local loop_pid="" backup
    if [ -f "$FRAMEWORK_DIR/.auto-loop.pid" ]; then
        IFS= read -r loop_pid < "$FRAMEWORK_DIR/.auto-loop.pid" || true
        if [[ "$loop_pid" =~ ^[0-9]+$ ]] && kill -0 "$loop_pid" 2>/dev/null; then
            die "stop the running loop before resetting consensus"
        fi
    fi
    backup="$(python3 "$FORMAT_TOOL" reset "$CONSENSUS_FILE" "$TEMPLATE_FILE")"
    echo "Business consensus reset; Human Overrides, Priority Issues, and pause flags are preserved."
    echo "Previous consensus remains recoverable at: $backup"
}

finish_cycle() {
    local cycle="$1"
    verify_cycle "$cycle"
    local snapshot
    snapshot="$(snapshot_consensus "$cycle")"
    close_cycle "$cycle"
    log_guard "$cycle" "SNAPSHOT" "Saved successful consensus snapshot: ${snapshot#$FRAMEWORK_DIR/}"
}

command="${1:-}"
[ -n "$command" ] || die "usage: consensus-guard.sh <init|preflight|begin|verify|close|recover|finish|snapshot|reset> [cycle|--confirm RESET]"
shift

case "$command" in
    init)
        init_consensus
        ;;
    preflight)
        preflight "${1:-0}"
        ;;
    begin)
        begin_cycle "${1:-0}"
        ;;
    verify)
        verify_cycle "${1:-0}"
        ;;
    close)
        close_cycle "${1:-0}"
        ;;
    recover)
        recover_pending
        ;;
    finish)
        finish_cycle "${1:-0}"
        ;;
    snapshot)
        snapshot_consensus "${1:-0}"
        ;;
    reset)
        reset_consensus "$@"
        ;;
    *)
        die "unknown command: $command"
        ;;
esac

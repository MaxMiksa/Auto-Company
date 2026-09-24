#!/bin/bash
set -euo pipefail

TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_ROOT="$(cd "$TEST_DIR/.." && pwd)"
TMP_ROOT="$(mktemp -d)"
FRAMEWORK="$TMP_ROOT/framework"
LOOP_PID=""
TEST_WATCHDOG_PID=""
TEST_TIMEOUT_SECONDS="${TEST_TIMEOUT_SECONDS:-45}"

dump_diagnostics() {
    [ ! -f "$TMP_ROOT/loop.out" ] || sed -n '1,200p' "$TMP_ROOT/loop.out" >&2
    for diagnostic in "$FRAMEWORK"/logs/* "$FRAMEWORK"/.auto-loop-state; do
        [ ! -f "$diagnostic" ] || {
            printf '%s\n' "--- $diagnostic" >&2
            sed -n '1,200p' "$diagnostic" >&2
        }
    done
}

wait_for_pid_exit() {
    local target_pid="$1" max_checks="${2:-200}" waited=0
    while kill -0 "$target_pid" 2>/dev/null; do
        [ "$waited" -lt "$max_checks" ] || return 1
        sleep 0.05
        waited=$((waited + 1))
    done
}

cleanup_test() {
    if [ -n "$TEST_WATCHDOG_PID" ]; then
        kill -TERM "$TEST_WATCHDOG_PID" 2>/dev/null || true
        wait "$TEST_WATCHDOG_PID" 2>/dev/null || true
        TEST_WATCHDOG_PID=""
    fi
    if [ -n "$LOOP_PID" ] && kill -0 "$LOOP_PID" 2>/dev/null; then
        kill -TERM "$LOOP_PID" 2>/dev/null || true
        if ! wait_for_pid_exit "$LOOP_PID"; then
            dump_diagnostics
            kill -KILL "$LOOP_PID" 2>/dev/null || true
            if ! wait_for_pid_exit "$LOOP_PID" 40; then
                printf 'FAIL: auto-loop survived TERM and KILL during test cleanup (PID %s)\n' "$LOOP_PID" >&2
                LOOP_PID=""
                rm -rf -- "$TMP_ROOT"
                return
            fi
        fi
        wait "$LOOP_PID" 2>/dev/null || true
    fi
    rm -rf -- "$TMP_ROOT"
}
trap cleanup_test EXIT

handle_test_timeout() {
    trap - TERM EXIT
    printf 'FAIL: auto-loop integration test exceeded %s seconds\n' "$TEST_TIMEOUT_SECONDS" >&2
    dump_diagnostics
    cleanup_test
    exit 124
}
trap handle_test_timeout TERM

(
    sleep "$TEST_TIMEOUT_SECONDS"
    kill -TERM "$$" 2>/dev/null || true
) &
TEST_WATCHDOG_PID=$!

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

wait_for_file() {
    local target="$1" waited=0
    while [ ! -s "$target" ]; do
        if [ "$waited" -ge 400 ]; then
            dump_diagnostics
            fail "timed out waiting for $target"
        fi
        if [ -n "$LOOP_PID" ] && ! kill -0 "$LOOP_PID" 2>/dev/null; then
            dump_diagnostics
            fail "auto-loop exited before producing $target"
        fi
        sleep 0.05
        waited=$((waited + 1))
    done
}

wait_for_contains() {
    local target="$1" expected="$2" waited=0
    while ! grep -Fq "$expected" "$target" 2>/dev/null; do
        if [ "$waited" -ge 400 ]; then
            dump_diagnostics
            fail "timed out waiting for '$expected' in $target"
        fi
        if [ -n "$LOOP_PID" ] && ! kill -0 "$LOOP_PID" 2>/dev/null; then
            dump_diagnostics
            fail "auto-loop exited before writing '$expected' to $target"
        fi
        sleep 0.05
        waited=$((waited + 1))
    done
}

mkdir -p "$FRAMEWORK/scripts/core" "$FRAMEWORK/memories" "$FRAMEWORK/logs" "$FRAMEWORK/i18n"
cp "$SOURCE_ROOT/scripts/core/auto-loop.sh" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/rotate-logs.py" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/consensus-guard.sh" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/consensus-format.py" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/project-context.py" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/product_identity.py" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/localization.py" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/ui-messages.sh" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/i18n/messages.json" "$FRAMEWORK/i18n/"
cp "$SOURCE_ROOT/scripts/core/engine-adapters.sh" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/engine-metadata.py" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/openai-compatible-agent.py" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/process-supervisor.sh" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/process-supervisor-linux.py" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/loop-lock.py" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/installation_state.py" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/usage.py" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/scripts/core/usage_lib.py" "$FRAMEWORK/scripts/core/"
cp "$SOURCE_ROOT/memories/consensus.template.md" "$FRAMEWORK/memories/"
cp "$SOURCE_ROOT/.gitignore" "$FRAMEWORK/"
printf '# Integration prompt\n\nUpdate consensus safely.\n' > "$FRAMEWORK/PROMPT.md"

AUTO_COMPANY_ROOT="$FRAMEWORK" "$FRAMEWORK/scripts/core/consensus-guard.sh" init
sed -i 's/- (none)/- Keep billing disabled./' "$FRAMEWORK/memories/consensus.md"

FAKE_CLI="$TMP_ROOT/fake-claude"
printf '%s\n' \
    '#!/bin/bash' \
    'set -euo pipefail' \
    'if [ "${1:-}" = "--version" ]; then printf "fake-claude 1.0\\n"; exit 0; fi' \
    'sed -i "s/- Keep billing disabled\./- Enable billing now./" "$FAKE_PROJECT_DIR/memories/consensus.md"' \
    'printf '\''{"result":"fake cycle","total_cost_usd":0.5,"usage":{"input_tokens":7,"output_tokens":5}}\n'\''' \
    > "$FAKE_CLI"
chmod +x "$FAKE_CLI"

FAKE_PROJECT_DIR="$FRAMEWORK" \
ENGINE=claude \
CLAUDE_BIN="$FAKE_CLI" \
CLAUDE_PERMISSION_MODE=default \
LOOP_INTERVAL=0 \
CYCLE_TIMEOUT_SECONDS=10 \
CYCLE_TERM_GRACE_SECONDS=1 \
CYCLE_KILL_WAIT_SECONDS=1 \
"$FRAMEWORK/scripts/core/auto-loop.sh" > "$TMP_ROOT/loop.out" 2>&1 &
LOOP_PID=$!

wait_for_file "$FRAMEWORK/.auto-loop-paused"
wait_for_file "$FRAMEWORK/logs/usage.jsonl"

wait_for_contains "$FRAMEWORK/.auto-loop-paused" 'PAUSE_REASON=human_override_mutated'
wait_for_contains "$FRAMEWORK/.auto-loop-state" 'STATUS=paused'
wait_for_contains "$FRAMEWORK/.auto-loop-state" 'PAUSE_REASON=human_override_mutated'

cycle_record=$(find "$FRAMEWORK/logs" -maxdepth 1 -type f -name 'cycle-*.json' | head -n1)
[ -n "$cycle_record" ] || fail "cycle sidecar missing"
python3 -c '
import json, pathlib, sys
sidecar = json.loads(pathlib.Path(sys.argv[1]).read_text())
ledger = json.loads(pathlib.Path(sys.argv[2]).read_text().splitlines()[-1])
assert sidecar["cycle_outcome"] == "failure", sidecar
assert sidecar["failure_reason"] == "Human Overrides protection violation", sidecar
assert ledger["source"]["adapter"] == "cycle_sidecar_v1", ledger
assert ledger["usage"]["total_tokens"] == 12, ledger
assert ledger["cost_usd"] == 0.5, ledger
' "$cycle_record" "$FRAMEWORK/logs/usage.jsonl"

touch "$FRAMEWORK/.auto-loop-stop"
if ! wait_for_pid_exit "$LOOP_PID"; then
    dump_diagnostics
    kill -KILL "$LOOP_PID" 2>/dev/null || true
    if wait_for_pid_exit "$LOOP_PID" 40; then
        wait "$LOOP_PID" 2>/dev/null || true
    else
        printf 'FAIL: auto-loop survived KILL after stop timeout (PID %s)\n' "$LOOP_PID" >&2
    fi
    LOOP_PID=""
    fail "auto-loop did not exit within 10 seconds after stop request"
fi
wait "$LOOP_PID"
LOOP_PID=""

printf 'PASS: auto-loop records sidecar and usage before governance pause\n'

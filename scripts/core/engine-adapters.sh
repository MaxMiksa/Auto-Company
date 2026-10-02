#!/bin/bash
# Engine adapter boundary for auto-loop.sh.
#
# Public contract:
#   engine_adapter_validate
#   engine_adapter_resolve
#   engine_adapter_run PROMPT
#   engine_adapter_extract_metadata
#   engine_adapter_write_record PATH CYCLE_OUTCOME [FAILURE_REASON]
#
# After a run/extract pair the adapter exposes these normalized fields:
#   ADAPTER_STATUS       success|error|timeout
#   ADAPTER_RESULT       human-readable result (bounded to 2000 bytes)
#   ADAPTER_COST_USD     decimal or empty when unavailable
#   ADAPTER_INPUT_TOKENS integer or empty when unavailable
#   ADAPTER_OUTPUT_TOKENS integer or empty when unavailable
#   ADAPTER_TOTAL_TOKENS integer or empty when unavailable
#   ADAPTER_SUBTYPE      provider subtype or success/error/timeout fallback
#   ADAPTER_TYPE         provider type or <engine>_exec fallback
#   ADAPTER_EXIT_CODE    process exit code (124 for watchdog timeout)
#   ADAPTER_TIMED_OUT    0|1
#   ADAPTER_OUTPUT       redacted combined stdout/stderr

ENGINE_ADAPTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$ENGINE_ADAPTER_DIR/process-supervisor.sh"

CURSOR_BIN="${CURSOR_BIN:-}"
CURSOR_ADAPTER_ENABLED="${CURSOR_ADAPTER_ENABLED:-0}"
CURSOR_SANDBOX_MODE="${CURSOR_SANDBOX_MODE:-enabled}"
CURSOR_FORCE="${CURSOR_FORCE:-0}"
CURSOR_ALLOW_UNSANDBOXED="${CURSOR_ALLOW_UNSANDBOXED:-0}"

OPENAI_COMPATIBLE_ADAPTER_ENABLED="${OPENAI_COMPATIBLE_ADAPTER_ENABLED:-0}"
OPENAI_COMPATIBLE_ENDPOINT="${OPENAI_COMPATIBLE_ENDPOINT:-}"
OPENAI_COMPATIBLE_MODEL="${OPENAI_COMPATIBLE_MODEL:-${MODEL:-}}"
OPENAI_COMPATIBLE_PYTHON_BIN="${OPENAI_COMPATIBLE_PYTHON_BIN:-}"
OPENAI_COMPATIBLE_REQUEST_TIMEOUT_SECONDS="${OPENAI_COMPATIBLE_REQUEST_TIMEOUT_SECONDS:-120}"
OPENAI_COMPATIBLE_MAX_TURNS="${OPENAI_COMPATIBLE_MAX_TURNS:-12}"
OPENAI_COMPATIBLE_ALLOW_SHELL="${OPENAI_COMPATIBLE_ALLOW_SHELL:-0}"
OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP="${OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP:-0}"
OPENAI_COMPATIBLE_BYPASS_PROXY=0

ADAPTER_TIMEOUT_GRACE_SECONDS="${ADAPTER_TIMEOUT_GRACE_SECONDS:-5}"
CYCLE_TERM_GRACE_SECONDS="${CYCLE_TERM_GRACE_SECONDS:-$ADAPTER_TIMEOUT_GRACE_SECONDS}"
CYCLE_KILL_WAIT_SECONDS="${CYCLE_KILL_WAIT_SECONDS:-5}"
RESOLVED_ENGINE_BIN="${RESOLVED_ENGINE_BIN:-}"

adapter_reset_result() {
    ADAPTER_STATUS="error"
    ADAPTER_RESULT=""
    ADAPTER_COST_USD=""
    ADAPTER_INPUT_TOKENS=""
    ADAPTER_OUTPUT_TOKENS=""
    ADAPTER_TOTAL_TOKENS=""
    ADAPTER_SUBTYPE="unknown"
    ADAPTER_TYPE="${ENGINE}_exec"
    ADAPTER_EXIT_CODE=1
    ADAPTER_TIMED_OUT=0
    ADAPTER_OUTPUT=""
    ADAPTER_RESULT_SOURCE=""
}

adapter_redact() {
    local value secret_name secret
    value=$(cat)
    for secret_name in \
        OPENAI_COMPATIBLE_API_KEY \
        OPENAI_API_KEY \
        CODEX_API_KEY \
        ANTHROPIC_API_KEY \
        ANTHROPIC_AUTH_TOKEN \
        CURSOR_API_KEY; do
        secret="${!secret_name:-}"
        if [ -n "$secret" ]; then
            value="${value//"$secret"/[REDACTED]}"
        fi
    done
    printf '%s' "$value"
}

adapter_is_enabled() {
    [ "$1" = "1" ]
}

adapter_validate_boolean() {
    case "$2" in
        0|1) return 0 ;;
        *) echo "Error: $1 must be 0 or 1 (received: '$2')." >&2; return 1 ;;
    esac
}

adapter_validate_claude_permission_mode() {
    case "${CLAUDE_PERMISSION_MODE:-}" in
        ""|acceptEdits|auto|bypassPermissions|default|dontAsk|plan)
            return 0
            ;;
        *)
            echo "Error: CLAUDE_PERMISSION_MODE must be one of: acceptEdits, auto, bypassPermissions, default, dontAsk, plan." >&2
            return 1
            ;;
    esac
}

adapter_openai_endpoint_host() {
    local endpoint="$1"
    local authority
    authority="${endpoint#*://}"
    authority="${authority%%/*}"

    if [[ "$authority" =~ ^\[([^]]+)\](:[0-9]+)?$ ]]; then
        printf '[%s]\n' "${BASH_REMATCH[1]}"
        return 0
    fi
    if [[ "$authority" =~ ^([^:]+)(:[0-9]+)?$ ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
        return 0
    fi
    return 1
}

adapter_openai_host_is_loopback() {
    local host
    host=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
    case "$host" in
        localhost|localhost.|'[::1]')
            return 0
            ;;
    esac
    [[ "$host" =~ ^127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]
}

engine_adapter_validate() {
    engine_adapter_validate_options || return 1
    # Model permission modes are an inner policy, never a host read boundary.
    python3 "$ENGINE_ADAPTER_DIR/project_isolation.py" --check || return 1
}

engine_adapter_validate_options() {
    case "$ENGINE" in
        claude)
            adapter_validate_claude_permission_mode
            ;;
        codex)
            case "${CODEX_REASONING_EFFORT:-}" in
                ""|none|minimal|low|medium|high|xhigh|max|ultra) return 0 ;;
                *) echo "Invalid CODEX_REASONING_EFFORT" >&2; return 1 ;;
            esac
            ;;
        cursor)
            adapter_validate_boolean "CURSOR_ADAPTER_ENABLED" "$CURSOR_ADAPTER_ENABLED" || return 1
            adapter_validate_boolean "CURSOR_FORCE" "$CURSOR_FORCE" || return 1
            adapter_validate_boolean "CURSOR_ALLOW_UNSANDBOXED" "$CURSOR_ALLOW_UNSANDBOXED" || return 1
            if ! adapter_is_enabled "$CURSOR_ADAPTER_ENABLED"; then
                echo "Error: Cursor adapter is disabled. Set CURSOR_ADAPTER_ENABLED=1 to opt in." >&2
                return 1
            fi
            case "$CURSOR_SANDBOX_MODE" in
                enabled|disabled) ;;
                *)
                    echo "Error: CURSOR_SANDBOX_MODE must be 'enabled' or 'disabled'." >&2
                    return 1
                    ;;
            esac
            if [ "$CURSOR_SANDBOX_MODE" = "disabled" ] && [ "$CURSOR_FORCE" = "1" ]; then
                echo "Error: Cursor --force with a disabled sandbox is forbidden." >&2
                return 1
            fi
            if [ "$CURSOR_SANDBOX_MODE" = "disabled" ] && ! adapter_is_enabled "$CURSOR_ALLOW_UNSANDBOXED"; then
                echo "Error: disabled Cursor sandbox requires CURSOR_ALLOW_UNSANDBOXED=1." >&2
                return 1
            fi
            ;;
        openai-compatible)
            adapter_validate_boolean "OPENAI_COMPATIBLE_ADAPTER_ENABLED" "$OPENAI_COMPATIBLE_ADAPTER_ENABLED" || return 1
            adapter_validate_boolean "OPENAI_COMPATIBLE_ALLOW_SHELL" "$OPENAI_COMPATIBLE_ALLOW_SHELL" || return 1
            adapter_validate_boolean "OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP" "$OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP" || return 1
            if ! adapter_is_enabled "$OPENAI_COMPATIBLE_ADAPTER_ENABLED"; then
                echo "Error: OpenAI-compatible adapter is disabled. Set OPENAI_COMPATIBLE_ADAPTER_ENABLED=1 to opt in." >&2
                return 1
            fi
            if [ -z "$OPENAI_COMPATIBLE_ENDPOINT" ]; then
                echo "Error: OPENAI_COMPATIBLE_ENDPOINT is required; no endpoint is built in." >&2
                return 1
            fi
            case "$OPENAI_COMPATIBLE_ENDPOINT" in
                *\?*|*\#*|*://*@*)
                    echo "Error: endpoint query, fragment, and embedded credentials are forbidden; use the API key environment variable." >&2
                    return 1
                    ;;
            esac
            local endpoint_host
            case "$OPENAI_COMPATIBLE_ENDPOINT" in
                http://*|https://*)
                    if ! endpoint_host=$(adapter_openai_endpoint_host "$OPENAI_COMPATIBLE_ENDPOINT"); then
                        echo "Error: OPENAI_COMPATIBLE_ENDPOINT must be a well-formed http(s) URL with an explicit host." >&2
                        return 1
                    fi
                    ;;
                *)
                    echo "Error: OPENAI_COMPATIBLE_ENDPOINT must be an http(s) URL." >&2
                    return 1
                    ;;
            esac
            if [[ "$OPENAI_COMPATIBLE_ENDPOINT" == http://* ]]; then
                if adapter_openai_host_is_loopback "$endpoint_host"; then
                    # A loopback request must not escape through an inherited proxy.
                    OPENAI_COMPATIBLE_BYPASS_PROXY=1
                elif ! adapter_is_enabled "$OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP"; then
                    echo "Error: non-loopback HTTP endpoints are blocked because prompts and Bearer credentials would be sent without transport encryption. Use HTTPS, a loopback HTTP endpoint, or explicitly set OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP=1." >&2
                    return 1
                fi
            fi
            export OPENAI_COMPATIBLE_BYPASS_PROXY
            if [ -z "$OPENAI_COMPATIBLE_MODEL" ]; then
                echo "Error: OPENAI_COMPATIBLE_MODEL (or MODEL) is required; no model is built in." >&2
                return 1
            fi
            if [ -n "${OPENAI_COMPATIBLE_API_KEY:-}" ]; then
                case "$OPENAI_COMPATIBLE_ENDPOINT$OPENAI_COMPATIBLE_MODEL" in
                    *"$OPENAI_COMPATIBLE_API_KEY"*)
                        echo "Error: API key material must not be embedded in endpoint or model configuration." >&2
                        return 1
                        ;;
                esac
            fi
            ;;
        *)
            echo "Error: Unsupported ENGINE '$ENGINE'. Use claude, codex, cursor, or openai-compatible." >&2
            return 1
            ;;
    esac
}

adapter_resolve_override_or_path() {
    local override="$1"
    local command_name="$2"
    if [ -n "$override" ]; then
        if [ -x "$override" ]; then
            printf '%s\n' "$override"
            return 0
        fi
        if command -v "$override" >/dev/null 2>&1; then
            command -v "$override"
            return 0
        fi
        return 1
    fi
    if command -v "$command_name" >/dev/null 2>&1; then
        command -v "$command_name"
        return 0
    fi
    return 1
}

adapter_resolve_node_cli() {
    local override="$1"
    local command_name="$2"
    if [ -n "$override" ]; then
        if adapter_resolve_override_or_path "$override" "$command_name"; then
            return 0
        fi
    fi

    local path_candidate=""
    path_candidate=$(command -v "$command_name" 2>/dev/null || true)
    if [ -n "$path_candidate" ]; then
        case "$path_candidate" in
            /mnt/c/*) ;;
            *)
                printf '%s\n' "$path_candidate"
                return 0
                ;;
        esac
    fi

    local user_local_candidate="$HOME/.local/bin/$command_name"
    if [ -x "$user_local_candidate" ]; then
        printf '%s\n' "$user_local_candidate"
        return 0
    fi

    local interactive_candidate=""
    interactive_candidate=$(bash -ic "command -v $command_name" 2>/dev/null | tail -n1 | tr -d '\r' || true)
    if [ -n "$interactive_candidate" ] && [ -x "$interactive_candidate" ]; then
        case "$interactive_candidate" in
            /mnt/c/*) ;;
            *)
                printf '%s\n' "$interactive_candidate"
                return 0
                ;;
        esac
    fi

    local nvm_candidate=""
    local candidate
    for candidate in "$HOME"/.nvm/versions/node/*/bin/"$command_name"; do
        if [ -x "$candidate" ]; then
            nvm_candidate="$candidate"
        fi
    done
    if [ -n "$nvm_candidate" ]; then
        printf '%s\n' "$nvm_candidate"
        return 0
    fi

    if [ -n "$path_candidate" ]; then
        printf '%s\n' "$path_candidate"
        return 0
    fi

    if [ -n "$interactive_candidate" ] && [ -x "$interactive_candidate" ]; then
        printf '%s\n' "$interactive_candidate"
        return 0
    fi
    return 1
}

engine_adapter_resolve() {
    case "$ENGINE" in
        claude)
            adapter_resolve_node_cli "${CLAUDE_BIN:-}" "claude"
            ;;
        codex)
            adapter_resolve_node_cli "${CODEX_BIN:-}" "codex"
            ;;
        cursor)
            if adapter_resolve_node_cli "$CURSOR_BIN" "cursor-agent"; then
                return 0
            fi
            adapter_resolve_node_cli "$CURSOR_BIN" "agent"
            ;;
        openai-compatible)
            if [ -n "$OPENAI_COMPATIBLE_PYTHON_BIN" ]; then
                adapter_resolve_override_or_path "$OPENAI_COMPATIBLE_PYTHON_BIN" "$OPENAI_COMPATIBLE_PYTHON_BIN"
                return
            fi
            if command -v python3 >/dev/null 2>&1; then
                command -v python3
                return 0
            fi
            return 1
            ;;
        *)
            return 1
            ;;
    esac
}

engine_adapter_missing_dependency_message() {
    case "$ENGINE" in
        claude) echo "Claude CLI not found. Install Claude Code in WSL and verify with 'claude --version'." ;;
        codex) echo "Codex CLI not found. Install Codex in WSL and verify with 'codex --version'." ;;
        cursor) echo "Cursor Agent CLI not found. Install it or set CURSOR_BIN." ;;
        openai-compatible) echo "python3 not found. It is required by the OpenAI-compatible adapter." ;;
        *) echo "Unsupported engine: $ENGINE" ;;
    esac
}

engine_adapter_description() {
    case "$ENGINE" in
        claude) printf 'Engine: claude | Model: %s | PermissionMode: %s' "${MODEL_LABEL:-config-default}" "${CLAUDE_PERMISSION_MODE:-}" ;;
        codex) printf 'Engine: codex | Model: %s | Sandbox: %s' "${MODEL_LABEL:-config-default}" "${CODEX_SANDBOX_MODE:-}" ;;
        cursor) printf 'Engine: cursor | Model: %s | Sandbox: %s | Force: %s' "${MODEL_LABEL:-config-default}" "$CURSOR_SANDBOX_MODE" "$CURSOR_FORCE" ;;
        openai-compatible) printf 'Engine: openai-compatible | Model: %s | ArbitraryShell: %s | InsecureHTTP: %s' "$OPENAI_COMPATIBLE_MODEL" "$OPENAI_COMPATIBLE_ALLOW_SHELL" "$OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP" ;;
    esac
}

adapter_execute() {
    local output_file
    output_file=$(mktemp)
    ADAPTER_OUTPUT_FILE="$output_file"

    cycle_supervisor_run \
        "$CYCLE_TIMEOUT_SECONDS" \
        "$CYCLE_TERM_GRACE_SECONDS" \
        "$CYCLE_KILL_WAIT_SECONDS" \
        "$PROJECT_DIR" \
        "$output_file" \
        -- "$@" || true

    ADAPTER_EXIT_CODE="$CYCLE_SUPERVISOR_EXIT_CODE"
    ADAPTER_TIMED_OUT="$CYCLE_SUPERVISOR_TIMED_OUT"

    ADAPTER_OUTPUT=$(adapter_redact < "$output_file")
    rm -f "$output_file"
    ADAPTER_OUTPUT_FILE=""
    if [ "$ADAPTER_TIMED_OUT" -eq 1 ]; then
        ADAPTER_EXIT_CODE=124
    fi
}

engine_adapter_run() {
    local prompt="$1"
    local adapter_model="${MODEL:-}"
    [ "$ENGINE" != "openai-compatible" ] || adapter_model="$OPENAI_COMPATIBLE_MODEL"
    adapter_reset_result
    # A single mandatory entry also covers callers sourcing this adapter
    # directly. There is no environment escape hatch or unsafe fallback.
    export CLAUDE_PERMISSION_MODE CODEX_SANDBOX_MODE OPENAI_COMPATIBLE_ENDPOINT OPENAI_COMPATIBLE_MODEL
    export OPENAI_COMPATIBLE_REQUEST_TIMEOUT_SECONDS OPENAI_COMPATIBLE_MAX_TURNS
    export OPENAI_COMPATIBLE_ALLOW_SHELL OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP
    adapter_execute python3 "$ENGINE_ADAPTER_DIR/isolation_workspace.py" \
        --root "$PROJECT_DIR" --project "${ACTIVE_PROJECT:-}" --engine "$ENGINE" \
        --binary "$RESOLVED_ENGINE_BIN" --model "$adapter_model" \
        --effort "${CODEX_REASONING_EFFORT:-}" "$prompt"
    ADAPTER_RESULT_SOURCE="$ADAPTER_OUTPUT"
    [ "$ENGINE" != "codex" ] || ADAPTER_RESULT_SOURCE=""
}

adapter_normalize_number() {
    local value="${1//,/}"
    if [[ "$value" =~ ^-?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$ ]]; then
        printf '%s' "$value"
    fi
}

adapter_normalize_integer() {
    local value="${1//,/}"
    if [[ "$value" =~ ^[0-9]+$ ]]; then
        printf '%s' "$value"
    fi
}

adapter_parse_json_metadata() {
    local source="$1"
    local values=() value
    while IFS= read -r -d '' value; do
        values+=("$value")
    done < <(printf '%s' "$source" | python3 "$ENGINE_ADAPTER_DIR/engine-metadata.py" "$ENGINE")
    if [ "${#values[@]}" -ne 8 ]; then
        ADAPTER_STATUS="error"
        ADAPTER_SUBTYPE="metadata_error"
        return
    fi
    ADAPTER_RESULT="${values[0]}"
    ADAPTER_COST_USD="${values[1]}"
    ADAPTER_INPUT_TOKENS="${values[2]}"
    ADAPTER_OUTPUT_TOKENS="${values[3]}"
    ADAPTER_TOTAL_TOKENS="${values[4]}"
    ADAPTER_SUBTYPE="${values[5]}"
    ADAPTER_TYPE="${values[6]}"
    ADAPTER_STATUS="${values[7]}"
}

engine_adapter_extract_metadata() {
    if [ "$ENGINE" = "codex" ]; then
        adapter_parse_json_metadata "$ADAPTER_OUTPUT"
        if [ -n "$ADAPTER_RESULT_SOURCE" ]; then
            ADAPTER_RESULT="$ADAPTER_RESULT_SOURCE"
        fi
    else
        adapter_parse_json_metadata "$ADAPTER_RESULT_SOURCE"
    fi

    # Process failure and watchdog timeout always outrank provider success.
    if [ "$ADAPTER_TIMED_OUT" -eq 1 ]; then
        ADAPTER_STATUS="timeout"
        ADAPTER_SUBTYPE="timeout"
    elif [ "$ADAPTER_EXIT_CODE" -ne 0 ]; then
        ADAPTER_STATUS="error"
        ADAPTER_SUBTYPE="error"
    fi

    if [ -z "$ADAPTER_RESULT" ]; then
        ADAPTER_RESULT=$(printf '%s' "$ADAPTER_RESULT_SOURCE" | head -c 2000 || true)
    fi
    if [ -z "$ADAPTER_RESULT" ]; then
        ADAPTER_RESULT=$(printf '%s' "$ADAPTER_OUTPUT" | head -c 2000 || true)
    fi

    if [ -z "$ADAPTER_TOTAL_TOKENS" ] && [ -n "$ADAPTER_INPUT_TOKENS" ] && [ -n "$ADAPTER_OUTPUT_TOKENS" ]; then
        ADAPTER_TOTAL_TOKENS=$((ADAPTER_INPUT_TOKENS + ADAPTER_OUTPUT_TOKENS))
    fi

    ADAPTER_RESULT=$(printf '%s' "$ADAPTER_RESULT" | adapter_redact | head -c 2000 || true)
    ADAPTER_SUBTYPE=$(printf '%s' "$ADAPTER_SUBTYPE" | adapter_redact)
    ADAPTER_TYPE=$(printf '%s' "$ADAPTER_TYPE" | adapter_redact)
}

adapter_json_string() {
    local value="$1"
    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$value" | jq -Rs .
        return
    fi
    if command -v python3 >/dev/null 2>&1; then
        printf '%s' "$value" | python3 -c 'import json, sys; print(json.dumps(sys.stdin.read(), ensure_ascii=False))'
        return
    fi
    value=${value//\\/\\\\}
    value=${value//\"/\\\"}
    value=${value//$'\n'/\\n}
    value=${value//$'\r'/\\r}
    value=${value//$'\t'/\\t}
    printf '"%s"' "$value"
}

adapter_json_number_or_null() {
    local normalized
    normalized=$(adapter_normalize_number "$1")
    if [ -n "$normalized" ]; then
        printf '%s' "$normalized"
    else
        printf 'null'
    fi
}

adapter_json_integer_or_null() {
    local normalized
    normalized=$(adapter_normalize_integer "$1")
    if [ -n "$normalized" ]; then
        printf '%s' "$normalized"
    else
        printf 'null'
    fi
}

engine_adapter_write_record() {
    local record_file="$1"
    local cycle_outcome="$2"
    local failure_reason="${3:-}"
    local temp_file="${record_file}.tmp.$$"
    local timed_out_json=false
    [ "$ADAPTER_TIMED_OUT" -eq 1 ] && timed_out_json=true

    {
        printf '{\n'
        printf '  "schema_version": 1,\n'
        printf '  "engine": %s,\n' "$(adapter_json_string "$ENGINE")"
        printf '  "status": %s,\n' "$(adapter_json_string "$ADAPTER_STATUS")"
        printf '  "cycle_outcome": %s,\n' "$(adapter_json_string "$cycle_outcome")"
        printf '  "failure_reason": %s,\n' "$(adapter_json_string "$(printf '%s' "$failure_reason" | adapter_redact)")"
        printf '  "result": %s,\n' "$(adapter_json_string "$ADAPTER_RESULT")"
        printf '  "cost_usd": %s,\n' "$(adapter_json_number_or_null "$ADAPTER_COST_USD")"
        printf '  "input_tokens": %s,\n' "$(adapter_json_integer_or_null "$ADAPTER_INPUT_TOKENS")"
        printf '  "output_tokens": %s,\n' "$(adapter_json_integer_or_null "$ADAPTER_OUTPUT_TOKENS")"
        printf '  "total_tokens": %s,\n' "$(adapter_json_integer_or_null "$ADAPTER_TOTAL_TOKENS")"
        printf '  "subtype": %s,\n' "$(adapter_json_string "$ADAPTER_SUBTYPE")"
        printf '  "type": %s,\n' "$(adapter_json_string "$ADAPTER_TYPE")"
        printf '  "exit_code": %s,\n' "$ADAPTER_EXIT_CODE"
        printf '  "timed_out": %s\n' "$timed_out_json"
        printf '}\n'
    } > "$temp_file"
    mv "$temp_file" "$record_file"
}

adapter_reset_result

#!/bin/bash
# ============================================================
# Auto Company — 选择执行引擎并写入 .auto-loop.env
# ============================================================
# 用法:
#   ./scripts/macos/select-engine.sh           交互选择
#   ./scripts/macos/select-engine.sh cursor
#   ./scripts/macos/select-engine.sh codex
#   ./scripts/macos/select-engine.sh vllm
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$PROJECT_DIR/.auto-loop.env"

normalize() {
    local raw
    raw="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
    case "$raw" in
        1|cursor) echo cursor ;;
        2|codex) echo codex ;;
        3|vllm|qwen|qwen3|qwen3.8|free) echo vllm ;;
        *) echo "" ;;
    esac
}

write_engine() {
    local chosen="$1"
    local tmp
    tmp="$(mktemp)"
    if [ -f "$ENV_FILE" ]; then
        awk -v e="$chosen" '
            BEGIN { done = 0 }
            /^[[:space:]]*#?[[:space:]]*ENGINE=/ {
                if (!done) {
                    print "ENGINE=" e
                    done = 1
                } else {
                    line = $0
                    sub(/^[[:space:]]+/, "", line)
                    if (line !~ /^#/) line = "#" line
                    print line
                }
                next
            }
            { print }
            END { if (!done) print "ENGINE=" e }
        ' "$ENV_FILE" > "$tmp"
        mv "$tmp" "$ENV_FILE"
    else
        printf 'ENGINE=%s\n' "$chosen" > "$ENV_FILE"
    fi
}

show_menu() {
    echo "选择 Auto Company 执行引擎："
    echo "  1) cursor   Cursor Agent（本机登录，收费）"
    echo "  2) codex    Codex CLI（ChatGPT 登录，收费）"
    echo "  3) vllm     免费：局域网 vLLM / Qwen3.8"
    echo ""
    printf "输入编号或名称 [%s]: " "${ENGINE:-cursor}"
}

ENGINE="${ENGINE:-}"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    set -a
    . "$ENV_FILE"
    set +a
fi

CHOICE="${1:-}"
if [ -z "$CHOICE" ]; then
    show_menu
    read -r CHOICE
fi

SELECTED="$(normalize "${CHOICE:-${ENGINE:-cursor}}")"
if [ -z "$SELECTED" ]; then
    echo "不支持的引擎: $CHOICE"
    echo "可选: cursor | codex | vllm"
    exit 1
fi

write_engine "$SELECTED"
echo "已写入 $ENV_FILE"
echo "当前引擎: $SELECTED"

if [ "$SELECTED" = "vllm" ]; then
    echo ""
    echo "免费方案请确认 .auto-loop.env 中的："
    echo "  VLLM_BASE_URL   例: http://58.241.131.10:30000/v1"
    echo "  VLLM_MODEL      例: Qwen/Qwen3.8-27B"
    echo "测通命令: make vllm-check"
fi

#!/usr/bin/env bash
# 镜场 CineForge — 编译通道验收（不依赖成片 Key / Omni）
# 成功定义：/api/health compileReady=true → POST /api/compile → 非空 prompt + locksDigest
# 不 mock 成片。compileReady=false 时直接 FAIL。
set -euo pipefail

BASE="${CINEFORGE_BASE:-http://127.0.0.1:3200}"
MIN_PROMPT_LEN="${MIN_PROMPT_LEN:-120}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd curl
need_cmd python3

echo "== 镜场编译通道验收 =="
echo "BASE=$BASE"

echo "-- 1) health"
HEALTH_JSON="$(curl -sS -m 12 "${BASE}/api/health" || true)"
[[ -n "$HEALTH_JSON" ]] || die "无法读取 ${BASE}/api/health（应用是否在跑？）"

COMPILE_READY="$(printf '%s' "$HEALTH_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("1" if d.get("compileReady") is True else "0")')"
WRITABLE="$(printf '%s' "$HEALTH_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("1" if d.get("writable") is True else "0")')"
if [[ "$COMPILE_READY" != "1" ]]; then
  echo "$HEALTH_JSON" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_JSON"
  die "compileReady!==true。请检查 LLM 设置（local 默认可用；vLLM/OpenAI 需可达）。"
fi
echo "OK compileReady=true (writable=$WRITABLE — 成片通道独立判定)"

echo "-- 2) 编译真草稿"
DRAFT_FILE="${ROOT}/scripts/fixtures/accept-draft.json"
[[ -f "$DRAFT_FILE" ]] || die "缺少验收草稿: $DRAFT_FILE"

COMPILE_JSON="$(curl -sS -m 30 -X POST "${BASE}/api/compile" \
  -H "Content-Type: application/json" \
  -d @"${DRAFT_FILE}" || true)"
[[ -n "$COMPILE_JSON" ]] || die "POST /api/compile 无响应"

PARSE="$(printf '%s' "$COMPILE_JSON" | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin)
except Exception as e:
  print(f'ERR|0||{e}'); sys.exit(0)
prompt=d.get('prompt') or ''
provider=d.get('provider') or ''
digest=d.get('locksDigest') or ''
used=d.get('usedFallback')
print(f'OK|{len(prompt)}|{provider}|{digest}|{used}')
")"
STATUS="${PARSE%%|*}"
if [[ "$STATUS" != "OK" ]]; then
  die "编译响应解析失败: $COMPILE_JSON"
fi

PROMPT_LEN="$(echo "$PARSE" | cut -d'|' -f2)"
PROVIDER="$(echo "$PARSE" | cut -d'|' -f3)"
DIGEST="$(echo "$PARSE" | cut -d'|' -f4)"
USED_FB="$(echo "$PARSE" | cut -d'|' -f5)"

[[ "$PROMPT_LEN" -ge "$MIN_PROMPT_LEN" ]] || die "prompt 过短 (${PROMPT_LEN} < ${MIN_PROMPT_LEN})"
[[ -n "$DIGEST" ]] || die "缺少 locksDigest"
[[ -n "$PROVIDER" ]] || die "缺少 provider"

echo "OK provider=$PROVIDER len=$PROMPT_LEN digest=${DIGEST:0:16}… fallback=$USED_FB"

echo "-- 3) 锁定项抽检"
printf '%s' "$COMPILE_JSON" | python3 -c "
import json,sys
d=json.load(sys.stdin)
p=d.get('prompt') or ''
need=['林晚','还开着就好','缺口','收银']
miss=[k for k in need if k not in p]
if miss:
  print('FAIL 缺少锁定词:', ','.join(miss))
  sys.exit(1)
print('OK 锁定词齐全')
" || die "锁定项未写入 prompt"

echo "PASS"
echo "compile_provider=$PROVIDER"
echo "prompt_bytes=$PROMPT_LEN"
echo "locks_digest=$DIGEST"
if [[ "$WRITABLE" == "1" ]]; then
  echo "下一步：./projects/cineforge/scripts/accept-first-render.sh"
else
  echo "下一步：注入 Key 或恢复 Omni 后跑 accept-first-render.sh；编译通道已就绪。"
fi
exit 0

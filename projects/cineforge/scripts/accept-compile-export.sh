#!/usr/bin/env bash
# 镜场 CineForge — 编译导出包验收（不依赖成片 Key / Omni）
# 成功定义：compile PASS → 导出包 schema=jingchang.compile.v1 + 非空 prompt + locksDigest
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

echo "== 镜场编译导出包验收 =="
echo "BASE=$BASE"

echo "-- 1) 编译通道"
"${ROOT}/scripts/accept-compile-pipeline.sh" || die "编译通道未通过"

echo "-- 2) 构建导出包"
DRAFT_FILE="${ROOT}/scripts/fixtures/accept-draft.json"
[[ -f "$DRAFT_FILE" ]] || die "缺少验收草稿: $DRAFT_FILE"

COMPILE_JSON="$(curl -sS -m 30 -X POST "${BASE}/api/compile" \
  -H "Content-Type: application/json" \
  -d @"${DRAFT_FILE}")"

TMP_COMPILE="$(mktemp)"
trap 'rm -f "$TMP_COMPILE"' EXIT
printf '%s' "$COMPILE_JSON" > "$TMP_COMPILE"

EXPORT_JSON="$(DRAFT_FILE="$DRAFT_FILE" COMPILE_FILE="$TMP_COMPILE" MIN_PROMPT_LEN="$MIN_PROMPT_LEN" python3 <<'PY'
import json
import os
from datetime import datetime, timezone

draft_path = os.environ["DRAFT_FILE"]
compile_path = os.environ["COMPILE_FILE"]
min_len = int(os.environ.get("MIN_PROMPT_LEN", "120"))

with open(draft_path, encoding="utf-8") as f:
    draft = json.load(f)
with open(compile_path, encoding="utf-8") as f:
    compiled = json.load(f)

prompt = compiled.get("prompt") or ""
digest = compiled.get("locksDigest") or ""
if len(prompt) < min_len:
    raise SystemExit(f"prompt 过短: {len(prompt)}")
if not digest:
    raise SystemExit("缺少 locksDigest")
need = ["林晚", "还开着就好", "缺口"]
miss = [k for k in need if k not in prompt]
if miss:
    raise SystemExit(f"锁定词缺失: {miss}")

bundle = {
    "schema": "jingchang.compile.v1",
    "exportedAt": datetime.now(timezone.utc).isoformat(),
    "brand": "镜场",
    "draft": draft,
    "compiled": compiled,
    "meta": {
        "compileOnly": True,
        "note": "成片需 Omni 或 Seedance Key；此为编译轨交付，非 mock 视频。",
    },
}
print(json.dumps(bundle, ensure_ascii=False))
PY
)"

printf '%s' "$EXPORT_JSON" | python3 -c "
import json, sys
b = json.load(sys.stdin)
assert b.get('schema') == 'jingchang.compile.v1'
assert b.get('brand') == '镜场'
assert b.get('meta', {}).get('compileOnly') is True
print('OK schema=jingchang.compile.v1')
print('OK prompt_bytes=', len((b.get('compiled') or {}).get('prompt') or ''), sep='')
print('OK locks_digest=', (b.get('compiled') or {}).get('locksDigest', '')[:16], '…', sep='')
"

OUT="${ROOT}/scripts/fixtures/accept-compile-export.json"
printf '%s\n' "$EXPORT_JSON" > "$OUT"
echo "OK 样例写入 $OUT"

echo "PASS"
echo "下一步：Studio「下载导演包」或 Key/Omni 恢复后 accept-first-render.sh"
exit 0

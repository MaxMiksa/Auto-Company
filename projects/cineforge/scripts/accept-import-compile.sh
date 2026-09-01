#!/usr/bin/env bash
# 镜场 CineForge — 导演包导入验收（不依赖成片 Key / Omni / 浏览器）
# 成功定义：fixture 符合 jingchang.compile.v1 → draft + compiled 可还原
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="${ROOT}/scripts/fixtures/accept-compile-export.json"
MIN_PROMPT_LEN="${MIN_PROMPT_LEN:-120}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd python3

echo "== 镜场导演包导入验收 =="
[[ -f "$BUNDLE" ]] || die "缺少样例包: $BUNDLE（先跑 accept-compile-export.sh）"

python3 <<PY
import json
import sys

path = "$BUNDLE"
min_len = int("$MIN_PROMPT_LEN")

with open(path, encoding="utf-8") as f:
    raw = json.load(f)

if raw.get("schema") != "jingchang.compile.v1":
    sys.exit(f"schema 不匹配: {raw.get('schema')}")
if raw.get("brand") != "镜场":
    sys.exit("brand 必须为 镜场")
meta = raw.get("meta") or {}
if meta.get("compileOnly") is not True:
    sys.exit("meta.compileOnly 必须为 true")

draft = raw.get("draft")
compiled = raw.get("compiled")
if not isinstance(draft, dict) or not isinstance(compiled, dict):
    sys.exit("缺少 draft 或 compiled")

prompt = compiled.get("prompt") or ""
digest = compiled.get("locksDigest") or ""
intent = draft.get("intent") or ""

if len(prompt) < min_len:
    sys.exit(f"prompt 过短: {len(prompt)}")
if not digest:
    sys.exit("缺少 locksDigest")
if not intent:
    sys.exit("缺少 draft.intent")

need = ["林晚", "还开着就好", "缺口"]
miss = [k for k in need if k not in prompt]
if miss:
    sys.exit(f"锁定词缺失: {miss}")

print("OK schema=jingchang.compile.v1")
print("OK brand=镜场 compileOnly=true")
print(f"OK intent_bytes={len(intent)}")
print(f"OK prompt_bytes={len(prompt)}")
print(f"OK locks_digest={digest[:16]}…")
print("OK 导入字段齐全 — Studio「导入导演包」应还原草稿与提示词")
PY

echo "PASS"
echo "下一步：/studio → 导入导演包 → 选 $BUNDLE → 目视验收草稿与提示词"
exit 0

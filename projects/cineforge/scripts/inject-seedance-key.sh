#!/usr/bin/env bash
# 镜场 CineForge — 一键注入 Seedance Key（写入本机 settings，不提交仓库）
# 用法：
#   ./inject-seedance-key.sh <KEY>
#   SEEDANCE_API_KEY=xxx ./inject-seedance-key.sh
#   ./inject-seedance-key.sh   # 从 env SEEDANCE_API_KEY / ARK_API_KEY 读取
set -euo pipefail

BASE="${CINEFORGE_BASE:-http://127.0.0.1:3200}"
KEY="${1:-${SEEDANCE_API_KEY:-${ARK_API_KEY:-}}}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd curl
need_cmd python3

[[ -n "$KEY" ]] || die "缺少 Key。用法: $0 <KEY> 或 export SEEDANCE_API_KEY=..."

echo "== 镜场 Seedance Key 注入 =="
echo "BASE=$BASE"

echo "-- 1) 读取当前 settings"
SETTINGS_JSON="$(curl -sS -m 12 "${BASE}/api/settings" || true)"
[[ -n "$SETTINGS_JSON" ]] || die "无法读取 ${BASE}/api/settings（应用是否在跑？）"

PATCH_JSON="$(printf '%s' "$SETTINGS_JSON" | python3 -c "
import json,sys,os
key=os.environ.get('INJECT_KEY','')
s=json.load(sys.stdin)
s['seedanceKey']=key
print(json.dumps(s))
" INJECT_KEY="$KEY")"

echo "-- 2) 写入 settings"
OUT="$(curl -sS -m 15 -X PUT "${BASE}/api/settings" \
  -H "Content-Type: application/json" \
  -d "$PATCH_JSON" || true)"
[[ -n "$OUT" ]] || die "PUT /api/settings 无响应"

echo "-- 3) 探活"
HEALTH_JSON="$(curl -sS -m 12 "${BASE}/api/health" || true)"
WRITABLE="$(printf '%s' "$HEALTH_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("1" if d.get("writable") is True else "0")')"
SD="$(printf '%s' "$HEALTH_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("1" if (d.get("seedance") or {}).get("ready") else "0")')"

if [[ "$SD" == "1" ]]; then
  echo "PASS Seedance ready, writable=$WRITABLE"
  echo "下一步: ./projects/cineforge/scripts/accept-first-render.sh"
else
  echo "WARN Key 已写入但 seedance.ready=false（检查模型名或 Key 权限）"
  echo "$HEALTH_JSON" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_JSON"
  exit 2
fi

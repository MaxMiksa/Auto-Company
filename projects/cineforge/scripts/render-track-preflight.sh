#!/usr/bin/env bash
# 镜场 CineForge — 成片轨 preflight（不 mock、不消耗 Key）
# 用法：./projects/cineforge/scripts/render-track-preflight.sh
# 可选：CINEFORGE_BASE=http://127.0.0.1:3200 OMNI_BASE=http://127.0.0.1:8092
# exit 0=READY（writable） 2=BLOCKED（需人类 Key/Omni）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
BASE="${CINEFORGE_BASE:-http://127.0.0.1:3200}"
OMNI_BASE="${OMNI_BASE:-http://127.0.0.1:8092}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd curl
need_cmd python3

BLOCKERS=()

echo "== 镜场 Render Track Preflight =="
echo "BASE=$BASE OMNI_BASE=$OMNI_BASE"
echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
echo

# -- 1) 验收脚本与 fixture
echo "-- 1) 验收资产"
for f in \
  "${CF}/scripts/accept-first-render.sh" \
  "${CF}/scripts/inject-seedance-key.sh" \
  "${CF}/scripts/fixtures/accept-draft.json"; do
  if [[ -f "$f" ]]; then
    echo "   OK $(basename "$f")"
  else
    echo "   MISSING $f"
    BLOCKERS+=("missing: $f")
  fi
done
echo

# -- 2) 应用 health
echo "-- 2) 应用 health"
HEALTH_JSON="$(curl -sS -m 12 "${BASE}/api/health" 2>/dev/null || true)"
if [[ -z "$HEALTH_JSON" ]]; then
  echo "   UNREACHABLE ${BASE}/api/health"
  BLOCKERS+=("app unreachable — 启动: cd projects/cineforge/app && npm run start")
else
  PARSE="$(printf '%s' "$HEALTH_JSON" | python3 -c "
import json,sys
d=json.load(sys.stdin)
w='yes' if d.get('writable') is True else 'no'
cr='yes' if d.get('compileReady') is True else 'no'
sd=d.get('seedance') or {}
mm=d.get('minimax') or {}
print(f\"writable={w}\")
print(f\"compileReady={cr}\")
print(f\"seedance.ready={'yes' if sd.get('ready') else 'no'} model={sd.get('model') or '-'}\")
print(f\"minimax.ok={'yes' if mm.get('ok') else 'no'}\")
print(f\"videoProvider={d.get('videoProvider') or '-'}\")
")"
  while IFS= read -r line; do echo "   $line"; done <<< "$PARSE"

  WRITABLE="$(printf '%s' "$HEALTH_JSON" | python3 -c 'import json,sys; print("1" if json.load(sys.stdin).get("writable") is True else "0")')"
  SD_READY="$(printf '%s' "$HEALTH_JSON" | python3 -c 'import json,sys; print("1" if (json.load(sys.stdin).get("seedance") or {}).get("ready") else "0")')"
  MM_OK="$(printf '%s' "$HEALTH_JSON" | python3 -c 'import json,sys; print("1" if (json.load(sys.stdin).get("minimax") or {}).get("ok") else "0")')"

  if [[ "$WRITABLE" != "1" ]]; then
    if [[ "$SD_READY" != "1" ]]; then
      BLOCKERS+=("Seedance Key 未注入 — export SEEDANCE_API_KEY 后 ${CF}/scripts/inject-seedance-key.sh")
    fi
    if [[ "$MM_OK" != "1" ]]; then
      BLOCKERS+=("Omni/MiniMax 不可用 — 恢复 ${OMNI_BASE}/health")
    fi
  fi
fi
echo

# -- 3) Omni 探活（独立）
echo "-- 3) Omni 探活"
OMNI_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -m 5 "${OMNI_BASE}/health" 2>/dev/null || echo 000)"
if [[ "$OMNI_CODE" == "200" ]]; then
  OMNI_BODY="$(curl -sS -m 5 "${OMNI_BASE}/health" 2>/dev/null || true)"
  OMNI_STATUS="$(printf '%s' "$OMNI_BODY" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("status","unknown"))' 2>/dev/null || echo unknown)"
  echo "   HTTP 200 status=$OMNI_STATUS"
  if [[ "$OMNI_STATUS" != "ok" ]]; then
    BLOCKERS+=("Omni status=$OMNI_STATUS（需连续两次 ok）")
  fi
else
  echo "   HTTP $OMNI_CODE — Omni 不可达"
  BLOCKERS+=("Omni 不可达 ($OMNI_BASE) — 需运维恢复")
fi
echo

# -- 4) GitHub render gate（信息性）
echo "-- 4) GitHub render gate"
if command -v gh >/dev/null 2>&1; then
  UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
  if gh secret list --repo "$UPSTREAM" 2>/dev/null | grep -q SEEDANCE_API_KEY; then
    echo "   OK secret SEEDANCE_API_KEY 已配置（upstream）"
  else
    echo "   MISSING secret SEEDANCE_API_KEY — Actions 手动触发 cineforge-render-gate 将跳过"
    BLOCKERS+=("GitHub secret SEEDANCE_API_KEY 未配置")
  fi
else
  echo "   SKIP gh 不可用"
fi
echo

# -- 汇总
echo "== Render Preflight 汇总 =="
if [[ ${#BLOCKERS[@]} -eq 0 ]]; then
  echo "READY: 成片轨可跑 accept-first-render.sh"
  echo
  echo "下一步:"
  echo "  ${CF}/scripts/accept-first-render.sh"
  echo "  或 GitHub Actions → cineforge-render-gate → Run workflow"
  exit 0
fi

echo "BLOCKED: ${#BLOCKERS[@]} 项（需人类）"
for b in "${BLOCKERS[@]}"; do
  echo "  - $b"
done
echo
echo "人类 unblock 路径（任选其一）:"
echo "  1. export SEEDANCE_API_KEY && ${CF}/scripts/inject-seedance-key.sh && ${CF}/scripts/accept-first-render.sh"
echo "  2. GitHub → Settings → Secrets → SEEDANCE_API_KEY → 手动跑 cineforge-render-gate"
echo "  3. 恢复 Omni → ${OMNI_BASE}/health status=ok"
exit 2

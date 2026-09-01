#!/usr/bin/env bash
# 镜场 CineForge — 双轨 blocker 仪表盘（编译轨 PR + 成片轨 Key/Omni）
# 用法：./projects/cineforge/scripts/blockers-status.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd gh
need_cmd python3

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           镜场 CineForge — 双轨 Blocker 仪表盘              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
echo

# === 编译轨 ===
echo "━━ 编译轨（PR #${PR}）━━"

PR_JSON=$(gh pr view "$PR" --repo "$UPSTREAM" --json \
  state,mergeable,url,headRefName 2>/dev/null) \
  || die "无法读取 PR #$PR"

PR_STATE=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
PR_URL=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['url'])")
PR_HEAD=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['headRefName'])")

PUSH_READY="unknown"
if "${CF}/scripts/accept-push-ready.sh" >/dev/null 2>&1; then
  PUSH_READY="PASS"
else
  PUSH_READY="FAIL"
fi

WORKFLOW="${WORKFLOW:-cineforge-compile-gate}"
RUNS=$(gh run list --repo "$UPSTREAM" --workflow="$WORKFLOW" --limit=3 \
  --json conclusion,headBranch 2>/dev/null || echo "[]")

WF_STATUS=$(echo "$RUNS" | python3 -c "
import json, sys
runs = json.load(sys.stdin)
if not runs:
    print('no runs')
elif any(r.get('conclusion') == 'action_required' for r in runs):
    print('action_required')
else:
    print(runs[0].get('conclusion') or runs[0].get('status', 'unknown'))
")

COMPILE_BLOCKED="no"
if [[ "$PR_STATE" != "MERGED" ]]; then
  COMPILE_BLOCKED="yes"
fi

echo "  PR:       $PR_URL"
echo "  state:    $PR_STATE  mergeable  branch=$PR_HEAD"
echo "  push-ready: $PUSH_READY"
echo "  compile-gate: $WF_STATUS"

if [[ "$COMPILE_BLOCKED" == "yes" ]]; then
  echo "  ⛔ BLOCKER: MaxMiksa → Checks → Approve and run workflows → Merge"
else
  echo "  ✅ 编译轨已 merge — 跑: make cineforge-verify-post-merge"
fi
echo

# === 成片轨 ===
echo "━━ 成片轨（Seedance / Omni）━━"
RENDER_EXIT=0
"${CF}/scripts/render-track-preflight.sh" 2>&1 | sed 's/^/  /' || RENDER_EXIT=$?

echo
echo "━━ 汇总 ━━"
if [[ "$COMPILE_BLOCKED" == "yes" && "$RENDER_EXIT" -ne 0 ]]; then
  echo "  双轨均 blocked — 编译轨等 MaxMiksa merge；成片轨等 Key/Omni"
elif [[ "$COMPILE_BLOCKED" == "yes" ]]; then
  echo "  编译轨 blocked（PR merge）；成片轨就绪"
elif [[ "$RENDER_EXIT" -ne 0 ]]; then
  echo "  编译轨就绪/已 merge；成片轨 blocked（Key/Omni）"
else
  echo "  双轨均 READY — 可跑 accept-first-render + verify-post-merge"
fi

echo
echo "Agent 命令:"
echo "  make cineforge-blockers          # 本仪表盘"
echo "  make cineforge-pre-merge-preflight"
echo "  make cineforge-render-preflight"
echo "  make cineforge-merge-watch       # 后台等 merge"

# 编译轨 blocked 时 exit 2；否则跟成片轨
if [[ "$COMPILE_BLOCKED" == "yes" ]]; then
  exit 2
fi
exit "$RENDER_EXIT"

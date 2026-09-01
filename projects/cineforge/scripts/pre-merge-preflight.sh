#!/usr/bin/env bash
# 镜场 CineForge — 合并前全量预检（人类 merge 前 agent 一键跑齐）
# 成功定义：本地 push-ready PASS + PR 可 merge + 明确 workflow 批准状态
# 用法：./projects/cineforge/scripts/pre-merge-preflight.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19 REQUIRE_PASS=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
REQUIRE_PASS="${REQUIRE_PASS:-1}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd gh
need_cmd python3

cd "$ROOT"

echo "== 镜场 Pre-Merge Preflight =="
echo "UPSTREAM=$UPSTREAM PR=$PR REQUIRE_PASS=$REQUIRE_PASS"
echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
echo

PREFLIGHT_OK=1
BLOCKERS=()

# --- 1) 本地 push-ready ---
echo "-- 1) 本地 push-ready"
if [[ "$REQUIRE_PASS" == "1" ]]; then
  if "${CF}/scripts/accept-push-ready.sh"; then
    echo "   PASS"
  else
    echo "   FAIL"
    PREFLIGHT_OK=0
    BLOCKERS+=("push-ready FAIL — 运行 make cineforge-push-ready")
  fi
else
  if "${CF}/scripts/accept-push-ready.sh" >/dev/null 2>&1; then
    echo "   PASS"
  else
    echo "   FAIL"
    PREFLIGHT_OK=0
    BLOCKERS+=("push-ready FAIL")
  fi
fi
echo

# --- 2) PR 状态 ---
echo "-- 2) PR #$PR 状态"
PR_JSON=$("${CF}/scripts/gh-retry.sh" pr view "$PR" --repo "$UPSTREAM" --json \
  state,mergeable,reviewDecision,title,url,headRefName,baseRefName 2>/dev/null) \
  || die "无法读取 PR #$PR"

PR_STATE=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
PR_MERGEABLE=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['mergeable'])")
PR_URL=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['url'])")

echo "$PR_JSON" | python3 -c "
import json, sys
p = json.load(sys.stdin)
print(f\"   state={p['state']} mergeable={p['mergeable']} review={p.get('reviewDecision') or 'pending'}\")
print(f\"   url={p['url']}\")
"

if [[ "$PR_STATE" == "MERGED" ]]; then
  echo
  echo "== PR 已 merge — 改跑 post-merge 验证 =="
  echo "   make cineforge-verify-post-merge"
  exit 0
fi

if [[ "$PR_STATE" != "OPEN" ]]; then
  PREFLIGHT_OK=0
  BLOCKERS+=("PR state=$PR_STATE（非 OPEN）")
fi

if [[ "$PR_MERGEABLE" != "MERGEABLE" ]]; then
  PREFLIGHT_OK=0
  BLOCKERS+=("PR 不可 merge: $PR_MERGEABLE")
fi
echo

# --- 3) Workflow 批准状态 ---
echo "-- 3) GitHub Actions workflow 批准"
WORKFLOW="${WORKFLOW:-cineforge-compile-gate}"
RUNS=$("${CF}/scripts/gh-retry.sh" run list --repo "$UPSTREAM" --workflow="$WORKFLOW" --limit=5 \
  --json databaseId,status,conclusion,headBranch,url 2>/dev/null || echo "[]")

ACTION_REQUIRED=0
python3 - <<'PY' "$RUNS" "$WORKFLOW"
import json, sys
runs = json.loads(sys.argv[1])
wf = sys.argv[2]
if not runs:
    print(f"   无 {wf} run（workflow 可能尚未批准运行）")
    sys.exit(0)
for r in runs[:3]:
    print(f"   {r['conclusion'] or r['status']:16} {r['headBranch']:30}")
action_required = any(r.get("conclusion") == "action_required" for r in runs)
if action_required:
    print()
    print("   ⚠ action_required — 需 MaxMiksa 批准 fork workflow")
PY

if echo "$RUNS" | python3 -c "import json,sys; print('yes' if any(r.get('conclusion')=='action_required' for r in json.load(sys.stdin)) else 'no')" | grep -q yes; then
  ACTION_REQUIRED=1
  PREFLIGHT_OK=0
  BLOCKERS+=("workflow action_required — MaxMiksa 需 Approve and run workflows")
fi
echo

# --- 4) 运行态快照 ---
echo "-- 4) 本地运行态"
"${CF}/scripts/status-health.sh" | sed 's/^/   /'
echo

# --- 5) Post-merge 就绪 ---
echo "-- 5) Post-merge 脚本就绪"
if [[ -x "${CF}/scripts/verify-post-merge.sh" ]]; then
  echo "   verify-post-merge.sh OK"
else
  PREFLIGHT_OK=0
  BLOCKERS+=("verify-post-merge.sh 缺失或不可执行")
fi
echo

# --- 汇总 ---
echo "== Preflight 汇总 =="
if [[ "$PREFLIGHT_OK" == "1" ]]; then
  echo "READY: 本地全绿 + PR 可 merge — 等待 MaxMiksa merge"
  echo
  echo "MaxMiksa 2 步："
  echo "  1. $PR_URL → Checks → Approve and run workflows"
  echo "  2. Merge → make cineforge-verify-post-merge"
  exit 0
fi

echo "WAIT: 存在 blocker（${#BLOCKERS[@]} 项）"
for b in "${BLOCKERS[@]}"; do
  echo "  - $b"
done
echo
echo "PR: $PR_URL"
if [[ "$ACTION_REQUIRED" == "1" ]]; then
  echo
  echo "人类 blocker — agent 无法绕过 fork workflow 批准。"
  echo "升级: make cineforge-merge-escalate"
  exit 2
fi
exit 1

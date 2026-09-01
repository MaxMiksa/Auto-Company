#!/usr/bin/env bash
# 镜场 CineForge — PR 合并就绪报告（fork PR → upstream）
# 汇总：PR 状态、workflow 批准、本地 push-ready、MaxMiksa 2 步清单
# 用法：./projects/cineforge/scripts/pr-merge-readiness.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19 REQUIRE_PASS=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
WORKFLOW="${WORKFLOW:-cineforge-compile-gate}"
REQUIRE_PASS="${REQUIRE_PASS:-0}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd gh

cd "$ROOT"

echo "== 镜场 PR 合并就绪报告 =="
echo "UPSTREAM=$UPSTREAM PR=$PR WORKFLOW=$WORKFLOW"
echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
echo

PR_JSON=$(gh pr view "$PR" --repo "$UPSTREAM" --json \
  state,mergeable,reviewDecision,title,url,headRefName,baseRefName,author,commits 2>/dev/null) \
  || die "无法读取 PR #$PR — 确认 UPSTREAM/PR 正确"

echo "$PR_JSON" | python3 -c "
import json, sys
p = json.load(sys.stdin)
pr = sys.argv[1]
print(f'-- PR #{pr}')
print(f\"   title: {p['title']}\")
print(f\"   url:   {p['url']}\")
print(f\"   state: {p['state']}  mergeable: {p['mergeable']}  review: {p.get('reviewDecision') or 'pending'}\")
print(f\"   head:  {p['headRefName']} → base: {p['baseRefName']}\")
author = p.get('author') or {}
print(f\"   author: {author.get('login', 'unknown')}  commits: {len(p.get('commits') or [])}\")
" "$PR"

PR_STATE=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
PR_URL=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['url'])")

echo
echo "-- GitHub Actions（PR 分支）"
RUNS=$(gh run list --repo "$UPSTREAM" --workflow="$WORKFLOW" --limit=5 \
  --json databaseId,status,conclusion,event,headBranch,createdAt,url 2>/dev/null || echo "[]")

python3 - <<'PY' "$RUNS" "$WORKFLOW"
import json, sys
runs = json.loads(sys.argv[1])
wf = sys.argv[2]
if not runs:
    print(f"   无 {wf} run 记录（workflow 可能尚未在 upstream 激活）")
    sys.exit(0)
for r in runs[:3]:
    print(f"   {r['conclusion'] or r['status']:16} {r['headBranch']:30} {r['url']}")
action_required = any(r.get("conclusion") == "action_required" for r in runs)
if action_required:
    print()
    print("   ⚠ action_required — fork PR 的 workflow 需 upstream maintainer 批准后才能运行。")
    print("     MaxMiksa: PR → Checks → Approve and run workflows")
PY

echo
echo "-- 本地 push-ready"
if [[ "$REQUIRE_PASS" == "1" ]]; then
  "${CF}/scripts/accept-push-ready.sh"
else
  if "${CF}/scripts/accept-push-ready.sh" >/dev/null 2>&1; then
    echo "   PASS（完整日志: make cineforge-push-ready）"
  else
    echo "   FAIL — 运行 make cineforge-push-ready 查看详情"
  fi
fi

echo
echo "-- Post-merge 验证（merge 后执行）"
echo "   make cineforge-verify-post-merge"

echo
echo "== MaxMiksa 合并清单（2 步）=="
if [[ "$PR_STATE" == "OPEN" ]]; then
  cat <<EOF
1. 打开 PR → Checks 标签 → 若有 "Workflow runs awaiting approval" → **Approve and run workflows**
2. 确认 \`cineforge-compile-gate\` 绿（或本地 push-ready 已 PASS）→ **Merge pull request**

   $PR_URL

Merge 后（agent 或人类）：
   make cineforge-verify-post-merge
EOF
elif [[ "$PR_STATE" == "MERGED" ]]; then
  echo "PR 已 merge — 运行: make cineforge-verify-post-merge"
else
  echo "PR state=$PR_STATE — 检查 $PR_URL"
fi

echo
exit 0

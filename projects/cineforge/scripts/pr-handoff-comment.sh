#!/usr/bin/env bash
# 镜场 CineForge — 在 PR 上发布 MaxMiksa 合并 handoff（比 Issue 更醒目）
# 用法：./projects/cineforge/scripts/pr-handoff-comment.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19 CYCLE=20 DRY_RUN=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
CYCLE="${CYCLE:-20}"
DRY_RUN="${DRY_RUN:-0}"

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

PR_JSON=$(gh pr view "$PR" --repo "$UPSTREAM" --json \
  state,mergeable,title,url,headRefName 2>/dev/null) \
  || die "无法读取 PR #$PR"

PR_STATE=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
PR_URL=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['url'])")
PR_HEAD=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['headRefName'])")

if [[ "$PR_STATE" == "MERGED" ]]; then
  echo "PR 已 merge — 改跑: make cineforge-verify-post-merge"
  exit 0
fi

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

FORK_HEAD=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")

BODY=$(cat <<EOF
## 🤖 Cycle ${CYCLE} — Merge Handoff（Auto Company）

本地 **push-ready: ${PUSH_READY}** · compile gate: \`${WF_STATUS}\` · 分支 \`${PR_HEAD}\` @ \`${FORK_HEAD}\`

### MaxMiksa — 2 步合并（约 2 分钟）

1. 本 PR → **Checks** → **Approve and run workflows**（解除 \`action_required\`）
2. 确认 \`cineforge-compile-gate\` 绿（或信任本地 push-ready PASS）→ **Merge pull request**

### Merge 后立即跑

\`\`\`bash
make cineforge-verify-post-merge
\`\`\`

或后台自动等待 merge 并验证：

\`\`\`bash
make cineforge-merge-watch
\`\`\`

追踪 Issue: https://github.com/${UPSTREAM}/issues/17

---
_Auto Company Cycle ${CYCLE}_
EOF
)

echo "== PR Handoff Comment =="
echo "PR=$PR state=$PR_STATE push-ready=$PUSH_READY workflow=$WF_STATUS"
echo

if [[ "$DRY_RUN" == "1" ]]; then
  echo "-- DRY_RUN — 将发布以下评论："
  echo "$BODY"
  exit 0
fi

gh pr comment "$PR" --repo "$UPSTREAM" --body "$BODY"

echo "OK: 已评论 PR #$PR"
echo "$PR_URL"
exit 0

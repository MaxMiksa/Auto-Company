#!/usr/bin/env bash
# 镜场 CineForge — 向 Issue #17 发布 merge blocker 升级（收敛规则 #5 pivot）
# 用法：./projects/cineforge/scripts/merge-escalate-issue.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19 ISSUE=17 DRY_RUN=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
ISSUE="${ISSUE:-17}"
DRY_RUN="${DRY_RUN:-0}"
CYCLE="${CYCLE:-24}"

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
  state,mergeable,title,url,headRefName,updatedAt 2>/dev/null) \
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
  --json conclusion,headBranch,url 2>/dev/null || echo "[]")

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

RENDER_STATUS="unknown"
if "${CF}/scripts/render-track-preflight.sh" >/dev/null 2>&1; then
  RENDER_STATUS="READY"
else
  RENDER_STATUS="BLOCKED (Key/Omni)"
fi

BODY=$(cat <<EOF
## Cycle ${CYCLE} — Merge 升级（收敛规则 #5 pivot #8）

PR #${PR} 已连续多轮等待 MaxMiksa merge。Agent 本轮 ship **GitHub 原生 merge-nudge**（非重复 handoff）。

### 本轮新增
- \`merge-nudge.sh\` + \`make cineforge-merge-nudge\` — @MaxMiksa + review/assign 请求
- \`post-merge-dry-run.sh\` + \`make cineforge-post-merge-dry-run\` — merge 前自动化就绪检查
- \`merge-watch.sh\` — merge 时 macOS 桌面通知 + 自动 verify

### 当前状态
| 项 | 值 |
|---|---|
| PR | [#${PR}](${PR_URL}) \`${PR_STATE}\` |
| 分支 | \`${PR_HEAD}\` @ \`${FORK_HEAD}\` |
| 本地 push-ready | **${PUSH_READY}** |
| compile gate | \`${WF_STATUS}\` |
| 成片轨 | \`${RENDER_STATUS}\` |

### 人类行动卡（一屏摘要）
\`\`\`bash
make cineforge-unblock-card
make cineforge-merge-nudge          # GitHub @mention nudge
\`\`\`

### MaxMiksa — 2 步合并（约 2 分钟）
1. [PR #${PR}](${PR_URL}) → **Checks** → **Approve and run workflows**（解除 \`action_required\`）
2. 确认 \`cineforge-compile-gate\` 绿（或信任本地 push-ready PASS）→ **Merge pull request**

### Merge 后自动验证
\`\`\`bash
make cineforge-daemon-health
make cineforge-post-merge-dry-run     # 就绪检查
make cineforge-verify-post-merge      # 或 daemon 自动跑
\`\`\`

---
_Auto Company Cycle ${CYCLE}_
EOF
)

echo "== Merge 升级 Issue #${ISSUE} =="
echo "PR=$PR state=$PR_STATE push-ready=$PUSH_READY workflow=$WF_STATUS"
echo

if [[ "$DRY_RUN" == "1" ]]; then
  echo "-- DRY_RUN — 将发布以下评论："
  echo "$BODY"
  exit 0
fi

if [[ "$PR_STATE" == "MERGED" ]]; then
  echo "PR 已 merge — 跳过升级，改跑: make cineforge-verify-post-merge"
  exit 0
fi

gh issue comment "$ISSUE" --repo "$UPSTREAM" --body "$BODY"

echo "OK: 已评论 Issue #${ISSUE}"
echo "https://github.com/${UPSTREAM}/issues/${ISSUE}"
exit 0

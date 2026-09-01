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
## Cycle ${CYCLE} — Merge 升级（收敛规则 #5 pivot #7）

PR #${PR} 已连续多轮等待 MaxMiksa merge。Agent 本轮 ship **daemon 容错修复 + PR 直接 handoff**，不再空转。

### 本轮修复
- \`merge-watch.sh\`：\`gh\` 瞬时失败不再杀死 daemon（Cycle 23 根因）
- \`daemon-health.sh\` + \`make cineforge-daemon-health\`：检测 stale pid + 自动重启
- PR 直接 handoff 评论（比 Issue 更醒目）

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
\`\`\`

### MaxMiksa — 2 步合并（约 2 分钟）
1. [PR #${PR}](${PR_URL}) → **Checks** → **Approve and run workflows**（解除 \`action_required\`）
2. 确认 \`cineforge-compile-gate\` 绿（或信任本地 push-ready PASS）→ **Merge pull request**

### Merge 后自动验证（daemon 已修复 gh 容错）
\`\`\`bash
make cineforge-daemon-health              # 检查/重启 daemon
make cineforge-merge-watch-daemon         # 后台等 merge → 自动 verify
make cineforge-verify-post-merge          # 或手动一次性
\`\`\`

### Agent 预检命令
\`\`\`bash
make cineforge-pre-merge-preflight   # 合并前全量预检
make cineforge-pr-readiness          # 合并就绪报告
make cineforge-merge-escalate        # 本升级评论
\`\`\`

### 仍 blocked（需人类）
- 成片轨：Seedance Key / Omni 恢复
  \`\`\`bash
  make cineforge-render-preflight   # 成片轨 blocker 明细
  make cineforge-blockers           # 双轨仪表盘
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

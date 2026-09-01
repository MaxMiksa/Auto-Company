#!/usr/bin/env bash
# 镜场 CineForge — Issue 通知通道 nudge（assign + label + 评论，非 PR handoff）
# 用法：./projects/cineforge/scripts/issue-assign-nudge.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19 ISSUE=17 ASSIGNEE=MaxMiksa CYCLE=25 DRY_RUN=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
ISSUE="${ISSUE:-17}"
ASSIGNEE="${ASSIGNEE:-MaxMiksa}"
LABEL="${LABEL:-blocked:human-merge}"
CYCLE="${CYCLE:-25}"
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
  state,url,headRefName 2>/dev/null) || die "无法读取 PR #$PR"

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

FORK_HEAD=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")
CHECKS_URL="${PR_URL}/checks"
ISSUE_URL="https://github.com/${UPSTREAM}/issues/${ISSUE}"

echo "== Issue Assign Nudge =="
echo "issue=#${ISSUE} assignee=${ASSIGNEE} push-ready=${PUSH_READY}"
echo

if [[ "$DRY_RUN" == "1" ]]; then
  echo "-- DRY_RUN — 将执行："
  echo "  gh label create ${LABEL}（如不存在）"
  echo "  gh issue edit --add-assignee ${ASSIGNEE} --add-label ${LABEL}"
  echo "  gh issue comment（@${ASSIGNEE} + deeplink）"
  exit 0
fi

if ! gh label list --repo "$UPSTREAM" --json name -q '.[].name' 2>/dev/null \
  | grep -qx "$LABEL"; then
  if gh label create "$LABEL" --repo "$UPSTREAM" \
    --description "需人类 unblock（workflow 批准 / merge / Key）" \
    --color "B60205" 2>/dev/null; then
    echo "OK: 创建 label ${LABEL}"
  else
    echo "WARN: label 创建失败（可能已存在或无权限）"
  fi
fi

if gh issue edit "$ISSUE" --repo "$UPSTREAM" --add-assignee "$ASSIGNEE" 2>/dev/null; then
  echo "OK: Issue #${ISSUE} 已 assign @${ASSIGNEE}"
else
  echo "WARN: assign 失败（fork 权限限制）— 继续 label + comment"
fi

if gh issue edit "$ISSUE" --repo "$UPSTREAM" --add-label "$LABEL" 2>/dev/null; then
  echo "OK: label ${LABEL} 已添加"
else
  echo "WARN: label 添加失败 — 继续 comment"
fi

BODY=$(cat <<EOF
@${ASSIGNEE} **编译轨 PR 待合并** — Issue 通知通道（Cycle ${CYCLE} pivot）

| 项 | 值 |
|---|---|
| PR | [#${PR}](${PR_URL}) \`${PR_STATE}\` |
| 分支 | \`${PR_HEAD}\` @ \`${FORK_HEAD}\` |
| push-ready | **${PUSH_READY}** |
| compile gate | \`action_required\` |

### 2 步合并（约 2 分钟）
1. [**Checks → Approve and run workflows**](${CHECKS_URL})
2. [**Merge pull request**](${PR_URL})

\`\`\`bash
make cineforge-maintainer-deeplink OPEN=1   # 浏览器直达 Checks
make cineforge-unblock-card
\`\`\`

merge-watch daemon 后台等待 merge → 自动 \`verify-post-merge\`。

---
_Auto Company Cycle ${CYCLE} — issue-assign-nudge_
EOF
)

gh issue comment "$ISSUE" --repo "$UPSTREAM" --body "$BODY"

echo "OK: Issue #${ISSUE} nudge 已发布"
echo "$ISSUE_URL"
exit 0

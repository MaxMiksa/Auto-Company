#!/usr/bin/env bash
# 镜场 CineForge — 通过 GitHub 原生通知 nudge maintainer（非重复 handoff 评论）
# 用法：./projects/cineforge/scripts/merge-nudge.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19 REVIEWER=MaxMiksa CYCLE=24 DRY_RUN=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
REVIEWER="${REVIEWER:-MaxMiksa}"
CYCLE="${CYCLE:-24}"
DRY_RUN="${DRY_RUN:-0}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd gh

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

FORK_HEAD=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "== Merge Nudge（GitHub 原生通知）=="
echo "PR=$PR reviewer=$REVIEWER push-ready=$PUSH_READY head=$PR_HEAD@$FORK_HEAD"
echo

if [[ "$DRY_RUN" == "1" ]]; then
  echo "-- DRY_RUN — 将执行："
  echo "  gh pr edit --add-reviewer $REVIEWER"
  echo "  gh pr edit --add-assignee $REVIEWER"
  echo "  gh pr comment（@$REVIEWER 简短 ping）"
  exit 0
fi

# GitHub 原生通知：review request + assignee
if gh pr edit "$PR" --repo "$UPSTREAM" --add-reviewer "$REVIEWER" 2>/dev/null; then
  echo "OK: review 已请求 @$REVIEWER"
else
  echo "WARN: review 请求失败（可能已请求或无权限）— 继续 assign + comment"
fi

if gh pr edit "$PR" --repo "$UPSTREAM" --add-assignee "$REVIEWER" 2>/dev/null; then
  echo "OK: PR 已 assign @$REVIEWER"
else
  echo "WARN: assign 失败 — 继续 comment"
fi

BODY=$(cat <<EOF
@${REVIEWER} **编译轨 PR 就绪** — 本地 push-ready **${PUSH_READY}**，分支 \`${PR_HEAD}\` @ \`${FORK_HEAD}\`

需你 **2 步**（约 2 分钟）：
1. **Checks → Approve and run workflows**（解除 \`action_required\`）
2. **Merge pull request**

merge-watch daemon 已在后台等待 merge → 自动 \`verify-post-merge\`。

一屏摘要：\`make cineforge-unblock-card\`

---
_Auto Company Cycle ${CYCLE} — merge-nudge（GitHub 通知）_
EOF
)

gh pr comment "$PR" --repo "$UPSTREAM" --body "$BODY"

echo "OK: @${REVIEWER} nudge 已发布"
echo "$PR_URL"
exit 0

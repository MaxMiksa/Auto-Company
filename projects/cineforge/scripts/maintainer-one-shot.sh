#!/usr/bin/env bash
# 镜场 CineForge — Maintainer 一键简报（Cycle 28 pivot）
# 聚合：preflight + confidence pack + LaunchAgent/daemon + desktop nudge + deeplink
# 用法：./projects/cineforge/scripts/maintainer-one-shot.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19 ISSUE=17 CYCLE=28
#       OPEN=1 DIALOG=1 POST=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
ISSUE="${ISSUE:-17}"
CYCLE="${CYCLE:-28}"
OPEN="${OPEN:-0}"
DIALOG="${DIALOG:-0}"
POST="${POST:-1}"

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

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║     镜场 CineForge — Maintainer One-Shot（Cycle ${CYCLE}）          ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
echo "PR: https://github.com/${UPSTREAM}/pull/${PR}"
echo

# --- 1) PR 状态 ---
echo "━━ 1/5 PR 状态 ━━"
PR_JSON=$("${CF}/scripts/gh-retry.sh" pr view "$PR" --repo "$UPSTREAM" --json \
  state,mergeable,url,headRefName,headRefOid 2>/dev/null) \
  || die "无法读取 PR #$PR"

PR_STATE=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
PR_URL=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['url'])")
PR_HEAD=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['headRefName'])")
CHECKS_URL="${PR_URL}/checks"

echo "   state=${PR_STATE} url=${PR_URL}"

if [[ "$PR_STATE" == "MERGED" ]]; then
  echo
  echo "PR 已 merge — 运行 post-merge 验证:"
  echo "   make cineforge-verify-post-merge"
  RESTART=1 "${CF}/scripts/daemon-health.sh" >/dev/null 2>&1 || true
  exec "${CF}/scripts/verify-post-merge.sh"
fi
echo

# --- 2) confidence pack（含 push-ready） ---
echo "━━ 2/5 Merge Confidence Pack ━━"
CYCLE="$CYCLE" POST=0 "${CF}/scripts/merge-confidence-pack.sh" | sed 's/^/   /'
PUSH_READY=$(python3 -c "import json; print(json.load(open('${CF}/scripts/fixtures/merge-confidence.json'))['evidence']['push_ready'])" 2>/dev/null || echo "unknown")
VERDICT=$(python3 -c "import json; print(json.load(open('${CF}/scripts/fixtures/merge-confidence.json'))['verdict'])" 2>/dev/null || echo "unknown")
echo

# --- 3) merge-watch 自愈（LaunchAgent 优先） ---
echo "━━ 3/5 merge-watch（LaunchAgent 优先）━━"
LAUNCHAGENT="${CF}/scripts/merge-watch-launchagent.sh"
if [[ "$(uname -s)" == "Darwin" && -x "$LAUNCHAGENT" ]]; then
  if ! "$LAUNCHAGENT" 2>&1 | sed 's/^/   /'; then
    echo "   WARN: LaunchAgent 安装失败 — 回退 daemon-health"
    RESTART=1 "${CF}/scripts/daemon-health.sh" | sed 's/^/   /' || true
  fi
else
  RESTART=1 "${CF}/scripts/daemon-health.sh" | sed 's/^/   /'
fi
echo

# --- 4) desktop nudge ---
echo "━━ 4/5 macOS 桌面通知 ━━"
CYCLE="$CYCLE" DIALOG="$DIALOG" SOUND=1 "${CF}/scripts/maintainer-desktop-nudge.sh" | sed 's/^/   /'
echo

# --- 5) deeplink ---
echo "━━ 5/5 Maintainer 深链 ━━"
OPEN="$OPEN" "${CF}/scripts/maintainer-merge-deeplink.sh" | sed 's/^/   /'
echo

# --- Issue 简报 ---
ARTIFACT="${CF}/scripts/fixtures/merge-confidence.json"

BODY=$(cat <<EOF
## Cycle ${CYCLE} — Maintainer One-Shot（收敛规则 #5 pivot #11）

Agent 仍无法绕过 fork workflow 批准。本轮 ship **macOS LaunchAgent** 持久化 merge-watch（\`make cineforge-merge-watch-launchagent\`）— 解决 Cycle 27 nohup/disown 在 agent shell 退出后仍被杀的问题；一键简报继续聚合 preflight + 证据包 + LaunchAgent 自愈 + 桌面通知 + 深链。

### 快照
| 项 | 值 |
|---|---|
| PR | [#${PR}](${PR_URL}) \`${PR_STATE}\` |
| 分支 | \`${PR_HEAD}\` |
| push-ready | **${PUSH_READY}** |
| **verdict** | **${VERDICT}** |

### MaxMiksa — 2 步合并（约 2 分钟）
1. [**Checks → Approve and run workflows**](${CHECKS_URL})
2. [**Merge pull request**](${PR_URL})

\`\`\`bash
make cineforge-merge-watch-launchagent   # 推荐：LaunchAgent 跨 session 存活
make cineforge-maintainer-one-shot OPEN=1 DIALOG=1   # 一键简报 + 浏览器 + 对话框
make cineforge-unblock-card                         # 人类行动卡
\`\`\`

证据包：\`projects/cineforge/scripts/fixtures/merge-confidence.json\`

---
_Auto Company Cycle ${CYCLE} — maintainer-one-shot + LaunchAgent_
EOF
)

if [[ "$POST" == "1" ]]; then
  "${CF}/scripts/gh-retry.sh" issue comment "$ISSUE" --repo "$UPSTREAM" --body "$BODY"
  echo "OK: Issue #${ISSUE} 已发布 Cycle ${CYCLE} one-shot 简报"
  echo "https://github.com/${UPSTREAM}/issues/${ISSUE}"
else
  echo "SKIP: POST=0 — 未发布 Issue 评论"
fi

echo
echo "== One-Shot 完成 =="
echo "verdict=${VERDICT}"
echo "artifact=${ARTIFACT}"
echo
echo "MaxMiksa 2 步:"
echo "  1. ${CHECKS_URL}"
echo "  2. ${PR_URL}"
exit 0

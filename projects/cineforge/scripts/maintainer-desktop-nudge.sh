#!/usr/bin/env bash
# 镜场 CineForge — macOS 桌面通知 nudge（非 GitHub 通道）
# 用法：./projects/cineforge/scripts/maintainer-desktop-nudge.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19 CYCLE=26 DIALOG=1 SOUND=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
CYCLE="${CYCLE:-26}"
DIALOG="${DIALOG:-0}"
SOUND="${SOUND:-1}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd gh

PR_JSON=$(gh pr view "$PR" --repo "$UPSTREAM" --json state,url 2>/dev/null) \
  || die "无法读取 PR #$PR"

PR_STATE=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
PR_URL=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['url'])")

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

CHECKS_URL="${PR_URL}/checks"
NOTIFY_MSG="镜场 PR #${PR} 待 merge — push-ready=${PUSH_READY}。Checks → Approve → Merge"

echo "== Maintainer Desktop Nudge (Cycle ${CYCLE}) =="
echo "PR=${PR_URL}"
echo "push-ready=${PUSH_READY}"
echo "checks=${CHECKS_URL}"
echo

if ! command -v osascript >/dev/null 2>&1; then
  echo "WARN: 非 macOS 或无 osascript — 跳过桌面通知"
  echo "NOTIFY: $NOTIFY_MSG"
  exit 0
fi

SOUND_OPT=""
if [[ "$SOUND" == "1" ]]; then
  SOUND_OPT=' sound name "Ping"'
fi

osascript -e "display notification \"${NOTIFY_MSG}\" with title \"镜场 CineForge — Cycle ${CYCLE}\"${SOUND_OPT}" \
  2>/dev/null && echo "OK: macOS 通知已发送" || echo "WARN: 通知发送失败"

if [[ "$DIALOG" == "1" ]]; then
  osascript <<EOF 2>/dev/null || true
display dialog "镜场 PR #${PR} 待 MaxMiksa merge（约 2 分钟）:

1. Checks → Approve and run workflows
2. Merge pull request

push-ready: ${PUSH_READY}
Cycle: ${CYCLE}" with title "镜场 CineForge Unblock" buttons {"打开 Checks", "稍后"} default button 1
if button returned of result is "打开 Checks" then
  open location "${CHECKS_URL}"
end if
EOF
  echo "OK: 对话框已显示"
fi

echo
echo "深链: make cineforge-maintainer-deeplink OPEN=1"
exit 0

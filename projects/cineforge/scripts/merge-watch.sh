#!/usr/bin/env bash
# 镜场 CineForge — 轮询 PR 直至 merge，自动跑 post-merge 验证
# 用法：./projects/cineforge/scripts/merge-watch.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19 POLL_SEC=60 MAX_WAIT=86400 DRY_RUN=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
POLL_SEC="${POLL_SEC:-60}"
MAX_WAIT="${MAX_WAIT:-86400}"
DRY_RUN="${DRY_RUN:-0}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd gh

echo "== 镜场 Merge Watch =="
echo "UPSTREAM=$UPSTREAM PR=$PR POLL_SEC=$POLL_SEC MAX_WAIT=$MAX_WAIT"
echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
echo

PR_URL=$(gh pr view "$PR" --repo "$UPSTREAM" --json url -q .url 2>/dev/null) \
  || die "无法读取 PR #$PR"
echo "PR: $PR_URL"
echo

STATE=$(gh pr view "$PR" --repo "$UPSTREAM" --json state -q .state)

if [[ "$STATE" == "MERGED" ]]; then
  echo "PR 已 merge — 直接跑 post-merge 验证"
  notify_msg="镜场 PR #${PR} 已 merge — 正在跑 post-merge 验证"
  echo "NOTIFY: $notify_msg"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"${notify_msg}\" with title \"镜场 CineForge\" sound name \"Glass\"" 2>/dev/null || true
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY_RUN: 将执行 verify-post-merge.sh"
    exit 0
  fi
  exec "${CF}/scripts/verify-post-merge.sh"
fi

if [[ "$STATE" != "OPEN" ]]; then
  die "PR state=$STATE（非 OPEN/MERGED）"
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN: PR state=OPEN — watch 脚本就绪，不进入轮询"
  exit 0
fi

echo "等待 MaxMiksa merge（Ctrl+C 退出）..."
echo "  1. $PR_URL → Checks → Approve and run workflows"
echo "  2. Merge pull request"
echo

elapsed=0
while [[ "$elapsed" -le "$MAX_WAIT" ]]; do
  STATE=""
  if ! STATE=$(gh pr view "$PR" --repo "$UPSTREAM" --json state -q .state 2>/dev/null); then
    echo "   $(date '+%H:%M:%S') gh 暂不可用 — 重试 (${elapsed}s / ${MAX_WAIT}s)"
    sleep "$POLL_SEC"
    elapsed=$((elapsed + POLL_SEC))
    continue
  fi

  if [[ "$STATE" == "MERGED" ]]; then
    echo
    echo "== PR 已 merge @ $(date '+%H:%M:%S') =="
    notify_msg="镜场 PR #${PR} 已 merge — 正在跑 post-merge 验证"
    echo "NOTIFY: $notify_msg"
    if command -v osascript >/dev/null 2>&1; then
      osascript -e "display notification \"${notify_msg}\" with title \"镜场 CineForge\" sound name \"Glass\"" 2>/dev/null || true
    fi
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "DRY_RUN: 将执行 verify-post-merge.sh"
      exit 0
    fi
    exec "${CF}/scripts/verify-post-merge.sh"
  fi

  if [[ "$STATE" != "OPEN" ]]; then
    die "PR 变为 state=$STATE"
  fi

  echo "   $(date '+%H:%M:%S') state=OPEN — 继续等待 (${elapsed}s / ${MAX_WAIT}s)"
  sleep "$POLL_SEC"
  elapsed=$((elapsed + POLL_SEC))
done

die "超时 ${MAX_WAIT}s — PR 仍未 merge"

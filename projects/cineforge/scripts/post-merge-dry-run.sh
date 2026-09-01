#!/usr/bin/env bash
# 镜场 CineForge — merge 前验证 post-merge 自动化就绪（无需 PR 已 merge）
# 用法：./projects/cineforge/scripts/post-merge-dry-run.sh
# exit 0=automation ready, 1=script fail, 2=PR already merged (run verify instead)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
WORKFLOW="${WORKFLOW:-cineforge-compile-gate}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd gh

echo "== Post-Merge Dry-Run（自动化就绪检查）=="
echo "UPSTREAM=$UPSTREAM PR=$PR"
echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
echo

PASS=0
FAIL=0
WARN=0

check_ok() {
  echo "   OK $*"
  PASS=$((PASS + 1))
}

check_fail() {
  echo "   FAIL $*"
  FAIL=$((FAIL + 1))
}

check_warn() {
  echo "   WARN $*"
  WARN=$((WARN + 1))
}

# 1) PR 状态
PR_STATE=$(gh pr view "$PR" --repo "$UPSTREAM" --json state -q .state 2>/dev/null) \
  || die "无法读取 PR #$PR"

if [[ "$PR_STATE" == "MERGED" ]]; then
  echo "PR 已 merge — 直接跑: make cineforge-verify-post-merge"
  exit 2
fi

if [[ "$PR_STATE" == "OPEN" ]]; then
  check_ok "PR #$PR state=OPEN（等待 merge）"
else
  check_fail "PR state=$PR_STATE"
fi

# 2) 本地 push-ready
if "${CF}/scripts/accept-push-ready.sh" >/dev/null 2>&1; then
  check_ok "push-ready PASS"
else
  check_fail "push-ready FAIL"
fi

# 3) verify-post-merge 脚本
if [[ -x "${CF}/scripts/verify-post-merge.sh" ]]; then
  check_ok "verify-post-merge.sh 可执行"
else
  check_fail "verify-post-merge.sh 缺失或不可执行"
fi

# 4) merge-watch daemon
PIDFILE="/tmp/cineforge-merge-watch.pid"
if [[ -f "$PIDFILE" ]]; then
  pid=$(cat "$PIDFILE" 2>/dev/null || true)
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    check_ok "merge-watch daemon alive (pid=$pid)"
  else
    check_warn "daemon pidfile stale — make cineforge-daemon-health 可自愈"
  fi
else
  check_warn "merge-watch daemon 未运行 — make cineforge-daemon-health"
fi

# 5) upstream workflow 文件（PR 内，merge 后生效）
if gh workflow view "$WORKFLOW" --repo "$UPSTREAM" >/dev/null 2>&1; then
  check_ok "upstream 已有 workflow: $WORKFLOW"
else
  check_warn "upstream main 尚无 $WORKFLOW（merge 后首次出现 — 预期）"
fi

# 6) macOS 通知能力
if command -v osascript >/dev/null 2>&1; then
  check_ok "macOS notify 可用（merge 时 osascript 提醒）"
else
  check_warn "无 osascript — merge 仅 log 通知"
fi

echo
echo "== Dry-Run 汇总 =="
echo "PASS=$PASS WARN=$WARN FAIL=$FAIL"

if [[ "$FAIL" -gt 0 ]]; then
  echo "NOT READY — 修复 FAIL 项后再等 merge"
  exit 1
fi

echo "READY: merge 后 daemon 将自动 verify；或手动 make cineforge-verify-post-merge"
exit 0

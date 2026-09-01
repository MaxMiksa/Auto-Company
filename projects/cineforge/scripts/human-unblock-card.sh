#!/usr/bin/env bash
# 镜场 CineForge — 人类 unblock 行动卡（双轨一屏摘要）
# 用法：./projects/cineforge/scripts/human-unblock-card.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "FAIL: 缺少命令: $1" >&2; exit 1; }
}

need_cmd gh
need_cmd python3

PR_URL=$(gh pr view "$PR" --repo "$UPSTREAM" --json url -q .url 2>/dev/null) \
  || { echo "FAIL: 无法读取 PR #$PR" >&2; exit 1; }

PR_STATE=$(gh pr view "$PR" --repo "$UPSTREAM" --json state -q .state)

PUSH_READY="FAIL"
if "${CF}/scripts/accept-push-ready.sh" >/dev/null 2>&1; then
  PUSH_READY="PASS"
fi

RENDER_BLOCKED=0
RENDER_SUMMARY="READY"
if ! "${CF}/scripts/render-track-preflight.sh" >/dev/null 2>&1; then
  RENDER_BLOCKED=1
  RENDER_SUMMARY="BLOCKED (Key/Omni)"
fi

COMPILE_STATUS="⛔ 待 merge"
if [[ "$PR_STATE" == "MERGED" ]]; then
  COMPILE_STATUS="✅ 已 merge"
fi

DAEMON_STATUS="DEAD"
PIDFILE="/tmp/cineforge-merge-watch.pid"
if [[ -f "$PIDFILE" ]]; then
  dp=$(cat "$PIDFILE" 2>/dev/null || true)
  if [[ -n "$dp" ]] && kill -0 "$dp" 2>/dev/null; then
    DAEMON_STATUS="alive (pid=$dp)"
  fi
fi

cat <<EOF
╔══════════════════════════════════════════════════════════════════╗
║          镜场 CineForge — 人类 Unblock 行动卡                    ║
╚══════════════════════════════════════════════════════════════════╝
时间: $(date '+%Y-%m-%d %H:%M %z')

━━ 编译轨（约 2 分钟）━━
  状态: ${COMPILE_STATUS}
  PR:   ${PR_URL}
  本地 push-ready: ${PUSH_READY}

  MaxMiksa 两步:
    1. PR → Checks → Approve and run workflows
    2. cineforge-compile-gate 绿 → Merge pull request

  深链直达:            make cineforge-maintainer-deeplink OPEN=1
  一键简报:            make cineforge-maintainer-one-shot OPEN=1 DIALOG=1
  证据包:              make cineforge-merge-confidence
  桌面通知:            make cineforge-desktop-nudge DIALOG=1
  Agent nudge:         make cineforge-issue-nudge
                       make cineforge-merge-nudge

━━ 成片轨（并行，约 5 分钟）━━
  状态: ${RENDER_SUMMARY}

  任选其一:
    A) export SEEDANCE_API_KEY
       ${CF}/scripts/inject-seedance-key.sh
       ${CF}/scripts/accept-first-render.sh

    B) GitHub → Settings → Secrets → SEEDANCE_API_KEY
       → 手动触发 cineforge-render-gate workflow

    C) 恢复 Omni: curl http://127.0.0.1:8092/health

━━ Merge 后自动验证 ━━
  merge-watch daemon: ${DAEMON_STATUS}
  推荐持久化:        make cineforge-merge-watch-launchagent
                       （macOS LaunchAgent，跨 session 存活；替代 Terminal 手动跑 daemon）
  健康检查/重启:      make cineforge-daemon-health
  手动验证:           make cineforge-verify-post-merge
  双轨仪表盘:         make cineforge-blockers

Issue: https://github.com/${UPSTREAM}/issues/17
EOF

# exit code: 0=双轨就绪, 2=仍有 blocker
if [[ "$PR_STATE" != "MERGED" || "$RENDER_BLOCKED" -ne 0 ]]; then
  exit 2
fi
exit 0

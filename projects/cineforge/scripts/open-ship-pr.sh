#!/usr/bin/env bash
# 镜场 CineForge — 一键开 PR 入库（validate → branch → commit → push → gh pr create）
# 用法：仓库根目录 ./projects/cineforge/scripts/open-ship-pr.sh
# 可选：DRY_RUN=1 只打印；BRANCH=ship/cineforge-compile-track；REQUIRE_PASS=1 先跑 push-ready
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
BRANCH="${BRANCH:-ship/cineforge-compile-track}"
DRY_RUN="${DRY_RUN:-0}"
REQUIRE_PASS="${REQUIRE_PASS:-1}"
BASE_BRANCH="${BASE_BRANCH:-main}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd git
need_cmd gh

# shellcheck source=ship-paths.sh
source "${CF}/scripts/ship-paths.sh"

cd "$ROOT"

echo "== 镜场一键开 PR =="
echo "ROOT=$ROOT BRANCH=$BRANCH BASE=$BASE_BRANCH REQUIRE_PASS=$REQUIRE_PASS DRY_RUN=$DRY_RUN"
echo

if [[ "$REQUIRE_PASS" == "1" ]]; then
  echo "-- push-ready 验收"
  "${CF}/scripts/accept-push-ready.sh"
  echo
fi

PENDING=()
while IFS= read -r line; do
  [[ -n "$line" ]] && PENDING+=("$line")
done < <(cineforge_collect_pending "$ROOT")

if [[ ${#PENDING[@]} -eq 0 ]]; then
  die "无待入库变更 — 可能已 commit 或路径不对。运行 git status 确认。"
fi

echo "-- 待入库路径（${#PENDING[@]}）"
printf '  %s\n' "${PENDING[@]}"
echo

COMMIT_MSG='feat(cineforge): ship compile-track CI, ops tooling, and landing

Unlock GitHub compile gate and local push-ready validation.
Render track remains manual (Seedance key / Omni).'

PR_BODY=$(cat <<EOF
## Summary

- Ship CineForge compile track: landing, studio shell, CI gate workflows, ops scripts
- Local \`make cineforge-push-ready\` PASS before opening this PR
- Render track remains manual (Seedance key / Omni)

## Test plan

- [ ] GitHub Actions \`cineforge-compile-gate\` green on this PR
- [ ] （可选）配置 \`SEEDANCE_API_KEY\` 后手动触发 \`cineforge-render-gate\`

---
_Auto Company — opened via \`make cineforge-ship-pr\` / \`open-ship-pr.sh\`._
EOF
)

run_or_print() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY_RUN: $*"
  else
    "$@"
  fi
}

if [[ "$DRY_RUN" == "1" ]]; then
  echo "-- 将执行："
  echo "  git checkout -B $BRANCH $BASE_BRANCH"
  echo "  git add <manifest ${#CINEFORGE_SHIP_PATHS[@]} 项>"
  echo "  git commit -m \"...\""
  echo "  git push -u origin $BRANCH"
  echo "  gh pr create --base $BASE_BRANCH --head $BRANCH ..."
  echo
  echo "== DRY_RUN OK — 未修改 git 状态 =="
  exit 0
fi

# 权限探测（best-effort）
PERM=$(gh repo view --json viewerPermission --jq .viewerPermission 2>/dev/null || echo "UNKNOWN")
if [[ "$PERM" == "READ" ]]; then
  echo "WARN: gh 账号对仓库仅有 READ 权限，push/pr 可能失败。"
  echo "      请使用有 write/maintain/admin 权限的账号，或运行："
  echo "        make cineforge-ship-pr-fork"
  echo
fi

CURRENT=$(git branch --show-current)
if [[ "$CURRENT" != "$BRANCH" ]]; then
  echo "-- checkout -B $BRANCH"
  git checkout -B "$BRANCH" "$BASE_BRANCH"
fi

echo "-- git add manifest"
git add "${CINEFORGE_SHIP_PATHS[@]}"

echo "-- git commit"
git commit -m "$COMMIT_MSG"

echo "-- git push"
git push -u origin "$BRANCH"

echo "-- gh pr create"
PR_URL=$(gh pr create \
  --base "$BASE_BRANCH" \
  --head "$BRANCH" \
  --title "feat(cineforge): ship compile-track CI, ops tooling, and landing" \
  --body "$PR_BODY")

echo
echo "== OK: PR 已创建 =="
echo "$PR_URL"
echo
echo "下一步：Review + Merge → GitHub Actions cineforge-compile-gate 将在 main 上运行。"

#!/usr/bin/env bash
# 镜场 CineForge — Fork 一键开 PR（READ 权限账号可用）
# validate → fork → branch → commit → push fork → gh pr create (upstream)
# 用法：仓库根目录 ./projects/cineforge/scripts/open-ship-pr-fork.sh
# 可选：DRY_RUN=1；BRANCH=ship/cineforge-compile-track；REQUIRE_PASS=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
BRANCH="${BRANCH:-ship/cineforge-compile-track}"
DRY_RUN="${DRY_RUN:-0}"
REQUIRE_PASS="${REQUIRE_PASS:-1}"
BASE_BRANCH="${BASE_BRANCH:-main}"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
FORK_REMOTE="${FORK_REMOTE:-fork}"

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

FORK_OWNER=$(gh api user -q .login 2>/dev/null || echo "")
[[ -n "$FORK_OWNER" ]] || die "无法获取 gh 当前用户"
FORK_REPO="${FORK_OWNER}/Auto-Company"

echo "== 镜场 Fork 一键开 PR =="
echo "ROOT=$ROOT UPSTREAM=$UPSTREAM FORK=$FORK_REPO"
echo "BRANCH=$BRANCH BASE=$BASE_BRANCH REQUIRE_PASS=$REQUIRE_PASS DRY_RUN=$DRY_RUN"
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
- Opened from fork \`${FORK_REPO}\` (agent READ-only on upstream)

## Test plan

- [ ] GitHub Actions \`cineforge-compile-gate\` green on this PR
- [ ] （可选）配置 \`SEEDANCE_API_KEY\` 后手动触发 \`cineforge-render-gate\`

---
_Auto Company — opened via \`make cineforge-ship-pr-fork\` / \`open-ship-pr-fork.sh\`._
EOF
)

if [[ "$DRY_RUN" == "1" ]]; then
  echo "-- 将执行："
  echo "  gh repo fork $UPSTREAM --remote=false  # 若 fork 不存在"
  echo "  git remote add $FORK_REMOTE https://github.com/${FORK_REPO}.git  # 若缺失"
  echo "  git checkout -B $BRANCH $BASE_BRANCH"
  echo "  git add <manifest ${#CINEFORGE_SHIP_PATHS[@]} 项>"
  echo "  git commit -m \"...\""
  echo "  git push -u $FORK_REMOTE $BRANCH"
  echo "  gh pr create --repo $UPSTREAM --base $BASE_BRANCH --head ${FORK_OWNER}:${BRANCH} ..."
  echo
  echo "== DRY_RUN OK — 未修改 git 状态 =="
  exit 0
fi

# --- ensure fork exists ---
if ! gh repo view "$FORK_REPO" >/dev/null 2>&1; then
  echo "-- gh repo fork $UPSTREAM"
  gh repo fork "$UPSTREAM" --remote=false --fork-name Auto-Company
else
  echo "-- fork 已存在: https://github.com/${FORK_REPO}"
fi

# --- ensure fork remote ---
FORK_URL="git@github.com:${FORK_REPO}.git"
if git remote get-url "$FORK_REMOTE" >/dev/null 2>&1; then
  echo "-- remote $FORK_REMOTE 已存在"
  git remote set-url "$FORK_REMOTE" "$FORK_URL"
else
  echo "-- git remote add $FORK_REMOTE"
  git remote add "$FORK_REMOTE" "$FORK_URL"
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

echo "-- git push to fork ($FORK_REMOTE)"
git push -u "$FORK_REMOTE" "$BRANCH"

echo "-- gh pr create (upstream)"
PR_URL=$(gh pr create \
  --repo "$UPSTREAM" \
  --base "$BASE_BRANCH" \
  --head "${FORK_OWNER}:${BRANCH}" \
  --title "feat(cineforge): ship compile-track CI, ops tooling, and landing" \
  --body "$PR_BODY")

echo
echo "== OK: Fork PR 已创建 =="
echo "$PR_URL"
echo
echo "下一步：MaxMiksa Review + Merge → cineforge-compile-gate 将在 main 上运行。"

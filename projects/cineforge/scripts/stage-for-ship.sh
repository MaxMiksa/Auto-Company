#!/usr/bin/env bash
# 镜场 CineForge — 一键 git add 完整入库清单（人类仍须 commit/push）
# 用法：仓库根目录 ./projects/cineforge/scripts/stage-for-ship.sh
# 可选：REQUIRE_PASS=0 跳过 push-ready；DRY_RUN=1 只打印不 stage
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
REQUIRE_PASS="${REQUIRE_PASS:-1}"
DRY_RUN="${DRY_RUN:-0}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd git

# shellcheck source=ship-paths.sh
source "${CF}/scripts/ship-paths.sh"

cd "$ROOT"

echo "== 镜场一键 staging =="
echo "ROOT=$ROOT REQUIRE_PASS=$REQUIRE_PASS DRY_RUN=$DRY_RUN"
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
  echo "WARN: 无待入库变更（可能已 commit 或路径不对）"
  exit 0
fi

echo "-- 待 stage 路径（${#PENDING[@]}）"
printf '  %s\n' "${PENDING[@]}"
echo

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN=1 — 未执行 git add"
  cineforge_print_git_add_block "  "
  exit 0
fi

git add "${CINEFORGE_SHIP_PATHS[@]}"

echo "-- staged 摘要"
git diff --cached --stat -- "${CINEFORGE_SHIP_PATHS[@]}"
echo
echo "== OK: 已 stage 完整入库清单 =="
echo
echo "人类下一步（二选一）："
echo
echo "  A) 一键开 PR：  make cineforge-ship-pr"
echo "  B) 手动入库："
echo
cat <<'INSTRUCTIONS'
git commit -m "$(cat <<'EOF'
feat(cineforge): ship compile-track CI, ops tooling, and landing

Unlock GitHub compile gate and local push-ready validation.
Render track remains manual (Seedance key / Omni).
EOF
)"

git push origin main
INSTRUCTIONS
echo
echo "推送后 GitHub Actions「cineforge-compile-gate」将在 main/PR 上自动运行。"

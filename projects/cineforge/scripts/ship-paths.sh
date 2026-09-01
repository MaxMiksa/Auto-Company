#!/usr/bin/env bash
# 镜场 CineForge — 编译轨入库路径清单（单一来源）
# 被 accept-push-ready / create-handoff-issue / stage-for-ship 共用
set -euo pipefail

# shellcheck disable=SC2034
CINEFORGE_SHIP_PATHS=(
  "projects/cineforge/"
  ".github/workflows/cineforge-compile-gate.yml"
  ".github/workflows/cineforge-render-gate.yml"
  ".github/ISSUE_TEMPLATE/cineforge-ship-handoff.yml"
  "Makefile"
  ".gitignore"
)

cineforge_collect_pending() {
  local root="$1"
  git -C "$root" status --porcelain -- "${CINEFORGE_SHIP_PATHS[@]}" 2>/dev/null \
    | awk '{print $2}' | sort -u
}

cineforge_print_git_add_block() {
  local indent="${1:-}"
  local path
  local i=0
  local total=${#CINEFORGE_SHIP_PATHS[@]}
  printf '%sgit add \\\n' "$indent"
  for path in "${CINEFORGE_SHIP_PATHS[@]}"; do
    i=$((i + 1))
    if [[ "$i" -lt "$total" ]]; then
      printf '%s  %s \\\n' "$indent" "$path"
    else
      printf '%s  %s\n' "$indent" "$path"
    fi
  done
}

#!/usr/bin/env bash
# 镜场 CineForge — MaxMiksa 合并深链（浏览器直达 2 步操作）
# 用法：./projects/cineforge/scripts/maintainer-merge-deeplink.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19 OPEN=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
OPEN="${OPEN:-0}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd gh

PR_JSON=$(gh pr view "$PR" --repo "$UPSTREAM" --json state,url,headRefName 2>/dev/null) \
  || die "无法读取 PR #$PR"

PR_STATE=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
PR_URL=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['url'])")
PR_HEAD=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['headRefName'])")

if [[ "$PR_STATE" == "MERGED" ]]; then
  echo "PR 已 merge — 改跑: make cineforge-verify-post-merge"
  exit 0
fi

CHECKS_URL="${PR_URL}/checks"
FILES_URL="${PR_URL}/files"
ISSUE_URL="https://github.com/${UPSTREAM}/issues/17"

echo "== Maintainer Merge Deeplink =="
echo "PR=#${PR} branch=${PR_HEAD} state=${PR_STATE}"
echo
echo "步骤 1 — 批准 fork workflow（Checks 标签）:"
echo "  ${CHECKS_URL}"
echo
echo "步骤 2 — Merge pull request（PR 主页）:"
echo "  ${PR_URL}"
echo
echo "追踪 Issue:"
echo "  ${ISSUE_URL}"
echo
echo "变更预览:"
echo "  ${FILES_URL}"
echo

if [[ "$OPEN" == "1" ]]; then
  if command -v open >/dev/null 2>&1; then
    open "$CHECKS_URL"
    echo "OK: 已在浏览器打开 Checks 页"
  else
    echo "WARN: 无 open 命令 — 请手动访问上方 URL"
  fi
fi

exit 0

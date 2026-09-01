#!/usr/bin/env bash
# 镜场 CineForge — PR merge 后验证 compile gate 是否在 main 上绿
# 用法：./projects/cineforge/scripts/verify-post-merge.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19 WORKFLOW=cineforge-compile-gate POLL_SEC=30 MAX_WAIT=900
set -euo pipefail

UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
WORKFLOW="${WORKFLOW:-cineforge-compile-gate}"
POLL_SEC="${POLL_SEC:-30}"
MAX_WAIT="${MAX_WAIT:-900}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd gh

echo "== 镜场 Post-Merge 验证 =="
echo "UPSTREAM=$UPSTREAM PR=$PR WORKFLOW=$WORKFLOW"
echo

PR_STATE=$(gh pr view "$PR" --repo "$UPSTREAM" --json state,mergedAt,url -q '.state + "|" + (.mergedAt // "") + "|" + .url')
IFS='|' read -r STATE MERGED_AT PR_URL <<< "$PR_STATE"

echo "-- PR #$PR"
echo "   url=$PR_URL"
echo "   state=$STATE mergedAt=${MERGED_AT:-n/a}"

if [[ "$STATE" != "MERGED" ]]; then
  echo
  echo "WAIT: PR 尚未 merge — MaxMiksa 需 Review + Merge 后再跑本脚本。"
  echo "      https://github.com/${UPSTREAM}/pull/${PR}"
  exit 2
fi

echo
echo "-- 查找 main 上最新 $WORKFLOW run"

if ! gh workflow view "$WORKFLOW" --repo "$UPSTREAM" >/dev/null 2>&1; then
  die "upstream main 上找不到 workflow: $WORKFLOW（merge 可能未包含 workflow 文件）"
fi

elapsed=0
RUN_ID=""
while [[ "$elapsed" -le "$MAX_WAIT" ]]; do
  RUN_JSON=$(gh run list \
    --repo "$UPSTREAM" \
    --workflow="$WORKFLOW" \
    --branch=main \
    --limit=1 \
    --json databaseId,status,conclusion,createdAt,url 2>/dev/null || echo "[]")

  RUN_ID=$(echo "$RUN_JSON" | python3 -c "
import json, sys
rows = json.load(sys.stdin)
print(rows[0]['databaseId'] if rows else '')
" 2>/dev/null || echo "")

  if [[ -n "$RUN_ID" ]]; then
    CREATED=$(echo "$RUN_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['createdAt'])")
    if [[ -n "$MERGED_AT" && "$CREATED" > "$MERGED_AT" ]] || [[ -z "$MERGED_AT" ]]; then
      break
    fi
  fi

  if [[ "$elapsed" -ge "$MAX_WAIT" ]]; then
    die "超时 ${MAX_WAIT}s — merge 后未见新的 $WORKFLOW run"
  fi

  echo "   等待 workflow run... (${elapsed}s)"
  sleep "$POLL_SEC"
  elapsed=$((elapsed + POLL_SEC))
done

RUN_URL=$(echo "$RUN_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['url'])")
echo "   run=$RUN_ID url=$RUN_URL"

echo
echo "-- 等待 run 完成"
if gh run watch "$RUN_ID" --repo "$UPSTREAM" --exit-status; then
  echo
  echo "== PASS: $WORKFLOW 在 main 上绿 =="
  echo "$RUN_URL"
  exit 0
fi

echo
echo "== FAIL: $WORKFLOW 失败 =="
echo "$RUN_URL"
exit 1

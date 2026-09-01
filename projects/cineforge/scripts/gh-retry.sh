#!/usr/bin/env bash
# 镜场 CineForge — gh 命令重试（应对 rate limit / 瞬时网络失败）
# 用法：./projects/cineforge/scripts/gh-retry.sh <gh-args...>
# 可选：GH_RETRY=3 GH_RETRY_DELAY=2
set -euo pipefail

RETRIES="${GH_RETRY:-3}"
DELAY="${GH_RETRY_DELAY:-2}"

attempt=1
while [[ "$attempt" -le "$RETRIES" ]]; do
  if gh "$@"; then
    exit 0
  fi
  if [[ "$attempt" -eq "$RETRIES" ]]; then
    exit 1
  fi
  echo "WARN: gh 失败 — ${DELAY}s 后重试 (${attempt}/${RETRIES})" >&2
  sleep "$DELAY"
  attempt=$((attempt + 1))
done

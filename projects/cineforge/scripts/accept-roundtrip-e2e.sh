#!/usr/bin/env bash
# 镜场 CineForge — 编译轨 export→import Playwright E2E（不依赖成片 Key / Omni）
# 成功定义：fixture 导入 PASS + 编译→下载→重载→导入 round-trip PASS
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${ROOT}/app"
BASE="${CINEFORGE_BASE:-http://127.0.0.1:3200}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd curl
need_cmd npm

echo "== 镜场编译轨 round-trip E2E =="
echo "BASE=$BASE"

echo "-- 0) 前置：shell 验收"
"${ROOT}/scripts/accept-import-compile.sh" || die "导入 fixture 验收未通过"

echo "-- 1) 健康检查"
code="$(curl -sS -o /dev/null -w '%{http_code}' -m 5 "${BASE}/api/health" || echo 000)"
[[ "$code" == "200" ]] || die "服务不可达 ${BASE}（请先 npm start）"

echo "-- 2) Playwright E2E"
cd "$APP"
npm install --no-audit --no-fund
npx playwright install chromium
CINEFORGE_BASE="$BASE" npm run test:e2e

echo "PASS"
echo "编译轨双向交付 + 浏览器 round-trip 自动化验收通过"
exit 0

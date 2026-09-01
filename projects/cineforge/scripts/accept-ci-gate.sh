#!/usr/bin/env bash
# 镜场 CineForge — 编译轨 CI 全门禁（不依赖成片 Key / Omni）
# 成功定义：fixture → pipeline → export → Playwright round-trip 全 PASS
# 用法：本地或 GitHub Actions 均可；CI 中由 workflow 预先 npm ci + playwright install
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${ROOT}/app"
BASE="${CINEFORGE_BASE:-http://127.0.0.1:3200}"
START_SERVER="${START_SERVER:-auto}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd curl
need_cmd npm

SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

wait_for_server() {
  local i
  for i in $(seq 1 60); do
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' -m 5 "${BASE}/api/health" 2>/dev/null || echo 000)"
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

ensure_server() {
  if curl -sf "${BASE}/api/health" >/dev/null 2>&1; then
    echo "OK 服务已在跑: $BASE"
    return 0
  fi
  if [[ "$START_SERVER" == "never" ]]; then
    die "服务不可达 ${BASE}（START_SERVER=never）"
  fi
  echo "-- 启动 dev server"
  cd "$APP"
  npm run start &
  SERVER_PID=$!
  wait_for_server || die "dev server 启动超时 (${BASE})"
  echo "OK dev server ready pid=$SERVER_PID"
}

echo "== 镜场编译轨 CI gate =="
echo "BASE=$BASE START_SERVER=$START_SERVER"

echo "-- 0) fixture 导入校验"
"${ROOT}/scripts/accept-import-compile.sh"

ensure_server

echo "-- 1) 编译通道"
"${ROOT}/scripts/accept-compile-pipeline.sh"

echo "-- 2) 导出包 schema"
"${ROOT}/scripts/accept-compile-export.sh"

echo "-- 3) Playwright round-trip E2E"
cd "$APP"
if [[ "${CI:-}" != "true" ]]; then
  npm install --no-audit --no-fund
  npx playwright install chromium
fi
CINEFORGE_BASE="$BASE" npm run test:e2e

echo "PASS"
echo "编译轨 CI gate 全通过（fixture + pipeline + export + E2E）"
exit 0

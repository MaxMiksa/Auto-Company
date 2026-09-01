#!/usr/bin/env bash
# 镜场 CineForge — waitlist API 验收（无需 Key / Omni）
# 成功定义：POST /api/waitlist → ok:true + id；条目写入 .data/waitlist.json
set -euo pipefail

BASE="${CINEFORGE_BASE:-http://127.0.0.1:3200}"
START_SERVER="${START_SERVER:-auto}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${ROOT}/app"
WAITLIST_FILE="${APP}/.data/waitlist.json"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd curl
need_cmd python3

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

echo "== 镜场 waitlist 验收 =="
echo "BASE=$BASE"

ensure_server

STAMP="$(date +%s)"
PAYLOAD="$(python3 -c "import json; print(json.dumps({'name':'验收用户','email':'accept-${STAMP}@cineforge.local','intent':'Cycle 11 waitlist smoke test'}))")"

echo "-- POST /api/waitlist"
RESP="$(curl -sS -m 20 -X POST "${BASE}/api/waitlist" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" || true)"
[[ -n "$RESP" ]] || die "无响应"

OK="$(printf '%s' "$RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("1" if d.get("ok") is True else "0")')"
ENTRY_ID="$(printf '%s' "$RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id") or "")')"
[[ "$OK" == "1" && -n "$ENTRY_ID" ]] || die "API 未返回 ok/id: $RESP"
echo "OK id=$ENTRY_ID"

echo "-- 校验落盘"
[[ -f "$WAITLIST_FILE" ]] || die "未找到 $WAITLIST_FILE"
python3 <<PY
import json, sys
path = "$WAITLIST_FILE"
entry_id = "$ENTRY_ID"
with open(path, encoding="utf-8") as f:
    data = json.load(f)
if not isinstance(data, list):
    sys.exit("waitlist.json 不是数组")
found = next((x for x in data if x.get("id") == entry_id), None)
if not found:
    sys.exit(f"未找到条目 id={entry_id}")
if found.get("email") != "accept-${STAMP}@cineforge.local":
    sys.exit("email 不匹配")
print(f"OK entries={len(data)} latest={entry_id}")
PY

echo "PASS"
echo "waitlist API 验收通过"
exit 0

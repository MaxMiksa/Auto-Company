#!/usr/bin/env bash
# 镜场 CineForge — 首成片验收（真任务 → 真落盘）
# 成功定义：/api/health writable=true → POST /api/jobs → 轮询至 succeeded → 本地 MP4
# 不 mock。探活绿灯 ≠ 本脚本成功。
set -euo pipefail

BASE="${CINEFORGE_BASE:-http://127.0.0.1:3200}"
POLL_SEC="${POLL_SEC:-8}"
MAX_POLLS="${MAX_POLLS:-45}"
START_SERVER="${START_SERVER:-auto}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${ROOT}/app"
UPLOAD_DIR="${ROOT}/app/.data/uploads"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd curl
need_cmd python3
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

echo "== 镜场首成片验收 =="
echo "BASE=$BASE START_SERVER=$START_SERVER"

ensure_server

echo "-- 1) health"
HEALTH_JSON="$(curl -sS -m 12 "${BASE}/api/health" || true)"
[[ -n "$HEALTH_JSON" ]] || die "无法读取 ${BASE}/api/health（应用是否在跑？）"

WRITABLE="$(printf '%s' "$HEALTH_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("1" if d.get("writable") is True else "0")')"
if [[ "$WRITABLE" != "1" ]]; then
  echo "$HEALTH_JSON" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_JSON"
  die "writable!==true。请注入 SEEDANCE_API_KEY/ARK_API_KEY 或恢复 Omni 后再跑。"
fi
echo "OK writable=true"

echo "-- 2) 提交真任务"
DRAFT_FILE="${ROOT}/scripts/fixtures/accept-draft.json"
[[ -f "$DRAFT_FILE" ]] || die "缺少验收草稿: $DRAFT_FILE"
DRAFT_JSON="$(python3 -c "import json; print(json.dumps({'draft': json.load(open('$DRAFT_FILE'))}))")"

JOB_JSON="$(curl -sS -m 120 -X POST "${BASE}/api/jobs" \
  -H "Content-Type: application/json" \
  -d "$DRAFT_JSON" || true)"
[[ -n "$JOB_JSON" ]] || die "POST /api/jobs 无响应"

JOB_ID="$(printf '%s' "$JOB_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id") or "")')"
JOB_STATUS="$(printf '%s' "$JOB_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("status") or "")')"
JOB_ERR="$(printf '%s' "$JOB_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("error") or "")')"
[[ -n "$JOB_ID" ]] || die "未返回 job id: $JOB_JSON"

echo "job=$JOB_ID status=$JOB_STATUS"
if [[ "$JOB_STATUS" == "failed" || "$JOB_STATUS" == "mocked" ]]; then
  die "提交即失败/mocked（禁止当验收通过）: ${JOB_ERR:-$JOB_JSON}"
fi

echo "-- 3) 轮询 PATCH /api/jobs（最多 ${MAX_POLLS} 次，间隔 ${POLL_SEC}s）"
FINAL_STATUS=""
VIDEO_URL=""
for i in $(seq 1 "$MAX_POLLS"); do
  sleep "$POLL_SEC"
  PATCH_JSON="$(curl -sS -m 60 -X PATCH "${BASE}/api/jobs" || true)"
  PARSE="$(printf '%s' "$PATCH_JSON" | python3 -c "
import json,sys
jid='$JOB_ID'
try:
  d=json.load(sys.stdin)
except Exception:
  print('ERR||'); sys.exit(0)
jobs=d.get('jobs') or []
job=next((j for j in jobs if j.get('id')==jid), None)
if not job:
  print('MISSING||'); sys.exit(0)
print(f\"{job.get('status') or ''}|{job.get('videoUrl') or ''}|{job.get('error') or ''}\")
")"
  FINAL_STATUS="${PARSE%%|*}"
  REST="${PARSE#*|}"
  VIDEO_URL="${REST%%|*}"
  ERR_MSG="${REST#*|}"
  echo "  poll $i/$MAX_POLLS → $FINAL_STATUS"
  if [[ "$FINAL_STATUS" == "succeeded" ]]; then
    break
  fi
  if [[ "$FINAL_STATUS" == "failed" || "$FINAL_STATUS" == "mocked" ]]; then
    die "任务失败/mocked: ${ERR_MSG:-$PATCH_JSON}"
  fi
done

[[ "$FINAL_STATUS" == "succeeded" ]] || die "超时未 succeeded（最后状态=$FINAL_STATUS）。可调高 MAX_POLLS/POLL_SEC。"

echo "-- 4) 校验落盘"
[[ -n "$VIDEO_URL" ]] || die "succeeded 但无 videoUrl"
# videoUrl 形如 /uploads/job-xxx.mp4
BASENAME="$(basename "$VIDEO_URL")"
FILE_PATH="${UPLOAD_DIR}/${BASENAME}"
[[ -f "$FILE_PATH" ]] || die "落盘文件不存在: $FILE_PATH（videoUrl=$VIDEO_URL）"
SIZE="$(wc -c < "$FILE_PATH" | tr -d ' ')"
[[ "$SIZE" -gt 1000 ]] || die "文件过小 (${SIZE} bytes)，疑似空片: $FILE_PATH"

echo "PASS"
echo "job_id=$JOB_ID"
echo "video_url=$VIDEO_URL"
echo "file=$FILE_PATH"
echo "bytes=$SIZE"
echo "人类下一步：打开 ${BASE}/studio 预览该成片并目视验收。"
exit 0

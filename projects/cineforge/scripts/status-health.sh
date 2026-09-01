#!/usr/bin/env bash
# 镜场 CineForge — 运行态探活摘要（运维/验收前快速查看）
set -euo pipefail

BASE="${CINEFORGE_BASE:-http://127.0.0.1:3200}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "FAIL: 缺少命令: $1" >&2
    exit 1
  }
}

need_cmd curl
need_cmd python3

RAW="$(curl -sS -m 12 "${BASE}/api/health" 2>/dev/null || true)"
if [[ -z "$RAW" ]]; then
  echo "FAIL: 无法连接 ${BASE}/api/health（应用是否在跑？）" >&2
  exit 1
fi

export BASE HEALTH_JSON="$RAW"
python3 <<'PY'
import json, os, sys

raw = os.environ.get("HEALTH_JSON", "")
try:
    d = json.loads(raw)
except Exception as e:
    print(f"FAIL: 无效 JSON: {e}", file=sys.stderr)
    sys.exit(1)

def yn(v):
    return "yes" if v is True else "no"

base = os.environ.get("BASE", "http://127.0.0.1:3200")
print("== 镜场运行态 ==")
print(f"BASE={base}")
print(f"brand={d.get('brand')}")
print(f"compileReady={yn(d.get('compileReady'))}")
print(f"writable={yn(d.get('writable'))}")
print(f"videoProvider={d.get('videoProvider')}")
print(f"llmProvider={d.get('llmProvider')}")

mm = d.get("minimax") or {}
sd = d.get("seedance") or {}
llm = d.get("llm") or {}
print(f"minimax.ok={yn(mm.get('ok'))} detail={mm.get('detail') or mm.get('status') or '-'}")
print(f"seedance.ready={yn(sd.get('ready'))} model={sd.get('model') or '-'}")
print(f"llm.ok={yn(llm.get('ok'))} detail={llm.get('detail') or '-'}")

if d.get("compileReady") is True and d.get("writable") is True:
    print("STATUS=ready-all")
elif d.get("compileReady") is True:
    print("STATUS=compile-only")
else:
    print("STATUS=degraded")
PY

#!/usr/bin/env bash
# 镜场 CineForge — waitlist 本地统计/导出（读 .data/waitlist.json，不上传）
# 用法：
#   ./waitlist-stats.sh              # 摘要
#   ./waitlist-stats.sh --json       # 完整 JSON 到 stdout
#   ./waitlist-stats.sh --csv        # CSV 到 stdout
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="${ROOT}/app/.data/waitlist.json"
MODE="${1:---summary}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "FAIL: 缺少命令: $1" >&2
    exit 1
  }
}

need_cmd python3

python3 <<PY
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

path = Path("$FILE")
mode = "$MODE"

if not path.is_file():
    if mode == "--summary":
        print("== 镜场 waitlist ==")
        print("entries=0")
        print("file=missing")
        sys.exit(0)
    print("[]" if mode == "--json" else "", end="")
    sys.exit(0)

with path.open(encoding="utf-8") as f:
    data = json.load(f)
if not isinstance(data, list):
    sys.exit("waitlist.json 格式错误：应为数组")

if mode == "--json":
    json.dump(data, sys.stdout, ensure_ascii=False, indent=2)
    print()
    sys.exit(0)

if mode == "--csv":
    w = csv.writer(sys.stdout)
    w.writerow(["id", "name", "email", "intent", "createdAt"])
    for row in data:
        w.writerow([
            row.get("id", ""),
            row.get("name", ""),
            row.get("email", ""),
            (row.get("intent") or "").replace("\n", " "),
            row.get("createdAt", ""),
        ])
    sys.exit(0)

if mode != "--summary":
    sys.exit(f"未知参数: {mode}（支持 --summary / --json / --csv）")

latest = data[0].get("createdAt") if data else "-"
print("== 镜场 waitlist ==")
print(f"entries={len(data)}")
print(f"file={path}")
print(f"latest={latest}")
if data:
    print("recent:")
    for row in data[:5]:
        email = row.get("email") or "-"
        created = row.get("createdAt") or "-"
        print(f"  - {created} {email}")
PY

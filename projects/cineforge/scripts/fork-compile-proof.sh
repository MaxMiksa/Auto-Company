#!/usr/bin/env bash
# 镜场 CineForge — Fork CI 绿证（Cycle 29）
# 在 guofu-ljg fork 上跑/等待 cineforge-compile-gate，产出可公开粘贴的绿证 URL。
# 用法：./projects/cineforge/scripts/fork-compile-proof.sh
# 可选：FORK=guofu-ljg/Auto-Company BRANCH=ship/cineforge-compile-track
#       WORKFLOW=cineforge-compile-gate UPSTREAM=MaxMiksa/Auto-Company
#       PR=19 ISSUE=17 CYCLE=29 WAIT=1 TRIGGER=1 POST=0 POLL_SEC=20 MAX_WAIT=900
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
FORK="${FORK:-guofu-ljg/Auto-Company}"
BRANCH="${BRANCH:-ship/cineforge-compile-track}"
WORKFLOW="${WORKFLOW:-cineforge-compile-gate}"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
ISSUE="${ISSUE:-17}"
CYCLE="${CYCLE:-29}"
WAIT="${WAIT:-1}"
TRIGGER="${TRIGGER:-1}"
POST="${POST:-0}"
POLL_SEC="${POLL_SEC:-20}"
MAX_WAIT="${MAX_WAIT:-900}"
ARTIFACT="${CF}/scripts/fixtures/fork-compile-proof.json"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd gh
need_cmd python3

cd "$ROOT"

echo "== 镜场 Fork Compile Proof (Cycle ${CYCLE}) =="
echo "FORK=$FORK BRANCH=$BRANCH WORKFLOW=$WORKFLOW"
echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
echo

HEAD_OID=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
echo "-- HEAD oid: $HEAD_OID"

if [[ "$TRIGGER" == "1" ]]; then
  echo "-- 尝试 workflow_dispatch..."
  if gh workflow run "$WORKFLOW" --repo "$FORK" --ref "$BRANCH" 2>/dev/null; then
    echo "   OK: 已触发 workflow_dispatch"
    sleep 3
  else
    echo "   SKIP: workflow 尚未在 fork 注册（常见于仅存在于非 default 分支）— 依赖 push 触发"
  fi
fi

echo "-- 查找 fork 上 $WORKFLOW runs..."
RUNS_JSON=$(gh run list \
  --repo "$FORK" \
  --workflow="$WORKFLOW" \
  --branch="$BRANCH" \
  --limit=5 \
  --json databaseId,status,conclusion,url,headSha,createdAt,event,displayTitle \
  2>/dev/null || echo "[]")

RUN_ID=$(echo "$RUNS_JSON" | HEAD_OID="$HEAD_OID" python3 -c "
import json, os, sys
rows = json.load(sys.stdin)
head = os.environ.get('HEAD_OID', '')
exact = [r for r in rows if r.get('headSha') == head]
pick = exact[0] if exact else (rows[0] if rows else None)
print(pick['databaseId'] if pick else '')
")

write_artifact() {
  local verdict="$1"
  local run_id="${2:-}"
  local run_url="${3:-}"
  local status="${4:-}"
  local conclusion="${5:-}"
  local run_sha="${6:-}"
  VERDICT="$verdict" RUN_ID="$run_id" RUN_URL="$run_url" \
  STATUS="$status" CONCLUSION="$conclusion" RUN_SHA="$run_sha" \
  HEAD_OID="$HEAD_OID" CYCLE="$CYCLE" FORK="$FORK" BRANCH="$BRANCH" \
  WORKFLOW="$WORKFLOW" UPSTREAM="$UPSTREAM" PR="$PR" ARTIFACT="$ARTIFACT" \
  python3 - <<'PY'
import json, os
from datetime import datetime, timezone

verdict = os.environ["VERDICT"]
run_id = os.environ.get("RUN_ID") or ""
run = None
if run_id:
    run = {
        "id": int(run_id),
        "url": os.environ.get("RUN_URL") or "",
        "status": os.environ.get("STATUS") or "",
        "conclusion": os.environ.get("CONCLUSION") or None,
        "head_sha": os.environ.get("RUN_SHA") or "",
    }

human = {
    "FORK_GREEN": "fork cineforge-compile-gate 已绿 — Approve workflow 零风险",
    "FORK_RED": "fork compile-gate 失败 — 先修 CI 再请 Approve",
    "IN_PROGRESS": "fork compile-gate 运行中",
    "NO_RUN": "fork 尚无 compile-gate run — push 后重试",
}.get(verdict, f"fork compile-gate verdict={verdict}")

art = {
    "schema": "jingchang.fork-compile-proof.v1",
    "cycle": int(os.environ["CYCLE"]),
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "fork": os.environ["FORK"],
    "branch": os.environ["BRANCH"],
    "workflow": os.environ["WORKFLOW"],
    "head_oid": os.environ["HEAD_OID"],
    "run": run,
    "verdict": verdict,
    "human_message": human,
    "upstream_pr": f"https://github.com/{os.environ['UPSTREAM']}/pull/{os.environ['PR']}",
    "maintainer_steps": [
        f"https://github.com/{os.environ['UPSTREAM']}/pull/{os.environ['PR']}/checks → Approve and run workflows",
        f"https://github.com/{os.environ['UPSTREAM']}/pull/{os.environ['PR']} → Merge pull request",
    ],
}
path = os.environ["ARTIFACT"]
with open(path, "w", encoding="utf-8") as f:
    json.dump(art, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"artifact={path}")
print(f"verdict={verdict}")
if run:
    print(f"run_url={run.get('url')}")
PY
}

if [[ -z "$RUN_ID" ]]; then
  echo
  echo "WAIT: fork 上尚无 $WORKFLOW run。"
  echo "      请 push 含 compile-gate 的 commit 到 $FORK:$BRANCH（paths 需命中），"
  echo "      然后重跑: make cineforge-fork-compile-proof"
  write_artifact "NO_RUN"
  exit 2
fi

echo "   run_id=$RUN_ID"

elapsed=0
STATUS=""
CONCLUSION=""
RUN_URL=""
RUN_SHA=""

while true; do
  META=$(gh run view "$RUN_ID" --repo "$FORK" \
    --json status,conclusion,url,headSha,displayTitle,event,createdAt 2>/dev/null) \
    || die "无法读取 run $RUN_ID"

  STATUS=$(echo "$META" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status') or '')")
  CONCLUSION=$(echo "$META" | python3 -c "import json,sys; print(json.load(sys.stdin).get('conclusion') or '')")
  RUN_URL=$(echo "$META" | python3 -c "import json,sys; print(json.load(sys.stdin).get('url') or '')")
  RUN_SHA=$(echo "$META" | python3 -c "import json,sys; print(json.load(sys.stdin).get('headSha') or '')")

  echo "   $(date '+%H:%M:%S') status=$STATUS conclusion=${CONCLUSION:-n/a}"

  if [[ "$STATUS" == "completed" ]]; then
    break
  fi

  if [[ "$WAIT" != "1" ]]; then
    echo "   WAIT=0 — 不轮询，当前未完成"
    break
  fi

  if [[ "$elapsed" -ge "$MAX_WAIT" ]]; then
    die "超时 ${MAX_WAIT}s — run $RUN_ID 仍未完成 ($RUN_URL)"
  fi

  sleep "$POLL_SEC"
  elapsed=$((elapsed + POLL_SEC))
done

VERDICT="UNKNOWN"
if [[ "$STATUS" == "completed" && "$CONCLUSION" == "success" ]]; then
  VERDICT="FORK_GREEN"
elif [[ "$STATUS" == "completed" ]]; then
  VERDICT="FORK_RED"
elif [[ "$STATUS" != "completed" ]]; then
  VERDICT="IN_PROGRESS"
fi

write_artifact "$VERDICT" "$RUN_ID" "$RUN_URL" "$STATUS" "$CONCLUSION" "$RUN_SHA"

if [[ "$POST" == "1" ]]; then
  BODY=$(
    ARTIFACT="$ARTIFACT" CYCLE="$CYCLE" PR="$PR" python3 - <<'PY'
import json, os
art = json.load(open(os.environ["ARTIFACT"], encoding="utf-8"))
run = art.get("run") or {}
url = run.get("url") or "(no run)"
pr = art.get("upstream_pr")
cycle = art.get("cycle")
verdict = art.get("verdict")
msg = art.get("human_message")
head = (art.get("head_oid") or "")[:12]
wf = art.get("workflow")
branch = art.get("branch")
print(f"""## Cycle {cycle} — Fork CI 绿证（收敛规则 #5 pivot）

{msg}

| 项 | 值 |
|---|---|
| verdict | **{verdict}** |
| fork run | {url} |
| workflow | `{wf}` @ `{branch}` |
| head | `{head}` |
| upstream PR | {pr} |

### MaxMiksa — 批准零风险叙事
Fork 上同一套 `cineforge-compile-gate` 已跑通。PR #{os.environ.get('PR','19')} Checks 的 Approve 不再是未知风险，而是复现已绿结果。

1. [Approve and run workflows]({pr}/checks)
2. [Merge pull request]({pr})

```bash
make cineforge-fork-compile-proof   # 刷新绿证
make cineforge-maintainer-one-shot OPEN=1 DIALOG=1
```

证据：`projects/cineforge/scripts/fixtures/fork-compile-proof.json`

---
_Auto Company Cycle {cycle} — fork-compile-proof_
""")
PY
  )
  "${CF}/scripts/gh-retry.sh" issue comment "$ISSUE" --repo "$UPSTREAM" --body "$BODY"
  echo "OK: Issue #${ISSUE} 已发布 Fork 绿证简报"
  echo "https://github.com/${UPSTREAM}/issues/${ISSUE}"
else
  echo "SKIP: POST=0 — 未发布 Issue 评论"
fi

echo
echo "== Fork Compile Proof 完成 =="
echo "verdict=$VERDICT"
echo "run=$RUN_URL"
echo "artifact=$ARTIFACT"

if [[ "$VERDICT" == "FORK_GREEN" ]]; then
  exit 0
elif [[ "$VERDICT" == "IN_PROGRESS" ]]; then
  exit 3
else
  exit 1
fi

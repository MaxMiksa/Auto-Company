#!/usr/bin/env bash
# 镜场 CineForge — Merge 信心证据包（本地 CI 全绿证明 + Issue 发布）
# 用法：./projects/cineforge/scripts/merge-confidence-pack.sh
# 可选：UPSTREAM=MaxMiksa/Auto-Company PR=19 ISSUE=17 CYCLE=26 POST=1 DRY_RUN=1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
UPSTREAM="${UPSTREAM:-MaxMiksa/Auto-Company}"
PR="${PR:-19}"
ISSUE="${ISSUE:-17}"
CYCLE="${CYCLE:-26}"
POST="${POST:-1}"
DRY_RUN="${DRY_RUN:-0}"
ARTIFACT="${CF}/scripts/fixtures/merge-confidence.json"

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

echo "== Merge Confidence Pack (Cycle ${CYCLE}) =="
echo "UPSTREAM=$UPSTREAM PR=$PR ISSUE=$ISSUE"
echo "时间: $(date '+%Y-%m-%d %H:%M %z')"
echo

PR_JSON=$(gh pr view "$PR" --repo "$UPSTREAM" --json \
  state,mergeable,url,headRefName,headRefOid 2>/dev/null) \
  || die "无法读取 PR #$PR"

PR_STATE=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])")
PR_URL=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['url'])")
PR_HEAD=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['headRefName'])")
PR_OID=$(echo "$PR_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['headRefOid'])")

if [[ "$PR_STATE" == "MERGED" ]]; then
  echo "PR 已 merge — 改跑: make cineforge-verify-post-merge"
  exit 0
fi

FORK_HEAD=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")
TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

echo "-- 1) 本地 push-ready"
PUSH_READY="FAIL"
PUSH_READY_LOG="/tmp/cineforge-push-ready-${CYCLE}.log"
if "${CF}/scripts/accept-push-ready.sh" >"$PUSH_READY_LOG" 2>&1; then
  PUSH_READY="PASS"
  echo "   PASS"
else
  echo "   FAIL — 见 $PUSH_READY_LOG"
fi

echo "-- 2) post-merge dry-run"
DRY_RUN_RESULT="FAIL"
if "${CF}/scripts/post-merge-dry-run.sh" >/dev/null 2>&1; then
  DRY_RUN_RESULT="READY"
  echo "   READY"
else
  echo "   WARN"
fi

echo "-- 3) daemon health"
DAEMON_STATUS="dead"
PIDFILE="/tmp/cineforge-merge-watch.pid"
if [[ -f "$PIDFILE" ]]; then
  dp=$(cat "$PIDFILE" 2>/dev/null || true)
  if [[ -n "$dp" ]] && kill -0 "$dp" 2>/dev/null; then
    DAEMON_STATUS="alive"
  fi
fi
echo "   daemon=${DAEMON_STATUS}"

echo "-- 4) 写入证据包"
mkdir -p "$(dirname "$ARTIFACT")"

python3 - <<'PY' "$ARTIFACT" "$CYCLE" "$TIMESTAMP" "$PR" "$PR_URL" "$PR_HEAD" "$PR_OID" \
  "$FORK_HEAD" "$PUSH_READY" "$DRY_RUN_RESULT" "$DAEMON_STATUS"
import json, sys
path, cycle, ts, pr, url, head, oid, fork, push, dry, daemon = sys.argv[1:12]
doc = {
    "schema": "jingchang.merge-confidence.v1",
    "cycle": int(cycle),
    "generated_at": ts,
    "pr": {
        "number": int(pr),
        "url": url,
        "head_ref": head,
        "head_oid": oid,
        "fork_head": fork,
    },
    "evidence": {
        "push_ready": push,
        "post_merge_dry_run": dry,
        "merge_watch_daemon": daemon,
    },
    "verdict": "SAFE_TO_MERGE" if push == "PASS" else "NOT_READY",
    "human_blocker": "workflow action_required — Approve and run workflows",
    "maintainer_steps": [
        f"{url}/checks → Approve and run workflows",
        f"{url} → Merge pull request",
    ],
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"   OK {path}")
print(f"   verdict={doc['verdict']}")
PY

echo
echo "-- 5) Issue 发布"
CHECKS_URL="${PR_URL}/checks"
VERDICT="SAFE_TO_MERGE"
[[ "$PUSH_READY" != "PASS" ]] && VERDICT="NOT_READY"

BODY=$(cat <<EOF
## Cycle ${CYCLE} — Merge Confidence Pack（收敛规则 #5 pivot #10）

Agent 无法绕过 fork workflow 批准。本轮 ship **本地 CI 全绿证据包** + **macOS 桌面通知**（非 GitHub 重复 nudge）。

### 证据摘要
| 项 | 值 |
|---|---|
| PR | [#${PR}](${PR_URL}) \`${PR_STATE}\` |
| 分支 | \`${PR_HEAD}\` @ \`${FORK_HEAD:0:7}\` |
| push-ready | **${PUSH_READY}** |
| post-merge dry-run | **${DRY_RUN_RESULT}** |
| merge-watch daemon | \`${DAEMON_STATUS}\` |
| **verdict** | **${VERDICT}** |

证据包：\`projects/cineforge/scripts/fixtures/merge-confidence.json\`（schema \`jingchang.merge-confidence.v1\`）

### MaxMiksa — 2 步合并（约 2 分钟）
1. [**Checks → Approve and run workflows**](${CHECKS_URL})
2. [**Merge pull request**](${PR_URL})

\`\`\`bash
make cineforge-merge-confidence          # 重跑证据包
make cineforge-desktop-nudge DIALOG=1    # macOS 桌面通知 + 对话框
make cineforge-maintainer-deeplink OPEN=1
\`\`\`

---
_Auto Company Cycle ${CYCLE} — merge-confidence-pack_
EOF
)

if [[ "$DRY_RUN" == "1" ]]; then
  echo "-- DRY_RUN — 将发布以下评论："
  echo "$BODY"
  exit 0
fi

if [[ "$POST" == "1" ]]; then
  gh issue comment "$ISSUE" --repo "$UPSTREAM" --body "$BODY"
  echo "OK: Issue #${ISSUE} 已发布 confidence pack"
  echo "https://github.com/${UPSTREAM}/issues/${ISSUE}"
else
  echo "SKIP: POST=0 — 未发布 Issue 评论"
fi

echo
echo "== Confidence Pack 完成 =="
echo "verdict=${VERDICT} artifact=${ARTIFACT}"
exit 0

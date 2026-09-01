#!/usr/bin/env bash
# 镜场 CineForge — 创建 GitHub handoff Issue（人类入库可追踪清单）
# 用法：仓库根目录 ./projects/cineforge/scripts/create-handoff-issue.sh
# 可选：FORCE=1 忽略已有 open handoff issue 并新建；REQUIRE_PASS=1 先跑 push-ready
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
LABEL="cineforge-handoff"
FORCE="${FORCE:-0}"
REQUIRE_PASS="${REQUIRE_PASS:-0}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd git
need_cmd gh

# shellcheck source=ship-paths.sh
source "${CF}/scripts/ship-paths.sh"

cd "$ROOT"

echo "== 镜场 GitHub handoff Issue =="
echo "ROOT=$ROOT FORCE=$FORCE REQUIRE_PASS=$REQUIRE_PASS"
echo

if [[ "$REQUIRE_PASS" == "1" ]]; then
  echo "-- 运行 push-ready 验收"
  "${CF}/scripts/accept-push-ready.sh"
  echo
fi

# --- 待入库清单 ---
PENDING=()
while IFS= read -r line; do
  [[ -n "$line" ]] && PENDING+=("$line")
done < <(cineforge_collect_pending "$ROOT")

PENDING_COUNT=${#PENDING[@]}

# --- health 摘要（best-effort）---
HEALTH_BLOCK="（dev server 未运行，跳过 health 摘要）"
if curl -sf --max-time 5 "http://127.0.0.1:3200/api/health" >/dev/null 2>&1; then
  HEALTH_BLOCK=$("${CF}/scripts/status-health.sh" 2>/dev/null | sed 's/^/    /' || echo "    health 探活失败")
fi

# --- waitlist 摘要 ---
WAITLIST_BLOCK=$("${CF}/scripts/waitlist-stats.sh" 2>/dev/null | sed 's/^/    /' || echo "    waitlist 统计不可用")

# --- 已有 open issue（标题前缀匹配，不依赖标签）---
EXISTING_URL=""
if [[ "$FORCE" != "1" ]]; then
  EXISTING_URL=$(gh issue list --state open --limit 30 --json title,url \
    --jq '.[] | select(.title | startswith("[CineForge] 人类入库 handoff")) | .url' 2>/dev/null | head -1 || true)
fi

TIMESTAMP=$(date '+%Y-%m-%d %H:%M %z')
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || echo "unknown")
FORK_OWNER=$(gh api user -q .login 2>/dev/null || echo "YOUR_GH_USER")
FORK_HINT="${FORK_OWNER}/Auto-Company:ship/cineforge-compile-track"

BODY=$(cat <<EOF
## 镜场 CineForge — 人类入库 Handoff

**生成时间：** ${TIMESTAMP}  
**仓库：** \`${REPO}\`  
**待入库文件数：** ${PENDING_COUNT}

### 验收状态

- [ ] 本地 \`make cineforge-push-ready\` PASS
- [ ] \`git add\` 不含 \`.data\` / \`node_modules\` / \`.next\` / \`.env*\`
- [ ] \`git push origin main\` 后 GitHub Actions \`cineforge-compile-gate\` 绿
- [ ] （可选）配置 \`SEEDANCE_API_KEY\` secret 后手动触发 \`cineforge-render-gate\`

### 建议入库命令

**推荐 — 一键开 PR：**

\`\`\`bash
make cineforge-ship-pr
\`\`\`

（验收 → 创建 \`ship/cineforge-compile-track\` 分支 → commit → push → \`gh pr create\`）

**READ 权限 — Fork 开 PR 到 upstream：**

\`\`\`bash
make cineforge-ship-pr-fork
\`\`\`

（自动 fork → push \`${FORK_HINT}\` → \`gh pr create --repo MaxMiksa/Auto-Company\`）

**或分步 stage + push main：**

\`\`\`bash
make cineforge-stage   # push-ready + git add 完整 manifest（6 项）

git commit -m "\$(cat <<'COMMIT'
feat(cineforge): ship compile-track CI, ops tooling, and landing

Unlock GitHub compile gate and local push-ready validation.
Render track remains manual (Seedance key / Omni).
COMMIT
)"

git push origin main
\`\`\`

### 待入库路径（${PENDING_COUNT}）

$(if [[ "$PENDING_COUNT" -eq 0 ]]; then echo "_无待入库变更（可能已 commit 或路径不对）_"; else printf '%s\n' "${PENDING[@]}" | sed 's/^/- `/; s/$/`/'; fi)

### 运行态 health（快照）

\`\`\`
${HEALTH_BLOCK}
\`\`\`

### waitlist（本地）

\`\`\`
${WAITLIST_BLOCK}
\`\`\`

### 成片轨（仍 blocked，入库后可选）

1. \`SEEDANCE_API_KEY=xxx ./projects/cineforge/scripts/inject-seedance-key.sh\` → \`accept-first-render.sh\`
2. 或 GitHub 配置 secret \`SEEDANCE_API_KEY\` 后手动跑 \`cineforge-render-gate\`
3. 或恢复 Omni（\`/health\` 连续两次 \`status=ok\`）

---
_Auto Company Cycle 15 — 完整 ship manifest + 一键 staging + **一键开 PR**（\`make cineforge-ship-pr\`）。_
EOF
)

if [[ -n "$EXISTING_URL" && "$EXISTING_URL" != "null" ]]; then
  echo "已有 open handoff issue: $EXISTING_URL"
  echo "-- 追加状态评论"
  gh issue comment "$EXISTING_URL" --body "$BODY"
  echo
  echo "OK 已更新评论: $EXISTING_URL"
  exit 0
fi

echo "-- 创建新 handoff issue"
CREATE_ARGS=(
  --title "[CineForge] 人类入库 handoff — ${PENDING_COUNT} 文件待 push"
  --body "$BODY"
)
if gh label list --limit 200 --json name --jq '.[].name' 2>/dev/null | grep -qx "$LABEL"; then
  CREATE_ARGS+=(--label "$LABEL")
else
  echo "WARN: 标签 $LABEL 不存在或无权限创建，Issue 将不带标签"
fi

ISSUE_URL=$(gh issue create "${CREATE_ARGS[@]}")

echo
echo "OK handoff issue: $ISSUE_URL"
echo "下一步：人类按 issue 清单 commit/push，激活 GitHub compile gate。"

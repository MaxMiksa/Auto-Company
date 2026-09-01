#!/usr/bin/env bash
# 镜场 CineForge — 入库前就绪验收（人类 commit/push 前一键跑齐）
# 成功定义：无密钥泄漏风险 + 敏感目录未纳入 + CI gate + health + waitlist 全 PASS
# 用法：仓库根目录 ./projects/cineforge/scripts/accept-push-ready.sh
# 可选：SKIP_CI=1 跳过编译轨 CI gate（仅做清单与密钥扫描）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CF="${ROOT}/projects/cineforge"
SKIP_CI="${SKIP_CI:-0}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令: $1"
}

need_cmd git
need_cmd python3

# shellcheck source=ship-paths.sh
source "${CF}/scripts/ship-paths.sh"

cd "$ROOT"

echo "== 镜场入库前就绪验收 =="
echo "ROOT=$ROOT SKIP_CI=$SKIP_CI"
echo

# --- 1) 待入库文件清单 ---
echo "-- 1) 待入库路径扫描（完整 manifest ${#CINEFORGE_SHIP_PATHS[@]} 项）"
PENDING=()
while IFS= read -r line; do
  [[ -n "$line" ]] && PENDING+=("$line")
done < <(cineforge_collect_pending "$ROOT")

if [[ ${#PENDING[@]} -eq 0 ]]; then
  echo "WARN: 无待入库变更（可能已 commit 或路径不对）"
else
  echo "待入库文件数: ${#PENDING[@]}"
  printf '  %s\n' "${PENDING[@]}"
fi
echo

# --- 2) 敏感目录不得出现在清单 ---
echo "-- 2) 敏感路径检查"
FORBIDDEN=(
  "projects/cineforge/app/.data"
  "projects/cineforge/app/node_modules"
  "projects/cineforge/app/.next"
  "projects/cineforge/app/.env"
  "projects/cineforge/app/.env.local"
)
if [[ ${#PENDING[@]} -gt 0 ]]; then
  for path in "${PENDING[@]}"; do
    for bad in "${FORBIDDEN[@]}"; do
      [[ "$path" == "$bad" || "$path" == "$bad"/* ]] && die "敏感路径不应入库: $path"
    done
  done
fi
echo "OK 无 .data / node_modules / .next / .env 纳入"
echo

# --- 3) 密钥模式扫描（仅扫描待入库文本文件）---
echo "-- 3) 密钥泄漏扫描"
SECRET_HITS=0
scan_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  if grep -qE '(SEEDANCE_API_KEY|ARK_API_KEY|OPENAI_API_KEY|sk-[a-zA-Z0-9]{20,})=[^$\{][^\s"'\''`]+' "$f" 2>/dev/null; then
    echo "  LEAK? $f"
    SECRET_HITS=$((SECRET_HITS + 1))
  fi
  if grep -qE '"(seedanceApiKey|arkApiKey|openaiApiKey)"\s*:\s*"[a-zA-Z0-9_\-]{8,}"' "$f" 2>/dev/null; then
    echo "  LEAK? $f (settings json key)"
    SECRET_HITS=$((SECRET_HITS + 1))
  fi
}

if [[ ${#PENDING[@]} -gt 0 ]]; then
  for path in "${PENDING[@]}"; do
    case "$path" in
      *.ts|*.tsx|*.js|*.jsx|*.json|*.md|*.yml|*.yaml|*.sh|*.toml|*.env*)
        scan_file "$ROOT/$path"
        ;;
    esac
  done
else
  echo "SKIP 无待入库文件，跳过密钥扫描"
fi

[[ "$SECRET_HITS" -eq 0 ]] || die "发现 $SECRET_HITS 处疑似密钥，清理后再入库"
echo "OK 未发现硬编码密钥"
echo

# --- 4) gitignore 覆盖 ---
echo "-- 4) .gitignore 覆盖"
for bad in "${FORBIDDEN[@]}"; do
  git check-ignore -q "$bad" 2>/dev/null || die "未 gitignore: $bad（检查 app/.gitignore）"
done
grep -q '!projects/cineforge/' "$ROOT/.gitignore" 2>/dev/null \
  || die "根 .gitignore 缺少 !projects/cineforge/ 白名单（CineForge 将无法入库）"
echo "OK 敏感目录已被 gitignore；根白名单含 projects/cineforge"
echo

# --- 5) 运行态门禁 ---
if [[ "$SKIP_CI" == "1" ]]; then
  echo "-- 5) 跳过 CI gate（SKIP_CI=1）"
else
  echo "-- 5) 编译轨 CI gate"
  "${CF}/scripts/accept-ci-gate.sh"
  echo
fi

echo "-- 6) 运行态 health"
"${CF}/scripts/status-health.sh"
echo

echo "-- 7) waitlist 冒烟"
"${CF}/scripts/accept-waitlist.sh"
echo

# --- 8) 人类入库指令 ---
echo "== PASS: 入库前验收通过 =="
echo
echo "建议入库命令（由人类执行）："
echo
echo "# 一键开 PR（推荐 — 自动 branch/commit/push/pr）："
echo "make cineforge-ship-pr"
echo
echo "# READ 权限账号 — Fork 开 PR 到 upstream："
echo "make cineforge-ship-pr-fork"
echo
echo "# 或分步 stage + 手动 commit/push main："
echo "make cineforge-stage"
echo
echo "# 或手动："
cineforge_print_git_add_block
echo
cat <<'INSTRUCTIONS'

git commit -m "$(cat <<'EOF'
feat(cineforge): ship compile-track CI, ops tooling, and landing

Unlock GitHub compile gate and local push-ready validation.
Render track remains manual (Seedance key / Omni).
EOF
)"

git push origin main
INSTRUCTIONS
echo
echo "推送后 GitHub Actions「cineforge-compile-gate」将在 main/PR 上自动运行。"
echo "成片轨：配置 secret SEEDANCE_API_KEY 后手动触发 cineforge-render-gate。"
exit 0

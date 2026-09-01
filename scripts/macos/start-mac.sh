#!/bin/bash
# ============================================================
# Auto Company — macOS 启动入口
# ============================================================
# 用法:
#   ./scripts/macos/start-mac.sh              前台运行自动循环
#   ./scripts/macos/start-mac.sh --select     先选引擎再启动
#   ./scripts/macos/start-mac.sh --engine vllm
#   ./scripts/macos/start-mac.sh --awake      前台运行并防止 Mac 睡眠
#   ./scripts/macos/start-mac.sh --daemon     安装 launchd 守护（开机自启）
#   ./scripts/macos/start-mac.sh --uninstall  卸载守护进程
#   ./scripts/macos/start-mac.sh --stop       停止当前循环
#   ./scripts/macos/start-mac.sh --pause      暂停守护（不再自动拉起）
#   ./scripts/macos/start-mac.sh --resume     恢复守护
#   ./scripts/macos/start-mac.sh --status     查看状态
#   ./scripts/macos/start-mac.sh --monitor    实时日志
#   ./scripts/macos/start-mac.sh --last       最近一轮完整输出
#   ./scripts/macos/start-mac.sh --cycles     周期摘要
#   ./scripts/macos/start-mac.sh --dashboard  打开本地看板 http://127.0.0.1:8787
#   ./scripts/macos/start-mac.sh --help       显示帮助
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

if [ -f "$PROJECT_DIR/.auto-loop.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$PROJECT_DIR/.auto-loop.env"
    set +a
fi

ENGINE="${ENGINE:-cursor}"
ACTION="${1:---start}"

usage() {
    cat <<'EOF'
Auto Company macOS 启动脚本

用法:
  ./scripts/macos/start-mac.sh              前台运行自动循环
  ./scripts/macos/start-mac.sh --select     先选引擎（cursor/codex/vllm）再启动
  ./scripts/macos/start-mac.sh --engine vllm 指定引擎后启动
  ./scripts/macos/start-mac.sh --awake      前台运行并防止 Mac 睡眠
  ./scripts/macos/start-mac.sh --daemon     安装 launchd 守护（开机自启）
  ./scripts/macos/start-mac.sh --uninstall  卸载守护进程
  ./scripts/macos/start-mac.sh --stop       停止当前循环
  ./scripts/macos/start-mac.sh --pause      暂停守护（不再自动拉起）
  ./scripts/macos/start-mac.sh --resume     恢复守护
  ./scripts/macos/start-mac.sh --status     查看状态
  ./scripts/macos/start-mac.sh --monitor    实时日志
  ./scripts/macos/start-mac.sh --last       最近一轮完整输出
  ./scripts/macos/start-mac.sh --cycles     周期摘要
  ./scripts/macos/start-mac.sh --dashboard  打开本地看板 http://127.0.0.1:8787
  ./scripts/macos/start-mac.sh --help       显示帮助
EOF
}

case "$ACTION" in
    --help|-h)
        usage
        ;;
    --select)
        "$SCRIPT_DIR/select-engine.sh"
        exec make start
        ;;
    --engine)
        if [ -z "${2:-}" ]; then
            echo "用法: $0 --engine cursor|codex|vllm"
            exit 1
        fi
        "$SCRIPT_DIR/select-engine.sh" "$2"
        exec make start
        ;;
    --start|"")
        echo "启动 Auto Company 前台循环"
        echo "  目录: $PROJECT_DIR"
        echo "  引擎: $ENGINE"
        echo "  停止: make stop  或  $0 --stop"
        echo ""
        exec make start
        ;;
    --awake)
        echo "启动循环并保持 Mac 唤醒（caffeinate）"
        exec make start-awake
        ;;
    --daemon|--install)
        echo "安装并启动 launchd 守护进程（开机自启 + 崩溃自拉起）"
        exec make install
        ;;
    --uninstall)
        echo "卸载 launchd 守护进程"
        exec make uninstall
        ;;
    --stop)
        exec make stop
        ;;
    --pause)
        exec make pause
        ;;
    --resume)
        exec make resume
        ;;
    --status)
        exec make status
        ;;
    --monitor)
        exec make monitor
        ;;
    --last)
        exec make last
        ;;
    --cycles)
        exec make cycles
        ;;
    --dashboard)
        echo "看板地址: http://127.0.0.1:8787"
        exec make dashboard
        ;;
    *)
        echo "未知参数: $ACTION"
        echo ""
        usage
        exit 1
        ;;
esac

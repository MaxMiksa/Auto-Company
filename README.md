<div align="center">

# Auto Company

**全自主 AI 公司，24/7 不停歇运行**

14 个 AI Agent，每个都是该领域世界顶级专家的思维分身。
自主构思产品、做决策、写代码、部署上线、搞营销。没有人类参与。

基于 [Codex CLI](https://www.npmjs.com/package/@openai/codex) 驱动（macOS 原生 + Windows/WSL）。

[![macOS](https://img.shields.io/badge/平台-macOS-blue)](#依赖)
[![Windows WSL](https://img.shields.io/badge/平台-Windows%20WSL-blue)](#windows-wsl-快速开始)
[![Codex CLI](https://img.shields.io/badge/驱动-Codex%20CLI-orange)](https://www.npmjs.com/package/@openai/codex)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](#license)
[![Status](https://img.shields.io/badge/状态-实验中-red)](#%EF%B8%8F-免责声明)

> **⚠️ 实验项目** — 还在测试中，能跑但不一定稳定。  
> macOS 使用 launchd；Windows 使用 WSL systemd --user + PowerShell 入口。

</div>

---

## 这是什么？

你启动一个循环。AI 团队醒来，读取共识记忆，决定干什么，组建 3-5 人小队，执行任务，更新共识记忆，然后睡一觉。接着又醒来。如此往复，永不停歇。

```
launchd (崩溃自重启)
  └── scripts/core/auto-loop.sh (永续循环)
        ├── 读 PROMPT.md + consensus.md
        ├── codex exec (驱动一个工作周期)
        │   ├── 读 CLAUDE.md (公司章程 + 安全红线)
        │   ├── 读 .claude/skills/team/SKILL.md (组队方法)
        │   ├── 组建 Agent Team (3-5 人)
        │   ├── 执行：调研、写码、部署、营销
        │   └── 更新 memories/consensus.md (传递接力棒)
        ├── 失败处理: 限额等待 / 熔断保护 / consensus 回滚
        └── sleep → 下一轮
```

每个周期是一次独立的 `codex exec` 调用。`memories/consensus.md` 是唯一的跨周期状态——类似接力赛传棒。

## 团队阵容（14 人）

不是"你是一个开发者"，而是"你是 DHH"——用真实传奇人物激活 LLM 的深层知识。

| 层级 | 角色 | 专家 | 核心能力 |
|------|------|------|----------|
| **战略** | CEO | Jeff Bezos | PR/FAQ、飞轮效应、Day 1 心态 |
| | CTO | Werner Vogels | 为失败而设计、API First |
| | 逆向思考 | Charlie Munger | 逆向思维、Pre-Mortem、心理误判清单 |
| **产品** | 产品设计 | Don Norman | 可供性、心智模型、以人为本 |
| | UI 设计 | Matías Duarte | Material 隐喻、Typography 优先 |
| | 交互设计 | Alan Cooper | Goal-Directed Design、Persona 驱动 |
| **工程** | 全栈开发 | DHH | 约定优于配置、Majestic Monolith |
| | QA | James Bach | 探索性测试、Testing ≠ Checking |
| | DevOps/SRE | Kelsey Hightower | Serverless 优先、自动化一切 |
| **商业** | 营销 | Seth Godin | 紫牛、许可营销、最小可行受众 |
| | 运营 | Paul Graham | Do Things That Don't Scale、拉面盈利 |
| | 销售 | Aaron Ross | 可预测收入、漏斗思维 |
| | CFO | Patrick Campbell | 基于价值定价、单位经济学 |
| **情报** | 调研分析 | Ben Thompson | Aggregation Theory、价值链分析 |

另配 **30+ 技能**（深度调研、网页抓取、财务建模、SEO、安全审计、UX 审计……），任何 Agent 按需取用。

## 快速开始

```bash
# 前提:
# - macOS
# - 已安装 Codex CLI 并完成登录
# - 可用模型配额

# 克隆
git clone https://github.com/nicepkg/auto-company.git
cd auto-company

# 前台运行（直接看输出）
make start

# 或安装为守护进程（开机自启 + 崩溃自重启）
make install
```

## Windows (WSL) 快速开始

Windows 下推荐“PowerShell 命令入口 + WSL 执行内核”：

1. 在 Windows 安装 WSL2 + Ubuntu。
2. 在 WSL 中一次性安装运行依赖（`node`、`codex`、`jq`）。
3. 在 PowerShell 直接运行 `*-win.ps1` 脚本。

详细步骤见：[`docs/windows-setup.md`](docs/windows-setup.md)

常用 Windows 命令（在 `clone_win` 目录执行）：

```powershell
.\scripts\windows\start-win.ps1              # 启动 WSL daemon + 运行时防睡眠
.\scripts\windows\status-win.ps1             # 查看 guardian + daemon + 循环状态
.\scripts\windows\monitor-win.ps1            # 实时日志
.\scripts\windows\last-win.ps1               # 上一轮完整输出
.\scripts\windows\cycles-win.ps1             # 历史周期摘要
.\scripts\windows\stop-win.ps1               # 停止循环
.\scripts\windows\enable-autostart-win.ps1  # 可选：启用登录后自启
.\scripts\windows\disable-autostart-win.ps1 # 关闭登录后自启
.\scripts\windows\autostart-status-win.ps1  # 查看自启状态
```


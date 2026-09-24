<div align="center">

# Auto Company

**支持持续自主工作的 AI 公司框架** <a href="README.md"><img alt="[English Documentation]" src="https://img.shields.io/badge/%5BEnglish%20Documentation%5D-2f3640.svg" /></a>

基于 **Agentic Workflows（代理式工作流）**，系统提供 14 份 **AI 智能体角色定义**，各自参考相关领域专家的工作方法。
团队可以在人类设定的目标、权限和预算内自主调研产品、做决策和写代码。部署、发布和营销取决于可用工具及授权范围，持续运行也依赖服务和模型可用性。

默认使用 Claude Code，并支持 [Codex CLI](https://www.npmjs.com/package/@openai/codex)（macOS 原生 + Windows/WSL），两端都可启动本地 Dashboard。

另有需要显式配置的 Cursor 与 OpenAI-compatible 可选适配器，能力与限制见[引擎适配说明](i18n/zh-CN/ENGINE_ADAPTERS.md)。

[![macOS](https://img.shields.io/badge/平台-macOS-blue?logo=apple&logoColor=white)](#依赖)
[![Windows WSL](https://img.shields.io/badge/平台-Windows%20WSL-blue?logo=windows&logoColor=white)](#windows-wsl-快速开始)
[![Codex CLI](https://img.shields.io/badge/驱动-Codex%20CLI-orange?logo=data:image/svg%2Bxml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMjQgMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0yMi4yODE5IDkuODIxMWE1Ljk4NDcgNS45ODQ3IDAgMCAwLS41MTU3LTQuOTEwOCA2LjA0NjIgNi4wNDYyIDAgMCAwLTYuNTA5OC0yLjlBNi4wNjUxIDYuMDY1MSAwIDAgMCA0Ljk4MDcgNC4xODE4YTUuOTg0NyA1Ljk4NDcgMCAwIDAtMy45OTc3IDIuOSA2LjA0NjIgNi4wNDYyIDAgMCAwIC43NDI3IDcuMDk2NiA1Ljk4IDUuOTggMCAwIDAgLjUxMSA0LjkxMDcgNi4wNTEgNi4wNTEgMCAwIDAgNi41MTQ2IDIuOTAwMUE2LjA2NTEgNi4wNjUxIDAgMCAwIDE5LjAyIDE5LjgxODJhNS45ODQ3IDUuOTg0NyAwIDAgMCAzLjk5NzctMi45MDAxIDYuMDQ2MiA2LjA0NjIgMCAwIDAtLjczNTgtNy4wOTdaTTguNzQ5IDYuNzU3OGE0LjQxMTggNC40MTE4IDAgMCAxIDcuMzY3MyAxLjE0NDQgNC4zOTg2IDQuMzk4NiAwIDAgMS0uMjkyOCA0LjIyODVsLTQuNzA3LTIuNzIxNHYtMi42NTE1Wk02LjUzMzIgMTQuNjU0YTQuNDExOCA0LjQxMTggMCAwIDEtMS4xMjkzLTcuMzcgNC4zOTg2IDQuMzk4NiAwIDAgMSA0LjEzNTItMS4zOWwyLjM2MTUgNC4wOTN2NS4zMDJMNi41MzMyIDE0LjY1NFptLTEuODQ4LTEuNTcyYTQuNDExOCA0LjQxMTggMCAwIDEgNi4yMzgtNi4yMjYgNC4zOTg2IDQuMzk4NiAwIDAgMSAzLjg0MzMgMi44MzhsLTQuNzA3IDIuNzIxdjUuMzAxNUw0LjY4NTIgMTMuMDgyWm0xMC41NjU4IDQuMTZhNC40MTE4IDQuNDExOCAwIDAgMS03LjM2NzMtMS4xNDQzIDQuMzk4NiA0LjM5ODYgMCAwIDEgLjI5MjgtNC4yMjg1bDQuNzA3IDIuNzIxNHYyLjY1MTRabTIuMjE1OC03Ljg5NmE0LjQxMTggNC40MTE4IDAgMCAxIDEuMTI5MyA3LjM3IDQuMzk4NiA0LjM5ODYgMCAwIDEtNC4xMzUyIDEuMzlsLTIuMzYxNS00LjA5M1Y5LjE4Nmw1LjM2NzQgMi4xODZabTEuODQ4IDEuNTcyYTQuNDExOCA0LjQxMTggMCAwIDEtNi4yMzggNi4yMjYgNC4zOTg2IDQuMzk4NiAwIDAgMS0zLjg0MzMtMi44MzhsNC43MDctMi43MjFWOS4xODZsNS4zNzQgMy4wOTZaTTEyIDE2LjUxNmE0LjQxMTggNC40MTE4IDAgMCAxLTQuNDExOC00LjQxMThjMC0yLjQzNDggMS45NzctNC40MTE4IDQuNDExOC00LjQxMThzNC40MTE4IDEuOTc3IDQuNDExOCA0LjQxMTgtMS45NzcgNC40MTE4LTQuNDExOCA0LjQxMThaIi8+PC9zdmc+&logoColor=white)](https://www.npmjs.com/package/@openai/codex)
[![Claude Code](https://img.shields.io/badge/驱动-Claude%20Code-purple?logo=anthropic&logoColor=white)](#依赖)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?logo=opensourceinitiative&logoColor=white)](LICENSE)

</div>

---

## 看板预览

[![Auto Company Dashboard](presentation/dashboard-showcase.png)](presentation/dashboard-showcase.png)

ScopeFence 的真实四轮产品记录：04 展开，03、02、01 逐项收起且全部可见；立项前探索单独保留。看板展示工作汇报、检查、文档、实拍、用量与日志。标题和摘要仍是模型填写的记录，运行事实与支持的检查结果由程序采集；缺失、失败、过期和部分用量明确标注。支持范围见[运行记录](docs/runtime-observability.md)、[连续轮次](docs/product-cycles.md)和[自动实拍](docs/product-media.md)说明。

<table>
  <tr>
    <th width="50%">Text Meter · English</th>
    <th width="50%">范围确认单 / Scope Sheet · 中文</th>
  </tr>
  <tr>
    <td width="50%" valign="top"><a href="presentation/dashboards/text-meter.png"><img src="presentation/dashboards/text-meter.png" alt="Text Meter · English Dashboard" width="100%" /></a></td>
    <td width="50%" valign="top"><a href="presentation/dashboards/scope-sheet.png"><img src="presentation/dashboards/scope-sheet.png" alt="范围确认单 / Scope Sheet · 中文 Dashboard" width="100%" /></a></td>
  </tr>
  <tr>
    <td width="50%" valign="top">两次启动的两个产品轮次，编号从 01 延续到 02。</td>
    <td width="50%" valign="top">四个产品尝试；两次模型容量错误保留为失败，后续成功记录照常呈现。</td>
  </tr>
</table>

## 这是什么？

你启动循环后，每轮会读取工作摘要、决定任务、按需组队、执行并更新摘要，然后等待下一轮。实际组队取决于模型和引擎能力；错误、预算限制或暂停请求可能中止后续运行。

```
daemon (launchd / systemd --user, 崩溃自重启)
  └── scripts/core/auto-loop.sh (持续循环)
        ├── 读 PROMPT.md + consensus.md
        ├── CLI 调用（Codex CLI / Claude Code）
        │   ├── 读 CLAUDE.md (公司章程 + 安全红线)
        │   ├── 读 .claude/skills/team/SKILL.md (组队方法)
        │   ├── 按需组建 Agent Team
        │   ├── 执行：调研、写码、部署、营销
        │   └── 更新 memories/consensus.md (工作摘要)
        ├── 失败处理: 限额等待 / 熔断保护 / consensus 回滚
        └── sleep → 下一轮
```

每个周期是一次独立的 CLI 调用。`memories/consensus.md` 是下一轮预加载的主要工作摘要，产品文件、仓库、配置、身份记录、日志和用量数据也会跨轮次保留。

## 运行产物示例

以下三个独立产品来自实际运行，中英文 README 展示同一套项目。ScopeFence 与范围确认单由默认流程自主选题；Text Meter 来自一个普通的文本统计需求。人类设置了运行权限、语言与停止边界，发布前进行了定向审查和必要修正，具体来源记录在各项目中。产品截图来自公开源码的实际默认界面；上方 Dashboard 保留原始运行事实，未修改失败或工作汇报。

<table>
  <tr>
    <th width="33%">ScopeFence · English</th>
    <th width="33%">Text Meter · English</th>
    <th width="33%">范围确认单 / Scope Sheet · 中文</th>
  </tr>
  <tr>
    <td width="33%" valign="top"><a href="presentation/products/scopefence-full.png"><img src="presentation/products/scopefence.png" alt="ScopeFence" width="100%" /></a></td>
    <td width="33%" valign="top"><a href="presentation/products/text-meter-full.png"><img src="presentation/products/text-meter.png" alt="Text Meter" width="100%" /></a></td>
    <td width="33%" valign="top"><a href="presentation/products/scope-sheet-full.png"><img src="presentation/products/scope-sheet.png" alt="范围确认单 / Scope Sheet" width="100%" /></a></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><p>将范围变更整理成无需登录的确认链接；返回链接是可编辑的沟通副本，不是经过验证的批准记录。</p><p><a href="projects/scopefence/">查看源码 →</a></p></td>
    <td width="33%" valign="top"><p>在浏览器本地即时统计字符、非空白字符、以空白分隔的词与行数。</p><p><a href="projects/text-meter/">查看源码 →</a></p></td>
    <td width="33%" valign="top"><p>填写合作范围、修改、交付与报价，检查必填项后复制或下载中文确认单。</p><p><a href="projects/scope-sheet/">查看源码 →</a></p></td>
  </tr>
</table>

## 下载与引导安装

带有正式平台附件的 Release 可以不经 Git clone 安装。从同一个 [GitHub Release](https://github.com/MaxMiksa/Auto-Company/releases) 下载 Windows、macOS 或 Linux 附件及 `SHA256SUMS.txt`，在解压前核对校验值，再运行包内 `setup.ps1` 或 `setup.sh`。引导会在确认前显示依赖和改动，按照操作系统界面判断中文或英文，并默认跳过可选截图环境，除非你明确选择安装。安装期间不会调用模型，服务默认保持停止且不启用开机运行，直到你主动开始。详见[中文安装说明](docs/install.md)或 [English installation guide](i18n/en/docs/install.md)。

下方 Git clone 方式继续受支持，也适用于尚未包含正式平台附件的旧 Release。

## 你该看哪一节（按平台）

- Windows 用户：从 [Windows (WSL) 快速开始](#windows-wsl-快速开始) 开始，再看 [`docs/windows-setup.md`](docs/windows-setup.md)
- macOS 用户：从 [macOS 快速开始](#macos-快速开始) 开始，再看 [命令速查（按平台）](#命令速查按平台)

## 语言与文档

一个语言设置统一控制 Dashboard、文档入口和新产品工作。首次使用跟随电脑的显示语言：中文系统使用 `zh-CN`，其他语言使用 `en`；WSL 会优先读取 Windows 的显示语言。

在 Dashboard 中选择语言，或执行 `make language LANGUAGE=en`（中文为 `LANGUAGE=zh-CN`）；Windows 可执行 `python scripts/core/localization.py set --language en`。这些入口更新同一个偏好。产品周期开始后，语言在多轮 AI 执行、暂停和重启之间保持固定。运行中也能修改偏好，但从下一个产品周期才生效；Dashboard 会显示当前与下个周期的语言。产品周期的切换方式和 Windows 启动参数见[语言说明](i18n/README.md)。

所有附带技能统一使用英文编写，面向用户的工作结果仍跟随产品语言。命令、标识符、协议标题和底层工具原始错误保留原样。自定义源文件、已有产品、日志与共识历史会保留，切换语言不会追溯翻译这些内容。

| 文档 | 中文 | English |
|---|---|---|
| 仓库索引 | [索引](INDEX.md) | [Index](i18n/en/INDEX.md) |
| Windows + WSL | [安装指南](docs/windows-setup.md) | [Setup guide](i18n/en/docs/windows-setup.md) |
| 公司规则 | [公司章程](i18n/zh-CN/CLAUDE.md) | [Charter](CLAUDE.md) |
| 引擎适配 | [引擎适配器](i18n/zh-CN/ENGINE_ADAPTERS.md) | [Adapter guide](ENGINE_ADAPTERS.md) |
| 用量与预算 | [治理说明](i18n/zh-CN/docs/usage-governance.md) | [Governance guide](docs/usage-governance.md) |
| 操作与排错 | [常见操作与排错](docs/troubleshooting.md) | [Common tasks and errors](i18n/en/docs/troubleshooting.md) |

## 团队阵容（14 个角色）

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

## macOS 快速开始

```bash
# 前提:
# - macOS
# - 已安装并登录 Codex CLI 或 Claude Code
# - 已可用 Python 3.10+（python3）、Git 和 make
# - 可用模型配额

# 克隆
git clone https://github.com/MaxMiksa/Auto-Company.git
cd Auto-Company

# 使用 Claude Code 前台运行（默认引擎，直接看输出）
make start

# 或使用 Codex CLI 前台运行
ENGINE=codex make start

# 也可为所选引擎安装并启动守护进程
make install
# 使用 Codex 而非默认的 Claude：
ENGINE=codex make install
```

## Windows (WSL) 快速开始

```powershell
# 前提:
# - Windows 10/11 + WSL2 (Ubuntu)，systemd --user 可用
# - 已在 WSL 内安装并登录 Codex CLI 或 Claude Code
# - WSL 内已可用 Python 3.10+（python3）、Git 和 make
# - Windows 端已安装 Python 3.10+（python），供 PowerShell 看板入口使用
# - 可用模型配额

# 克隆
git clone https://github.com/MaxMiksa/Auto-Company.git
cd Auto-Company

# 在 PowerShell 启动（守护模式，默认引擎为 claude）
.\scripts\windows\start-win.ps1

# 显式切换引擎
.\scripts\windows\start-win.ps1 -Engine codex

# 查看状态
.\scripts\windows\status-win.ps1

# 停止
.\scripts\windows\stop-win.ps1
```

监控、看板、自启等命令请查看 [`docs/windows-setup.md`](docs/windows-setup.md)。


## 命令速查（按平台）

| 任务 | macOS / WSL（在终端执行） | Windows（在 PowerShell 执行） |
|---|---|---|
| 启动 | `make start` | `.\scripts\windows\start-win.ps1` |
| 查看状态 | `make status` | `.\scripts\windows\status-win.ps1` |
| 实时日志 | `make monitor` | `.\scripts\windows\monitor-win.ps1` |
| 最近一轮输出 | `make last` | `.\scripts\windows\last-win.ps1` |
| 周期摘要 | `make cycles` | `.\scripts\windows\cycles-win.ps1` |
| 停止 | 前台：`make stop`；后台守护：`make pause` | `.\scripts\windows\stop-win.ps1` |
| 可视化看板 | `make dashboard` | `.\scripts\windows\dashboard-win.ps1` |
| 安装守护 | `make install` | 由 `start-win.ps1` 自动安装/启动 WSL daemon |
| 卸载守护 | `make uninstall` | `wsl -d Ubuntu --cd <repo_wsl_path> bash -lc 'make uninstall'` |
| 暂停守护 | `make pause` | `wsl -d Ubuntu --cd <repo_wsl_path> bash -lc 'make pause'` |
| 恢复守护 | `make resume` | `wsl -d Ubuntu --cd <repo_wsl_path> bash -lc 'make resume'` |

守护模式下，仅执行 `make stop` 可能触发自动重启。应使用 `make pause` 保持停止，之后用 `make resume` 恢复。

### macOS 防睡眠（仅 macOS）

macOS 的屏保/锁屏通常不会杀进程，但系统睡眠会让任务暂停。长时间运行建议开启：

```bash
make start-awake   # 启动循环并保持系统唤醒（直到循环退出）

# 如果循环已经在跑（比如你已执行 make start）：
make awake         # 读取 .auto-loop.pid 并对该 PID 挂 caffeinate
```

说明：
- 这两个命令依赖 macOS 自带 `caffeinate`
- `make awake` 会在 PID 结束后自动退出

## 架构技术介绍详单 (5-Layer Architecture)

Auto-Company 并非简单调用 LLM API，而是一个高度解耦的 **多智能体系统 (Multi-Agent System, MAS)**。其技术架构分为 5 个清晰的层级：

```text
┌────────────────────────────────────────────────────────────┐
│ 5. 监控与人机交互层 (Observability & HITL)                 │
│    [ Dashboard看板 ]  [ 文件式引导 (consensus.md) ]       │
├────────────────────────────────────────────────────────────┤
│ 4. 工作流路由层 (Workflow Routing & Teaming)               │
│    [ 按角色组队 (Squad) ]  [ 提示词工作流指导 ]           │
├────────────────────────────────────────────────────────────┤
│ 3. 智能体模型与认知层 (Agentic Models & Cognition)         │
│    [ 14 个专家人格 (Personas) ]  [ 30+ 技能库 (Skills) ]   │
├────────────────────────────────────────────────────────────┤
│ 2. 编排与状态控制层 (Orchestration & State Machine)        │
│    [ 持续主循环 ]  [ 持久状态 ]  [ 容错与熔断 ]          │
├────────────────────────────────────────────────────────────┤
│ 1. 基础设施与执行引擎层 (Execution Engine & Infrastructure)│
│    [ 引擎适配器 (Adapters) ]  [ 跨平台守护进程 (Daemon) ] │
└────────────────────────────────────────────────────────────┘
```

### 第 5 层：监控与人机交互层 (Observability & HITL)
*   **文件式引导 (File-based Steering)**：停止当前运行后，在 `memories/consensus.md` 中修改 `Next Action` 来安排下一步，或修改 `Human Overrides` 来设置持续约束，然后启动或恢复。运行中编辑可能与模型更新和恢复操作冲突，不保证立即改变方向。
*   **日志与看板 (Dashboard)**：`logs/` 保存引擎实际输出（对已知凭据进行脱敏），以及每轮结果和可用的用量记录。输出详细程度取决于引擎，不保证包含完整思考链。`dashboard/` 按当前与历史轮次组织工作汇报和成果，并提供运行控制、状态、用量、预算与日志，不跟踪各个 Agent 的活跃度。

### 第 4 层：工作流路由层 (Workflow Routing & Teaming)
*   **按角色组队 (Role-based Teaming)**：组队技能建议从 14 份角色定义中选择 2–5 个相关角色。实际子代理创建和并发取决于执行模型与引擎，不代表 14 个常驻工作者或固定人数的调度器。
*   **工作流指导 (Workflow Guidance)**：`PROMPT.md` 要求团队从构思推进到验证和实现。这是提示词约定，不是程序强制执行的业务状态机；第三个引擎轮次不保证完成产品或部署。

### 第 3 层：智能体模型与认知层 (Agentic Models & Cognition)
*   **专家思维注入 (Expert Personas)**：在 `.claude/agents/` 下，注入具体的历史人物/行业领袖思维模型框架（如 Bezos 的“逆向工作法”、Munger 的“查理清单”、DHH 的“宏伟单体架构”），使决策具有极高的商业和工程厚度。
*   **技能库系统 (Skill Arsenal)**：位于 `.claude/skills/` 的可插拔插件系统（如 `frontend-design`, `security-audit`）。将具体方法论封装成工具，供任何被唤醒的 Agent “临时加载”。
*   **行为规则 (Behavioral Rules)**：`CLAUDE.md` 要求智能体遵守不删除仓库、不强制推送等规则。框架另有针对特定运行和配置边界的检查；提示词规则不能拦截任意命令，也不提供操作系统级沙箱。

### 第 2 层：编排与状态控制层 (Orchestration & State Machine)
*   **持续主循环 (The Auto-Loop)**：`scripts/core/auto-loop.sh` 调度重复的 CLI 调用、等待和失败处理；服务、模型访问、预算及运行检查允许时可以持续执行。
*   **共识记忆 (Consensus Memory)**：`memories/consensus.md` 在调用之间传递自然语言工作摘要。结构化产品身份、用量、配置和恢复记录另行保存，摘要不等于整个运行状态。
*   **容错与恢复机制 (Resilience & Recovery)**：内置熔断器（连续错误触发冷却）、限流退避（429 报错自动休眠），并在周期失败后恢复共识。Human Overrides、`.auto-company.local` 和框架根目录的 `.gitignore` 有定向保护。产品代码修改和外部副作用不会自动回滚。

### 第 1 层：基础设施与执行引擎层 (Execution Engine & Infrastructure)
*   **引擎适配器 (Engine Adapters)**：主要入口使用 **Claude Code**（默认）或 **Codex CLI**。另有需显式启用和配置的 **Cursor** 与 **OpenAI-compatible** 适配器，各引擎的工具与组队能力有所不同，详见[引擎适配说明](i18n/zh-CN/ENGINE_ADAPTERS.md)。
*   **跨平台守护进程 (Cross-Platform Daemon)**：macOS 基于 `launchd` 实现开机自启和崩溃重启；Windows/WSL 基于 `systemd --user` 在 WSL 容器内运行，外部通过 PowerShell 进行控制和保活。
*   **沙盒边界 (Sandbox Boundary)**：目前依赖底层 CLI 的配置（如 Codex 的 `danger-full-access` 或 Claude 的 `bypassPermissions`），系统级操作均在宿主机环境（或 WSL 容器）中直接发生。

## 运作机制

### 默认工作流指导

提示词建议按下列顺序推进。这些标签描述工作阶段，一个阶段可能跨越多个引擎轮次，不是完成期限或强制状态机。

| 周期 | 动作 |
|------|------|
| Cycle 1 | 头脑风暴——每个 Agent 提一个想法，排出 top 3 |
| Cycle 2 | 验证 #1——Munger 做 Pre-Mortem，Thompson 验证市场，Campbell 算账 → **GO / NO-GO** |
| Cycle 3+ | GO → 建 repo、写代码，在获得授权时部署。NO-GO → 试下一个。提示词要求推进实现，避免只有讨论的轮次 |

### 六大标准流程

以下是建议的角色协作链，实际任务和参与者由执行模型选择。

| # | 流程 | 协作链 |
|---|------|--------|
| 1 | **新产品评估** | 调研 → CEO → Munger → 产品 → CTO → CFO |
| 2 | **功能开发** | 交互 → UI → 全栈 → QA → DevOps |
| 3 | **产品发布** | QA → DevOps → 营销 → 销售 → 运营 → CEO |
| 4 | **定价变现** | 调研 → CFO → 销售 → Munger → CEO |
| 5 | **每周复盘** | 运营 → 销售 → CFO → QA → CEO |
| 6 | **机会发现** | 调研 → CEO → Munger → CFO |

## 引导方向

改变方向前，前台运行使用 `make stop`，macOS/WSL 守护模式使用 `make pause`，Windows 使用下表的停止命令。等运行停止后再编辑，然后重新启动或恢复。

| 方式 | 操作 |
|------|------|
| **改方向** | 停止后修改 `memories/consensus.md` 的 "Next Action"；持续约束写入 "Human Overrides" |
| **暂停** | `make pause`（macOS/WSL 守护模式）或 `.\scripts\windows\stop-win.ps1`（Windows 入口） |
| **恢复** | `make resume`，回到自主模式 |
| **审查产出** | 查看 `docs/*/`——每个 Agent 的工作成果 |

模型可以上报未解决的 P1，但必须保留已有 P1 条目，不能新增已勾选条目。人工应在停止运行并完成待处理恢复后解决问题，详见 [P1 问题与人工修改](docs/troubleshooting.md#p1-问题与人工修改)。

## 安全红线

`CLAUDE.md` 向智能体提供以下行为规则。它们与框架的特定检查共同使用，但不是通用命令拦截机制，也不保证每次违反规则的操作都被阻止：

- 不得删除 GitHub 仓库（`gh repo delete`）
- 不得删除 Cloudflare 项目（`wrangler delete`）
- 不得删除系统文件（`~/.ssh/`、`~/.config/` 等）
- 不得进行非法活动
- 不得泄露凭证到公开仓库
- 不得 force push 到 main/master
- 所有新项目必须在 `projects/` 目录下创建

## 配置

环境变量覆盖：

```bash
ENGINE=claude make start                   # 默认引擎；可选适配器见引擎适配说明
ENGINE=codex make start                    # 切换到 codex
MODEL=sonnet make start                    # 可选：临时覆盖模型
CLAUDE_PERMISSION_MODE=bypassPermissions make start  # Claude 权限模式
LOOP_INTERVAL=60 make start                # 60 秒间隔（默认 30）
CYCLE_TIMEOUT_SECONDS=3600 make start      # 单轮超时 1 小时（默认 1800）
MAX_CONSECUTIVE_ERRORS=3 make start        # 熔断阈值（默认 5）
CODEX_SANDBOX_MODE=workspace-write make start  # 可选：覆盖 codex 沙箱模式
CLAUDE_BIN=/usr/local/bin/claude make start     # 可选：覆盖 Claude 可执行路径
CODEX_BIN=/usr/local/bin/codex make start       # 可选：覆盖 Codex 可执行路径
```

Windows `start-win.ps1` 会把同名配置写入 `.auto-loop.env`：

```powershell
.\scripts\windows\start-win.ps1 -Engine claude -ClaudePermissionMode bypassPermissions
.\scripts\windows\start-win.ps1 -Engine codex -SandboxMode workspace-write
# 兼容旧参数：
.\scripts\windows\start-win.ps1 -Engine codex -CodexSandboxMode workspace-write
```

不会自动进行引擎回退。所选引擎缺失时会直接启动失败。

## 项目结构

```
auto-company/
├── CLAUDE.md              # 公司章程（使命 + 安全红线 + 团队 + 流程）
├── PROMPT.md              # 每轮工作指令（收敛规则）
├── Makefile               # 常用命令
├── INDEX.md               # 脚本索引与职责表
├── dashboard/             # 本地 Web 状态看板（macOS 用 make dashboard，Windows 用 dashboard-win.ps1）
├── scripts/
│   ├── core/              # 主循环与核心控制实现（auto-loop/monitor/stop）
│   ├── windows/           # Windows 入口/守护/自启实现
│   ├── wsl/               # WSL systemd --user 守护实现
│   └── macos/             # macOS launchd 守护实现
├── memories/
│   └── consensus.md       # 共识记忆（跨轮次工作摘要）
├── docs/                  # Agent 产出（14 个目录 + Windows 指南）
├── projects/              # 所有新建项目的工作空间
├── logs/                  # 循环日志
└── .claude/
    ├── agents/            # 14 个 Agent 定义（专家人格）
    ├── skills/            # 30+ 技能（调研、财务、营销……）
    └── settings.json      # 权限 + Agent Teams 开关
```

## 依赖

| 依赖 | 说明 |
|------|------|
| **Claude Code / Codex CLI** | 支持的 CLI 引擎（默认 Claude） |
| 可选引擎适配器 | Cursor 与 OpenAI-compatible，需显式启用，见[引擎适配说明](i18n/zh-CN/ENGINE_ADAPTERS.md) |
| **macOS 或 Windows + WSL2 (Ubuntu)** | macOS 支持 launchd；Windows 走 WSL 执行内核 |
| **Python 3.10+** | 必需：macOS/WSL 使用 `python3`；Windows 的 PowerShell 看板和本地语言命令还需 `python` |
| `git` | 克隆仓库与管理产品仓库 |
| `node` | npm 安装 CLI 的运行时 |
| `make` | 启停与监控命令入口（WSL/macOS） |
| `jq` | 推荐，辅助处理日志 |
| `gh` | 可选，GitHub CLI |
| `wrangler` | 可选，Cloudflare CLI |

## 常见问题

### 1) WSL 跑 `.sh` 报 `^M` / `bad interpreter`

- 原因：Windows CRLF 换行导致 Bash 识别失败
- 处理：
  - 保持仓库 `.gitattributes` 为 LF 规则
  - 在仓库执行 `git config core.autocrlf false && git config core.eol lf`

### 2) WSL 报 `codex`/`claude` 命令不存在

- 原因：只在 Windows 安装了 CLI，WSL 环境缺失
- 处理：在 WSL 内安装 `node` 与你选择的 CLI（`@openai/codex` 或 Claude Code）

### 3) Claude 卡在权限确认，周期看起来像阻塞

- 原因：Claude CLI 权限模式过严
- 处理：设置 `CLAUDE_PERMISSION_MODE=bypassPermissions`（或在 `start-win.ps1` 传 `-ClaudePermissionMode bypassPermissions`）
- 验证：检查 `logs/auto-loop.log` 是否包含 `Engine: claude` 与 `PermissionMode: ...`

### 4) 在 WSL 执行 `make install` 失败

- 原因：WSL 当前会话没有可用的 `systemctl --user`
- 处理：
  - 确认 WSL 已启用 systemd
  - 执行 `systemctl --user --version`
  - 若仍失败，重新登录 WSL 会话后重试

## ⚠️ 免责声明

这是一个**实验项目**：

- **守护进程在 macOS/WSL 均可用** — macOS 依赖 launchd，WSL 依赖 systemd --user
- **Windows 入口需要 WSL** — PowerShell 只做控制层
- **还在测试中** — 能跑，但不保证稳定
- **会花钱** — 每个周期消耗模型额度
- **权限配置很重要** — 默认引擎设置允许无需常规确认的广泛本地操作。请检查引擎权限和 `CLAUDE.md`；提示词规则本身不提供隔离
- **无担保** — AI 可能会构建你意想不到的东西，定期检查 `docs/` 和 `projects/`

建议先用 `make start`（前台）观察行为，再启用守护模式（macOS/WSL：`make install`，Windows：`.\scripts\windows\start-win.ps1`）。

## 致谢

感谢以下贡献者，他们的问题反馈、修复和方案推动了 Auto Company 的发展：

| 贡献者 | 具体贡献 | 来源 |
|---|---|---|
| [@JasonQWJ](https://github.com/JasonQWJ) | 早期 macOS Dashboard 提案与实现尝试，为 `v1.1.0` 方案提供参考 | [#1](https://github.com/MaxMiksa/Auto-Company/pull/1) |
| [@cnwillz](https://github.com/cnwillz) | 推动 macOS Dashboard 支持，为跨平台实现提供参考 | [#2](https://github.com/MaxMiksa/Auto-Company/pull/2) |
| [@chbndrhnns](https://github.com/chbndrhnns) | 报告脚本缺少执行位导致的首次启动失败 | [#5](https://github.com/MaxMiksa/Auto-Company/issues/5) |
| [@Sittichai9680](https://github.com/Sittichai9680) | 推动 Linux/WSL Dashboard 支持方向 | [#9](https://github.com/MaxMiksa/Auto-Company/pull/9) |
| [@allenter](https://github.com/allenter) | 推动成本监控、预算告警及脚本入口执行位修复 | [#13](https://github.com/MaxMiksa/Auto-Company/pull/13)、[#14](https://github.com/MaxMiksa/Auto-Company/pull/14) |
| [@maxgoff](https://github.com/maxgoff) | 记录 Cycle 超时后引擎残留的实际问题，提出完整进程树清理方向 | [Fork 贡献](https://github.com/maxgoff/Auto-Company/commit/861d678fc3070d385e3771591cb6468f2857aa05) |
| [@omergeiger](https://github.com/omergeiger) | 为 Human Overrides 原样保护和 P1 问题阻断提供方向 | [Human Overrides](https://github.com/omergeiger/Auto-Company/commit/cb1dba1b687eaf700258411f562fd2986586c82d)、[P1 问题](https://github.com/omergeiger/Auto-Company/commit/4730a7d03c25e49035be95e48bda428f983e176e) |
| [@NicklasSandin](https://github.com/NicklasSandin) | 推动英文文档和英文使用体验 | [#21](https://github.com/MaxMiksa/Auto-Company/pull/21) |
| [@mdoganexe](https://github.com/mdoganexe) | 报告并贡献 systemd 安装、WSL 发行版选择及区域设置相关配置处理的修复 | [#27](https://github.com/MaxMiksa/Auto-Company/pull/27)、[#28](https://github.com/MaxMiksa/Auto-Company/pull/28) |

- [nicepkg/auto-company](https://github.com/nicepkg/auto-company) — macOS初版
- [continuous-claude](https://github.com/AnandChowdhary/continuous-claude) — 跨会话共享笔记
- [ralph-claude-code](https://github.com/frankbria/ralph-claude-code) — 退出信号拦截
- [claude-auto-resume](https://github.com/terryso/claude-auto-resume) — 用量限制恢复

## 许可证

框架采用 [MIT 许可证](LICENSE)。随附的第三方组件保留各自的许可条款和声明。

## 🤝 贡献与联系

欢迎提交 Issue 和 Pull Request！  
如有任何问题或建议，请联系 Zheyuan (Max) Kong (卡内基梅隆大学，宾夕法尼亚州)。

Zheyuan (Max) Kong: kongzheyuan@outlook.com | zheyuank@tepper.cmu.edu
本项目 GitHub 链接：https://github.com/MaxMiksa/Auto-Company

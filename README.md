<div align="center">

# Auto Company

**A fully autonomous AI company running 24/7** <a href="README-ZH.md"><img alt="[中文说明]" src="https://img.shields.io/badge/%5B%E4%B8%AD%E6%96%87%E8%AF%B4%E6%98%8E%5D-2f3640.svg" /></a>

Powered by **Agentic Workflows**, this project orchestrates 14 **Autonomous AI Agents**, each modeled after world-class experts in their domain.
They ideate products, make decisions, write code, deploy, and market - without human intervention.

Powered by Claude Code (default) and [Codex CLI](https://www.npmjs.com/package/@openai/codex) on macOS + Windows/WSL, with a local dashboard on both hosts.

[![macOS](https://img.shields.io/badge/Platform-macOS-blue?logo=apple&logoColor=white)](#dependencies)
[![Windows WSL](https://img.shields.io/badge/Platform-Windows%20WSL-blue?logo=windows&logoColor=white)](#windows-wsl-quick-start)
[![Codex CLI](https://img.shields.io/badge/Engine-Codex%20CLI-orange?logo=data:image/svg%2Bxml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMjQgMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0yMi4yODE5IDkuODIxMWE1Ljk4NDcgNS45ODQ3IDAgMCAwLS41MTU3LTQuOTEwOCA2LjA0NjIgNi4wNDYyIDAgMCAwLTYuNTA5OC0yLjlBNi4wNjUxIDYuMDY1MSAwIDAgMCA0Ljk4MDcgNC4xODE4YTUuOTg0NyA1Ljk4NDcgMCAwIDAtMy45OTc3IDIuOSA2LjA0NjIgNi4wNDYyIDAgMCAwIC43NDI3IDcuMDk2NiA1Ljk4IDUuOTggMCAwIDAgLjUxMSA0LjkxMDcgNi4wNTEgNi4wNTEgMCAwIDAgNi41MTQ2IDIuOTAwMUE2LjA2NTEgNi4wNjUxIDAgMCAwIDE5LjAyIDE5LjgxODJhNS45ODQ3IDUuOTg0NyAwIDAgMCAzLjk5NzctMi45MDAxIDYuMDQ2MiA2LjA0NjIgMCAwIDAtLjczNTgtNy4wOTdaTTguNzQ5IDYuNzU3OGE0LjQxMTggNC40MTE4IDAgMCAxIDcuMzY3MyAxLjE0NDQgNC4zOTg2IDQuMzk4NiAwIDAgMS0uMjkyOCA0LjIyODVsLTQuNzA3LTIuNzIxNHYtMi42NTE1Wk02LjUzMzIgMTQuNjU0YTQuNDExOCA0LjQxMTggMCAwIDEtMS4xMjkzLTcuMzcgNC4zOTg2IDQuMzk4NiAwIDAgMSA0LjEzNTItMS4zOWwyLjM2MTUgNC4wOTN2NS4zMDJMNi41MzMyIDE0LjY1NFptLTEuODQ4LTEuNTcyYTQuNDExOCA0LjQxMTggMCAwIDEgNi4yMzgtNi4yMjYgNC4zOTg2IDQuMzk4NiAwIDAgMSAzLjg0MzMgMi44MzhsLTQuNzA3IDIuNzIxdjUuMzAxNUw0LjY4NTIgMTMuMDgyWm0xMC41NjU4IDQuMTZhNC40MTE4IDQuNDExOCAwIDAgMS03LjM2NzMtMS4xNDQzIDQuMzk4NiA0LjM5ODYgMCAwIDEgLjI5MjgtNC4yMjg1bDQuNzA3IDIuNzIxNHYyLjY1MTRabTIuMjE1OC03Ljg5NmE0LjQxMTggNC40MTE4IDAgMCAxIDEuMTI5MyA3LjM3IDQuMzk4NiA0LjM5ODYgMCAwIDEtNC4xMzUyIDEuMzlsLTIuMzYxNS00LjA5M1Y5LjE4Nmw1LjM2NzQgMi4xODZabTEuODQ4IDEuNTcyYTQuNDExOCA0LjQxMTggMCAwIDEtNi4yMzggNi4yMjYgNC4zOTg2IDQuMzk4NiAwIDAgMS0zLjg0MzMtMi44MzhsNC43MDctMi43MjFWOS4xODZsNS4zNzQgMy4wOTZaTTEyIDE2LjUxNmE0LjQxMTggNC40MTE4IDAgMCAxLTQuNDExOC00LjQxMThjMC0yLjQzNDggMS45NzctNC40MTE4IDQuNDExOC00LjQxMThzNC40MTE4IDEuOTc3IDQuNDExOCA0LjQxMTgtMS45NzcgNC40MTE4LTQuNDExOCA0LjQxMThaIi8+PC9zdmc+&logoColor=white)](https://www.npmjs.com/package/@openai/codex)
[![Claude Code](https://img.shields.io/badge/Engine-Claude%20Code-purple?logo=anthropic&logoColor=white)](#dependencies)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?logo=opensourceinitiative&logoColor=white)](https://opensource.org/licenses/MIT)

</div>

---

## Dashboard Preview

![Auto Company Dashboard](presentation/dashboard-showcase.png)

## What Is This?

You start a loop. The AI team wakes up, reads shared consensus memory, decides what to do, forms a 3-5 person squad, executes, updates consensus memory, then sleeps briefly. Then it repeats.

```
daemon (launchd / systemd --user, auto-restart on crash)
  └── scripts/core/auto-loop.sh (continuous loop)
        ├── reads PROMPT.md + consensus.md
        ├── LLM CLI call (Codex CLI / Claude Code)
        │   ├── reads CLAUDE.md (charter + guardrails)
        │   ├── reads .claude/skills/team/SKILL.md (teaming method)
        │   ├── forms an Agent Team (3-5 agents)
        │   ├── executes: research, coding, deploy, marketing
        │   └── updates memories/consensus.md (handoff baton)
        ├── failure handling: rate-limit wait / circuit breaker / consensus rollback
        └── sleep -> next cycle
```

Each cycle is an independent CLI call. `memories/consensus.md` is the cross-cycle running-state baton. A supplemental persistent **vector memory** (`memories/vault/`) is auto-built from consensus snapshots + `docs/` and injected semantically each cycle for long-term recall (see Layer 2).

## Where To Start (By Platform)

- Windows users: start from [Windows (WSL) Quick Start](#windows-wsl-quick-start), then read [`docs/windows-setup.md`](docs/windows-setup.md)
- macOS users: start from [macOS Quick Start](#macos-quick-start), then see [Command Quick Reference](#command-quick-reference-by-platform)

## Team Lineup (14 Agents)

This is not "you are a generic developer". It is "you are DHH" style role prompting with real expert mental models.

| Layer | Role | Expert Persona | Core Strength |
|------|------|------|----------|
| **Strategy** | CEO | Jeff Bezos | PR/FAQ, flywheel thinking, Day 1 mindset |
| | CTO | Werner Vogels | Design for failure, API-first architecture |
| | Inversion | Charlie Munger | Inversion, pre-mortems, misjudgment checklist |
| **Product** | Product Design | Don Norman | Affordance, mental models, human-centered design |
| | UI Design | Matias Duarte | Material metaphor, typography-first design |
| | Interaction Design | Alan Cooper | Goal-directed design, persona-driven decisions |
| **Engineering** | Full-Stack | DHH | Convention over configuration, majestic monolith |
| | QA | James Bach | Exploratory testing, testing is not checking |
| | DevOps/SRE | Kelsey Hightower | Automation first, reliability discipline |
| **Business** | Marketing | Seth Godin | Purple cow, permission marketing, smallest viable audience |
| | Operations | Paul Graham | Do things that do not scale, ramen profitability |
| | Sales | Aaron Ross | Predictable revenue, funnel systems |
| | CFO | Patrick Campbell | Value-based pricing, unit economics |
| **Intelligence** | Research Analyst | Ben Thompson | Aggregation theory, value chain analysis |

Plus 30+ reusable skills (deep research, scraping, financial modeling, SEO, security audit, UX audit, etc.).

## macOS Quick Start

```bash
# Prerequisites:
# - macOS
# - Codex CLI or Claude Code installed and authenticated
# - Available model quota

# Clone
git clone https://github.com/MaxMiksa/Auto-Company.git
cd auto-company

# Foreground run (live output)
make start

# Or install daemon (auto-start + auto-restart)
make install
```

## Windows (WSL) Quick Start

```powershell
# Prerequisites:
# - Windows 10/11 + WSL2 (Ubuntu)
# - Codex CLI or Claude Code installed and authenticated inside WSL
# - jq and make available inside WSL
# - Available model quota

# Clone
git clone https://github.com/MaxMiksa/Auto-Company.git
cd auto-company

# Start (daemon mode via PowerShell, default engine = claude)
.\scripts\windows\start-win.ps1

# Switch engine explicitly
.\scripts\windows\start-win.ps1 -Engine codex

# Status
.\scripts\windows\status-win.ps1

# Stop
.\scripts\windows\stop-win.ps1
```

For monitoring, dashboard, and autostart commands, see [`docs/windows-setup.md`](docs/windows-setup.md).

## Command Quick Reference (By Platform)

| Task | macOS / WSL (Terminal) | Windows (PowerShell) |
|---|---|---|
| Start | `make start` | `.\scripts\windows\start-win.ps1` |
| Status | `make status` | `.\scripts\windows\status-win.ps1` |
| Live logs | `make monitor` | `.\scripts\windows\monitor-win.ps1` |
| Last cycle output | `make last` | `.\scripts\windows\last-win.ps1` |
| Cycle summary | `make cycles` | `.\scripts\windows\cycles-win.ps1` |
| Stop | `make stop` | `.\scripts\windows\stop-win.ps1` |
| Web dashboard | `make dashboard` | `.\scripts\windows\dashboard-win.ps1` |
| Install daemon | `make install` | Auto-installed/started by `start-win.ps1` |
| Uninstall daemon | `make uninstall` | `wsl -d Ubuntu --cd <repo_wsl_path> bash -lc 'make uninstall'` |
| Pause daemon | `make pause` | `wsl -d Ubuntu --cd <repo_wsl_path> bash -lc 'make pause'` |
| Resume daemon | `make resume` | `wsl -d Ubuntu --cd <repo_wsl_path> bash -lc 'make resume'` |

### macOS Sleep Prevention (macOS Only)

macOS screen lock usually does not kill processes, but system sleep can pause work. For long runs:

```bash
make start-awake   # Start loop and keep system awake until loop exits

# If loop is already running (after make start):
make awake         # Attach caffeinate to PID in .auto-loop.pid
```

Notes:
- Both commands depend on built-in `caffeinate`
- `make awake` exits automatically when target PID exits

## Architecture & Technology Stack (5-Layer Architecture)

Auto-Company is not a simple LLM API wrapper, but a highly decoupled **Multi-Agent System (MAS)**. Its technical architecture is divided into 5 distinct layers:

```text
┌────────────────────────────────────────────────────────────┐
│ 5. Observability & HITL (Human-In-The-Loop) Layer          │
│    [ Dashboard ]  [ File-based Steering (consensus.md) ]   │
├────────────────────────────────────────────────────────────┤
│ 4. Workflow Routing & Teaming Layer                        │
│    [ Dynamic Squad Routing ]  [ Forced Convergence Flow ]  │
├────────────────────────────────────────────────────────────┤
│ 3. Agentic Models & Cognition Layer                        │
│    [ 14 Expert Personas ]  [ 30+ Skill Arsenal ]           │
├────────────────────────────────────────────────────────────┤
│ 2. Orchestration & State Machine Layer                     │
│    [ 24/7 Auto-Loop ]  [ State Machine ]  [ Resilience ]   │
├────────────────────────────────────────────────────────────┤
│ 1. Execution Engine & Infrastructure Layer                 │
│    [ Dual-Engine (Claude/Codex) ]  [ Cross-Platform Daemon]│
└────────────────────────────────────────────────────────────┘
```

### Layer 5: Observability & HITL (Human-In-The-Loop)
*   **File-based Steering**: Humans only need to edit `memories/consensus.md` and modify the `Next Action`. The AI team waking up in the next cycle will immediately pivot, enabling minimalist macro-control.
*   **Full-chain Logs & Dashboard**: `logs/` records the complete output and chain-of-thought for each cycle. `dashboard/` provides a local visualization dashboard based on a Python server, displaying real-time cycle status, cost consumption, and agent activity.

### Layer 4: Workflow Routing & Teaming
*   **Dynamic Squad Formation**: Powered by Agent Teams, the system dynamically selects 2-5 of the most suitable experts from the 14-person pool based on the "Next Action" in `consensus.md`, instantiating them as sub-agents for the current loop.
*   **Forced Convergence Flow**: Hardcoded flow control in `PROMPT.md`. For example: Cycle 1 Ideation -> Cycle 2 Validation (Pre-mortem, GO/NO-GO) -> Cycle 3 Execution (Code & Deploy, **pure discussion is forbidden**).

### Layer 3: Agentic Models & Cognition
*   **Expert Personas Injection**: Instead of generic prompts, it injects specific mental models of historical figures/industry leaders (e.g., Bezos's "Working Backwards", Munger's "Checklists", DHH's "Majestic Monolith") into `.claude/agents/`, giving decisions extreme business and engineering depth.
*   **Skill Arsenal**: A pluggable system located in `.claude/skills/` (e.g., `frontend-design`, `security-audit`). Specific methodologies are encapsulated as tools that any awakened Agent can "temporarily load".
*   **Constitutional Guardrails**: System-level prompts hardcoded in `CLAUDE.md` set absolute bottom lines (e.g., no deleting repos, no force pushes) to ensure safety under high autonomy.

### Layer 2: Orchestration & State Machine
*   **The Auto-Loop**: The execution loop controlled by `scripts/core/auto-loop.sh` frees the AI from "single-turn conversations", enabling 24/7 continuous operation.
*   **Lightweight State Machine (Consensus Memory)**: Compresses cross-cycle running context into a single Markdown file: `memories/consensus.md` (read before every cycle, rewritten before it ends — the "baton").
*   **Persistent Vector Memory (Long-term Recall)**: Layered on top of the baton. `scripts/core/memory_vault.py` indexes consensus snapshots + `docs/` outputs into `memories/vault/index.json` (pure-Python TF-IDF + cosine, zero external deps, ~zero cost). Each new cycle auto-retrieves the top semantically-relevant historical blocks and injects them into the prompt, so past decisions and details that consensus.md has collapsed away remain recallable. Swappable backend: replace `_embed_chunk()` to plug in ChromaDB or a model embedding.
*   **Resilience & Self-Healing**: Built-in circuit breakers (cooldown triggered by consecutive errors), rate-limit backoff (auto-sleep on 429 errors), and sandbox reset (auto-rollback if a valid consensus is not output).

### Layer 1: Execution Engine & Infrastructure
*   **Dual-Engine Executor**: Acts as the underlying executor by calling mature AI CLIs (**Claude Code** or **Codex CLI**), naturally inheriting their file I/O, Bash execution, and Git operation capabilities.
*   **Cross-Platform Daemon**: macOS uses `launchd` for auto-start and crash recovery; Windows/WSL runs via `systemd --user` inside a WSL container, controlled and kept alive externally via PowerShell.
*   **Sandbox Boundary**: Currently relies on underlying CLI configurations (like Codex's `danger-full-access` or Claude's `bypassPermissions`). System-level operations occur directly in the host environment (or WSL container).

## Operating Model

### Automatic Convergence (No Endless Discussion)

| Cycle | Action |
|------|------|
| Cycle 1 | Brainstorm: each agent proposes ideas, rank top 3 |
| Cycle 2 | Validate #1: Munger pre-mortem + Thompson market check + Campbell economics -> **GO / NO-GO** |
| Cycle 3+ | GO -> create repo, build, deploy. NO-GO -> move to next idea. Discussion-only loops are forbidden |

### Six Standard Workflows

| # | Workflow | Collaboration Chain |
|---|------|--------|
| 1 | **New Product Evaluation** | Research -> CEO -> Munger -> Product -> CTO -> CFO |
| 2 | **Feature Development** | Interaction -> UI -> Full-stack -> QA -> DevOps |
| 3 | **Product Launch** | QA -> DevOps -> Marketing -> Sales -> Ops -> CEO |
| 4 | **Pricing and Monetization** | Research -> CFO -> Sales -> Munger -> CEO |
| 5 | **Weekly Review** | Ops -> Sales -> CFO -> QA -> CEO |
| 6 | **Opportunity Discovery** | Research -> CEO -> Munger -> CFO |

## Steering

The team runs autonomously, but you can intervene at any time:

| Method | Action |
|------|------|
| **Change direction** | Edit "Next Action" in `memories/consensus.md` |
| **Pause** | `make pause` (macOS/WSL daemon mode) or `.\scripts\windows\stop-win.ps1` (Windows entry) |
| **Resume** | `make resume` |
| **Review outputs** | Check `docs/*/` for artifacts generated by agents |

## Safety Guardrails

Hard constraints in `CLAUDE.md`, enforced for all agents:

- Do not delete GitHub repos (`gh repo delete`)
- Do not delete Cloudflare projects (`wrangler delete`)
- Do not delete system directories (`~/.ssh/`, `~/.config/`, etc.)
- Do not perform illegal activity
- Do not leak credentials into public repositories
- Do not force push to main/master
- Create all new projects under `projects/`

## Configuration

Environment variable overrides:

```bash
ENGINE=claude make start                   # Default engine (claude|codex)
ENGINE=codex make start                    # Switch to codex
MODEL=sonnet make start                    # Optional model override
CLAUDE_PERMISSION_MODE=bypassPermissions make start  # Claude permission mode
LOOP_INTERVAL=60 make start                # 60s interval (default 30)
CYCLE_TIMEOUT_SECONDS=3600 make start      # 1h cycle timeout (default 1800)
MAX_CONSECUTIVE_ERRORS=3 make start        # Circuit-breaker threshold (default 5)
CODEX_SANDBOX_MODE=workspace-write make start  # Optional sandbox override
CLAUDE_BIN=/usr/local/bin/claude make start     # Optional Claude binary override
CODEX_BIN=/usr/local/bin/codex make start       # Optional Codex binary override
```

Windows `start-win.ps1` writes the same values into `.auto-loop.env`:

```powershell
.\scripts\windows\start-win.ps1 -Engine claude -ClaudePermissionMode bypassPermissions
.\scripts\windows\start-win.ps1 -Engine codex -SandboxMode workspace-write
# Backward compatibility:
.\scripts\windows\start-win.ps1 -Engine codex -CodexSandboxMode workspace-write
```

No automatic engine fallback is performed. If the selected engine is missing, startup fails fast.

## Project Structure

```
auto-company/
├── CLAUDE.md              # Company charter (mission + guardrails + team + workflows)
├── PROMPT.md              # Per-cycle execution prompt (convergence rules)
├── Makefile               # Common command entry
├── INDEX.md               # script index + responsibility table
├── dashboard/             # Local web status dashboard (macOS: make dashboard, Windows: dashboard-win.ps1)
├── scripts/
│   ├── core/              # Core loop and control scripts (auto-loop/monitor/stop)
│   ├── windows/           # Windows entry/guardian/autostart scripts
│   ├── wsl/               # WSL systemd --user daemon scripts
│   └── macos/             # macOS launchd daemon scripts
├── memories/
│   └── consensus.md       # Shared handoff memory across cycles
├── docs/                  # Agent outputs (14 folders + Windows guide)
├── projects/              # Workspace for generated projects
├── logs/                  # Loop logs
└── .claude/
    ├── agents/            # 14 agent definitions (expert personas)
    ├── skills/            # 30+ reusable skills
    └── settings.json      # Permissions + Agent Teams switch
```

## Dependencies

| Dependency | Notes |
|------|------|
| **Claude Code / Codex CLI** | Supported CLI engines (default: Claude) |
| **macOS or Windows + WSL2 (Ubuntu)** | macOS uses launchd; Windows uses WSL execution core |
| `node` | Runtime for npm-installed CLI tools |
| `make` | Start/stop/monitor command entry (WSL/macOS) |
| `jq` | Recommended for log processing |
| `gh` | Optional, GitHub CLI |
| `wrangler` | Optional, Cloudflare CLI |

## FAQ

### 1) WSL `.sh` fails with `^M` / `bad interpreter`

- Cause: CRLF line endings in shell scripts
- Fix:
  - Keep LF rules in `.gitattributes`
  - Run `git config core.autocrlf false && git config core.eol lf`

### 2) WSL says `codex`/`claude` command not found

- Cause: CLI installed on Windows only, missing in WSL
- Fix: install `node` and your chosen CLI inside WSL (`@openai/codex` or Claude Code)

### 3) Claude waits for permission and cycles appear blocked

- Cause: strict permission mode in Claude CLI
- Fix: set `CLAUDE_PERMISSION_MODE=bypassPermissions` (or pass `-ClaudePermissionMode bypassPermissions` in `start-win.ps1`)
- Verify: check `logs/auto-loop.log` for `Engine: claude` and `PermissionMode: ...`

### 4) `make install` fails inside WSL

- Cause: no available `systemctl --user` in current session
- Fix:
  - Verify WSL systemd is enabled
  - Run `systemctl --user --version`
  - Re-open WSL session and retry if needed

## Disclaimer

This is an **experimental project**:

- **Daemon mode works on both macOS and WSL**: launchd on macOS, systemd --user on WSL
- **Windows entry requires WSL**: PowerShell is only the control layer
- **Still under test**: runs, but stability is not guaranteed
- **Costs money**: each cycle consumes model quota
- **Fully autonomous**: agents act without approval prompts; configure guardrails carefully in `CLAUDE.md`
- **No warranty**: review `docs/` and `projects/` regularly

Suggested rollout: start with `make start` (foreground), then move to daemon mode (`make install` on macOS/WSL, `.\scripts\windows\start-win.ps1` on Windows).

## Acknowledgments

- Thanks to [@JasonQWJ](https://github.com/JasonQWJ) and [@cnwillz](https://github.com/cnwillz) for earlier macOS dashboard support proposals and implementation attempts that helped inform the final cross-platform dashboard design released in `v1.1.0`.
- [nicepkg/auto-company](https://github.com/nicepkg/auto-company) - initial macOS edition
- [continuous-claude](https://github.com/AnandChowdhary/continuous-claude) - cross-session shared notes
- [ralph-claude-code](https://github.com/frankbria/ralph-claude-code) - exit signal interception
- [claude-auto-resume](https://github.com/terryso/claude-auto-resume) - usage-limit resume pattern

## 🤝 Contribution & Contact

Welcome to submit Issues and Pull Requests!
Any questions or suggestions? Please contact Zheyuan (Max) Kong (Carnegie Mellon University, Pittsburgh, PA).

Zheyuan (Max) Kong: kongzheyuan@outlook.com | zheyuank@tepper.cmu.edu
GitHub: https://github.com/MaxMiksa/Auto-Company


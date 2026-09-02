# Auto Company Index

## Purpose

This file is a quick map of the repository layout, what each script is responsible for, and how they call each other — for maintenance and troubleshooting.

## Directory Layout (current)

### Implementation directories (the only script entry points)

- `scripts/windows/`: Windows control, keepalive, and autostart scripts
- `scripts/core/`: main loop and core control scripts
- `scripts/wsl/`: WSL / Linux `systemd --user` daemon scripts
- `scripts/linux/`: native Linux dashboard status and start/stop scripts
- `scripts/macos/`: macOS `launchd` daemon scripts

Note: there is no longer a script wrapper layer in the repository root. Execution and maintenance both go through `scripts/`.

### Other key directories

- `docs/`: documentation
- `logs/`: runtime logs
- `memories/`: consensus file
- `projects/`: projects produced by the auto company

## Core Runtime Logic (Win + WSL)

Default call chain:

`scripts/windows/start-win.ps1` -> WSL `systemd --user auto-company.service` -> `scripts/core/auto-loop.sh`

Notes:
- The default engine is `ENGINE=claude`
- Switch to Codex via `.auto-loop.env` or `start-win.ps1 -Engine codex`
- There is no automatic engine fallback; if the selected engine is missing, it fails outright

Stop chain:

`scripts/windows/stop-win.ps1` -> stop `auto-company.service` + stop the `awake guardian` + stop the `wsl anchor`

## Core Runtime Logic (native Linux)

Default call chain:

`make start` -> `scripts/core/auto-loop.sh`

Daemon call chain:

`make install` -> `scripts/wsl/install-wsl-daemon.sh` -> `systemd --user auto-company.service` -> `scripts/core/auto-loop.sh`

Notes:
- `scripts/wsl/install-wsl-daemon.sh` is the generic `systemd --user` installer; it is WSL-named for historical reasons but has no WSL dependency
- `make dashboard` serves the dashboard directly on the Linux host
- `make start-awake` / `make awake` hold a `systemd-inhibit` sleep lock, the Linux counterpart of macOS `caffeinate`

## Script Responsibilities (entry / daemon / autostart / diagnostics)

| Category | Script path | Main responsibility |
|---|---|---|
| Entry | `scripts/windows/start-win.ps1` | Start the WSL daemon, write `.auto-loop.env` (supports `ENGINE/CLAUDE_PERMISSION_MODE/CODEX_SANDBOX_MODE`), start sleep prevention and WSL keepalive |
| Entry | `scripts/windows/stop-win.ps1` | Stop the daemon and reclaim sleep prevention and WSL keepalive |
| Entry | `scripts/windows/status-win.ps1` | Aggregate all five status layers: guardian / keepalive / autostart / daemon / loop |
| Diagnostics | `scripts/windows/monitor-win.ps1` | Live logs |
| Diagnostics | `scripts/windows/last-win.ps1` | Full output of the most recent cycle |
| Diagnostics | `scripts/windows/cycles-win.ps1` | Cycle summary |
| Diagnostics | `scripts/windows/dashboard-win.ps1` | Start the local web dashboard |
| Keepalive | `scripts/windows/awake-guardian-win.ps1` | Prevent sleep while running (`start/stop/status/run`) |
| Keepalive | `scripts/windows/wsl-anchor-win.ps1` | Keep the WSL session resident (`start/stop/status/run`) |
| Autostart | `scripts/windows/enable-autostart-win.ps1` | Create the login autostart task |
| Autostart | `scripts/windows/disable-autostart-win.ps1` | Delete the login autostart task |
| Autostart | `scripts/windows/autostart-status-win.ps1` | Query autostart task status |
| Daemon | `scripts/wsl/install-wsl-daemon.sh` | Install and enable `auto-company.service` (WSL and native Linux) |
| Daemon | `scripts/wsl/uninstall-wsl-daemon.sh` | Uninstall the systemd user daemon |
| Daemon | `scripts/wsl/wsl-daemon-status.sh` | Query systemd user daemon status |
| Daemon | `scripts/macos/install-daemon.sh` | macOS launchd install/uninstall |
| Dashboard | `scripts/linux/status-linux.sh` | Linux status report for the dashboard (`systemd --user` backed) |
| Dashboard | `scripts/linux/start-linux.sh` | Dashboard Start action on Linux: install the unit if absent, then start it |
| Dashboard | `scripts/linux/stop-linux.sh` | Dashboard Stop action on Linux: stop the unit and signal any foreground loop |
| Dashboard | `scripts/macos/status-mac.sh` | macOS status report for the dashboard (`launchd` backed) |
| Core | `scripts/core/auto-loop.sh` | Main loop execution, circuit breaker, logging, consensus updates |
| Core | `scripts/core/monitor.sh` | Core status / log output |
| Core | `scripts/core/stop-loop.sh` | Core stop / pause / resume control |

## Fast Troubleshooting Path

### Windows

1. Start with `scripts/windows/status-win.ps1`
2. Then `scripts/windows/dashboard-win.ps1` or `scripts/windows/monitor-win.ps1`
3. For daemon problems, check `scripts/wsl/wsl-daemon-status.sh`
4. For autostart problems, check `scripts/windows/autostart-status-win.ps1` (for permission errors, check for an Administrator PowerShell first)

### Linux / macOS

1. Start with `make status`
2. Then `make dashboard` or `make monitor`
3. For daemon problems, check `systemctl --user status auto-company.service` (Linux) or `scripts/macos/status-mac.sh` (macOS)
4. If the engine binary cannot be found, pin it in `.auto-loop.env` with `CLAUDE_BIN=` or `CODEX_BIN=`

## Maintenance Rules

1. New functionality goes into the implementation scripts under `scripts/` first.
2. Documentation changes must be kept in sync across:
   - `README.md`
   - `README-ZH.md`
   - `docs/windows-setup.md`
   - `docs/linux-setup.md`
   - this index file, `INDEX.md`

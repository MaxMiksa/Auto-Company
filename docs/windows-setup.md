# Windows + WSL Setup Guide

On Windows this project uses:

- Windows PowerShell as the control entry point
- WSL2 (Ubuntu + systemd) as the execution kernel
- WSL `systemd --user` for the daemon and automatic restart after a crash
- Windows `scripts/windows/awake-guardian-win.ps1` to prevent sleep while running
- Windows `scripts/windows/wsl-anchor-win.ps1` to keep the WSL session alive (preventing an idle exit)

## 1. One-Time Install (inside WSL)

Run this in an Ubuntu terminal:

```bash
sudo apt update
sudo apt install -y make jq curl

# Install Node.js (LTS recommended)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# Install Claude Code (the default engine)
npm install -g @anthropic-ai/claude-code

# Optional: install Codex CLI (for ENGINE=codex)
npm install -g @openai/codex
```

## 2. One-Time Self-Check (inside WSL)

```bash
make --version
claude --version
codex --version
jq --version
systemctl --user --version
ps -p 1 -o comm=
```

Pass criteria:
- `systemctl --user --version` succeeds
- `ps -p 1 -o comm=` outputs `systemd`

It is also worth checking the engine paths (at minimum, the engine you intend to use):

```bash
bash -lc 'command -v claude; claude --version'
bash -lc 'command -v codex; codex --version'
bash -ic 'command -v claude; claude --version'
bash -ic 'command -v codex; codex --version'
```

These should resolve to a WSL-local path (`/home/<user>/...`) rather than `/mnt/c/...`.

It is worth enabling linger once, to make the user service more persistent:

```powershell
wsl -d Ubuntu -u root loginctl enable-linger <your-user>
```

## 3. Prerequisites (before every session)

1. `make`, `claude`, `jq`, and `systemctl --user` are available inside WSL (if you need codex, confirm `codex` as well).
2. The target engine is signed in and working inside WSL (`claude` by default).
3. Confirm that the target engine resolves to a WSL-local path (`/home/...`) first.

Optional quick check (PowerShell):

```powershell
wsl -d Ubuntu bash -lc 'make --version; claude --version; jq --version; systemctl --user --version'
wsl -d Ubuntu bash -lc 'command -v claude'
# Optional (for ENGINE=codex):
wsl -d Ubuntu bash -lc 'codex --version; command -v codex'
```

## 4. Recommended Operation (standard)

Run from the repository root:

```powershell
# Claude by default
.\scripts\windows\start-win.ps1 -Engine claude -ClaudePermissionMode bypassPermissions -CycleTimeoutSeconds 1800 -LoopInterval 30

# Switch to Codex
.\scripts\windows\start-win.ps1 -Engine codex -SandboxMode workspace-write -CycleTimeoutSeconds 1800 -LoopInterval 30

.\scripts\windows\status-win.ps1
.\scripts\windows\monitor-win.ps1
.\scripts\windows\last-win.ps1
.\scripts\windows\cycles-win.ps1
.\scripts\windows\stop-win.ps1
.\scripts\windows\dashboard-win.ps1
```

Notes:
- `.\scripts\windows\start-win.ps1` writes `.auto-loop.env` and starts `auto-company.service` + the awake guardian + the WSL anchor
- `.\scripts\windows\stop-win.ps1` stops `auto-company.service` and shuts down the awake guardian and the WSL anchor
- `.\scripts\windows\dashboard-win.ps1` starts the local web dashboard (`http://127.0.0.1:8787` by default)

Recommended parameters:
- `CycleTimeoutSeconds`: `900-1800`
- `LoopInterval`: `30-60`
- `Engine`: `claude` (default) or `codex`
- `SandboxMode`: only takes effect when `ENGINE=codex` (the older `CodexSandboxMode` parameter is still accepted)
- `ClaudePermissionMode`: `bypassPermissions` by default

Where the scripts live:
- All script implementations are under `scripts/windows/`, `scripts/core/`, `scripts/wsl/`, `scripts/linux/`, and `scripts/macos/`
- Day-to-day execution also goes through the scripts under `scripts/`
- To change behavior, edit the corresponding implementation file under `scripts/` directly

## 5. Optional: Autostart After Login

Disabled by default. To enable it:

```powershell
.\scripts\windows\enable-autostart-win.ps1
.\scripts\windows\autostart-status-win.ps1
```

To disable:

```powershell
.\scripts\windows\disable-autostart-win.ps1
```

The autostart task is named `AutoCompany-WSL-Start` (trigger: at logon).
If you get `Access is denied`, re-run it from an Administrator PowerShell.

## 6. Chat-First Mode (talking to Claude/Codex)

If you would rather not run commands by hand, you can talk to Claude/Codex directly on Windows and have it operate on your behalf.

The underlying chain:

`scripts/windows/start-win.ps1` -> WSL `systemd --user` -> `scripts/core/auto-loop.sh`

Behavior is identical to the manual commands; only the entry point differs.

## 7. Troubleshooting

### `bad interpreter: /bin/bash^M`

- Cause: the file has CRLF line endings
- Fix:

```bash
git config core.autocrlf false
git config core.eol lf
```

### `claude`/`codex` command not found (or node not found)

- Cause: Node or the target engine CLI is missing inside WSL
- Fix: go back to step 1 and reinstall

### Claude hangs on a permission confirmation at runtime

- Cause: `CLAUDE_PERMISSION_MODE` is set too strictly, which blocks the non-interactive flow
- Fix: pass `-ClaudePermissionMode bypassPermissions` explicitly at startup
- To diagnose: check `Engine: claude | ... | PermissionMode: ...` in `logs/auto-loop.log`

### `systemctl --user` is unavailable

- Cause: systemd is not enabled in WSL, or the session did not initialize correctly
- Fix:
  - First confirm that `ps -p 1 -o comm=` reports `systemd`
  - Then verify `systemctl --user --version`
  - If necessary, reopen the WSL session and retry

### The log shows the engine binary at `/mnt/c/...`

- Cause: PATH resolves to the Windows-side CLI first
- Impact: version and behavior may differ from a WSL-local terminal
- Fix: install inside WSL and prefer the local CLI (`/home/<user>/...`)

### The guardian fails to start

- Symptom: `scripts/windows/start-win.ps1` reports that the daemon started, but the guardian failed and returned non-zero
- Fix: run `.\scripts\windows\status-win.ps1` first to confirm the service state, then start it manually with `.\scripts\windows\awake-guardian-win.ps1 -Action start`

### Repeated `Cycle #1 START` accompanied by `Auto Loop Shutting Down`

- Cause: the WSL session is being reclaimed (common when linger is off or keepalive is missing)
- Fix:
  - Confirm the `wsl-anchor` is RUNNING: `.\scripts\windows\status-win.ps1`
  - Enable linger once: `wsl -d Ubuntu -u root loginctl enable-linger <your-user>`
  - Restart the service: `.\scripts\windows\stop-win.ps1` then `.\scripts\windows\start-win.ps1`

### The autostart script reports `Access is denied`

- Cause: the current PowerShell lacks the privileges to write a scheduled task
- Fix: run these from an Administrator PowerShell:
  - `.\scripts\windows\enable-autostart-win.ps1`
  - `.\scripts\windows\disable-autostart-win.ps1`

# Linux Setup Guide

This guide covers running Auto Company on a **native Linux host** (not WSL). If you are on Windows, read [`windows-setup.md`](windows-setup.md) instead.

On Linux the project uses:

- `make` as the control entry point
- `systemd --user` for the daemon and automatic restart after a crash
- `systemd-inhibit` to prevent sleep while running (the counterpart of macOS `caffeinate`)
- `scripts/linux/status-linux.sh` as the status source for the local web dashboard

There is no PowerShell layer and no WSL interop. The scripts under `scripts/wsl/` are the generic `systemd --user` implementation and work unchanged on native Linux; they are WSL-named for historical reasons.

## 1. One-Time Install

```bash
# Debian / Ubuntu
sudo apt update
sudo apt install -y make jq curl git python3

# Fedora
# sudo dnf install -y make jq curl git python3

# Arch
# sudo pacman -S --needed make jq curl git python
```

Then install Node.js and at least one engine CLI:

```bash
# Node.js (LTS recommended)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# Claude Code (the default engine)
npm install -g @anthropic-ai/claude-code

# Optional: Codex CLI (for ENGINE=codex)
npm install -g @openai/codex
```

Sign in to whichever engine you plan to use before starting the loop.

## 2. One-Time Self-Check

```bash
make --version
jq --version
python3 --version
claude --version
systemctl --user --version
```

Pass criteria:
- `systemctl --user --version` succeeds (you are in a real login session with a user D-Bus bus)
- The engine you intend to use reports a version

Check where the engine binary resolves to:

```bash
command -v claude
command -v codex
```

## 3. Pin the Engine Path (recommended)

`scripts/core/auto-loop.sh` resolves the engine by checking `$CLAUDE_BIN`/`$CODEX_BIN`, then `~/.nvm/versions/node/*/bin/`, then an interactive shell, then `PATH`. Under `systemd --user` the process does not inherit your interactive shell's `PATH`, so an engine installed somewhere like `~/.local/bin` may not be found deterministically.

Pin it in `.auto-loop.env` at the repository root:

```bash
CLAUDE_BIN=/home/YOUR_USER/.local/bin/claude
# CODEX_BIN=/home/YOUR_USER/.local/bin/codex
# ENGINE=claude
# LOOP_INTERVAL=30
# CYCLE_TIMEOUT_SECONDS=1800
```

The systemd unit loads this file via `EnvironmentFile=-`, so it applies to daemon runs. `make start` in the foreground uses your shell environment instead, so export the same variables there if you need them.

## 4. Run in the Foreground

```bash
make start        # live output, Ctrl+C to stop
make status       # loop + daemon state and the latest consensus
make monitor      # tail the live log
make last         # the last cycle's full output
make cycles       # cycle history summary
make stop         # graceful stop after the current cycle finishes
```

To keep the machine from sleeping while the loop runs:

```bash
make start-awake  # wraps `make start` in a systemd-inhibit sleep lock
```

If the loop is already running, hold a lock against its PID instead:

```bash
make awake
```

Both forms register on the dashboard's Guardian card.

## 5. Run as a Daemon

```bash
make install      # writes ~/.config/systemd/user/auto-company.service and enables it
systemctl --user start auto-company.service
systemctl --user status auto-company.service --no-pager

make pause        # stop the service (no auto-restart)
make resume       # start it again
make uninstall    # remove the unit
```

The unit sets `Restart=always`, so it recovers from a crash. An explicit `systemctl --user stop` does not trigger a restart.

To keep the daemon running after you log out:

```bash
sudo loginctl enable-linger $(id -un)
```

Without linger, the user manager (and your loop) is torn down when your last session ends.

## 6. Web Dashboard

```bash
make dashboard    # http://127.0.0.1:8787
```

`dashboard/server.py` detects the host platform and, on Linux, drives `scripts/linux/status-linux.sh` for status and `scripts/linux/start-linux.sh` / `scripts/linux/stop-linux.sh` for the Start and Stop buttons.

Bind elsewhere with:

```bash
python3 dashboard/server.py --host 127.0.0.1 --port 9000
```

The four status cards map to Linux as follows:

| Card | Linux source | States |
|---|---|---|
| Loop | `.auto-loop.pid` liveness | `running` / `stopped` |
| Daemon | `systemctl --user is-active auto-company.service` | `active` / `inactive` / `not_installed` / `unsupported` |
| Autostart | `systemctl --user is-enabled` + `loginctl` linger | `configured` / `not_configured` / `unsupported` |
| Guardian | a `systemd-inhibit` sleep lock covering the loop | `running` / `unsupported` |

The Guardian card reads `unsupported` (amber) whenever no sleep inhibitor is held. That is expected unless you started the loop with `make start-awake` or `make awake`.

Dashboard **Start** installs the systemd unit if it is missing and then starts it. Dashboard **Stop** stops the unit and also signals a foreground loop to finish its current cycle and exit.

## 7. Troubleshooting

### `systemctl --user` is unavailable

- Cause: no user D-Bus session (common over bare `su`, some SSH setups, or inside a container)
- Fix: check `loginctl show-user $(id -un)`; log in through a real session, or run the loop in the foreground with `make start`

### The dashboard shows `Daemon: NOT INSTALLED` after `make install`

- Cause: `make install` enables the unit but does not start it
- Fix: `systemctl --user start auto-company.service`, or press Start in the dashboard

### The loop exits immediately on its first cycle

- Cause: a stale `.auto-loop-stop` file from a previous stop
- Fix: `rm -f .auto-loop-stop`. `scripts/linux/start-linux.sh` and `auto-loop.sh` both clear it on startup

### `Error: Claude CLI not found` under the daemon but not in your shell

- Cause: `systemd --user` does not inherit your interactive `PATH`
- Fix: pin `CLAUDE_BIN` in `.auto-loop.env` (see step 3)

### The engine binary resolves to `/mnt/c/...`

- Cause: you are inside WSL and `PATH` hits the Windows-side CLI first
- Impact: version and behavior may differ from a Linux-local install
- Fix: install the CLI inside the Linux filesystem and pin it in `.auto-loop.env`

### The repository is on an NTFS/exFAT mount and builds behave oddly

- Cause: FUSE-backed filesystems do not carry POSIX permissions, and `npm install` on them is slow and occasionally throws `EPERM`
- Fix: for long unattended runs, keep the checkout on an ext4/btrfs/xfs path

### `make reset-consensus` fails with `did not match any file(s) known to git`

- Cause: `memories/` is gitignored, so `memories/consensus.md` was never committed and `git checkout --` has nothing to restore
- Fix: delete the file to start clean — `rm -f memories/consensus.md`. The next cycle recreates it from the skeleton in `PROMPT.md`

## 8. Command Comparison

| Task | Linux / macOS / WSL | Windows (PowerShell) |
|---|---|---|
| Start (foreground) | `make start` | `.\scripts\windows\start-win.ps1` |
| Start, no sleep | `make start-awake` | handled by `start-win.ps1` |
| Status | `make status` | `.\scripts\windows\status-win.ps1` |
| Live logs | `make monitor` | `.\scripts\windows\monitor-win.ps1` |
| Last cycle output | `make last` | `.\scripts\windows\last-win.ps1` |
| Cycle summary | `make cycles` | `.\scripts\windows\cycles-win.ps1` |
| Stop | `make stop` | `.\scripts\windows\stop-win.ps1` |
| Web dashboard | `make dashboard` | `.\scripts\windows\dashboard-win.ps1` |
| Install daemon | `make install` | auto-installed by `start-win.ps1` |
| Uninstall daemon | `make uninstall` | `wsl -d Ubuntu --cd <repo_wsl_path> bash -lc 'make uninstall'` |
| Pause daemon | `make pause` | `wsl -d Ubuntu --cd <repo_wsl_path> bash -lc 'make pause'` |
| Resume daemon | `make resume` | `wsl -d Ubuntu --cd <repo_wsl_path> bash -lc 'make resume'` |

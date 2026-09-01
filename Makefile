.PHONY: start start-awake awake stop status last cycles monitor dashboard pause resume install uninstall team engine vllm-check cineforge-ci-gate cineforge-health cineforge-waitlist cineforge-push-ready cineforge-stage cineforge-ship-pr cineforge-ship-pr-fork cineforge-verify-post-merge cineforge-pr-readiness cineforge-pre-merge-preflight cineforge-merge-escalate cineforge-merge-watch cineforge-merge-watch-daemon cineforge-daemon-health cineforge-unblock-card cineforge-pr-handoff cineforge-merge-nudge cineforge-maintainer-deeplink cineforge-issue-nudge cineforge-desktop-nudge cineforge-merge-confidence cineforge-post-merge-dry-run cineforge-render-preflight cineforge-blockers cineforge-handoff help

UNAME_S := $(shell uname -s 2>/dev/null || echo Unknown)

# Local machine defaults (gitignored). Command-line overrides still win:
#   ENGINE=cursor make start
-include .auto-loop.env
export ENGINE MODEL CLAUDE_PERMISSION_MODE CLAUDE_BIN CODEX_BIN CODEX_SANDBOX_MODE
export CURSOR_BIN CURSOR_SANDBOX_MODE CURSOR_FORCE CURSOR_API_KEY
export VLLM_BASE_URL VLLM_MODEL VLLM_API_KEY VLLM_TIMEOUT VLLM_MAX_STEPS
export LOOP_INTERVAL CYCLE_TIMEOUT_SECONDS MAX_CONSECUTIVE_ERRORS COOLDOWN_SECONDS LIMIT_WAIT_SECONDS MAX_LOGS

ENGINE ?= claude

# === Quick Start ===

start: ## Start the auto-loop in foreground
	./scripts/core/auto-loop.sh

start-awake: ## Start loop and prevent macOS sleep while running
ifeq ($(UNAME_S),Darwin)
	caffeinate -d -i -s $(MAKE) start
else
	@echo "start-awake is macOS-only (requires caffeinate)."
	@echo "Use 'make start' on Linux/WSL."
	@exit 1
endif

awake: ## Prevent macOS sleep while current loop PID is running
ifeq ($(UNAME_S),Darwin)
	@test -f .auto-loop.pid || (echo "No .auto-loop.pid found. Run 'make start' first."; exit 1)
	@pid=$$(cat .auto-loop.pid); \
	echo "Keeping Mac awake while PID $$pid is running..."; \
	caffeinate -d -i -s -w $$pid
else
	@echo "awake is macOS-only (requires caffeinate)."
	@echo "WSL usually inherits Windows power policy; keep your host from sleeping if needed."
	@exit 1
endif

stop: ## Stop the loop gracefully
	./scripts/core/stop-loop.sh

# === Monitoring ===

status: ## Show loop status + latest consensus
	./scripts/core/monitor.sh --status

last: ## Show last cycle's full output
	./scripts/core/monitor.sh --last

cycles: ## Show cycle history summary
	./scripts/core/monitor.sh --cycles

monitor: ## Tail live logs (Ctrl+C to exit)
	./scripts/core/monitor.sh

dashboard: ## Start local dashboard server (Windows host or macOS host)
	python3 dashboard/server.py --host 0.0.0.0 --port 8787

# === Daemon (macOS launchd / Linux systemd --user) ===

install: ## Install daemon (macOS launchd or Linux/WSL systemd --user)
ifeq ($(UNAME_S),Darwin)
	./scripts/macos/install-daemon.sh
else
	./scripts/wsl/install-wsl-daemon.sh
endif

uninstall: ## Remove daemon (macOS launchd or Linux/WSL systemd --user)
ifeq ($(UNAME_S),Darwin)
	./scripts/macos/install-daemon.sh --uninstall
else
	./scripts/wsl/uninstall-wsl-daemon.sh
endif

pause: ## Pause daemon (no auto-restart)
ifeq ($(UNAME_S),Darwin)
	./scripts/core/stop-loop.sh --pause-daemon
else
	@command -v systemctl >/dev/null 2>&1 || (echo "systemctl not found. Ensure WSL systemd is enabled."; exit 1)
	@systemctl --user stop auto-company.service
	@echo "auto-company.service paused (stopped)."
endif

resume: ## Resume paused daemon
ifeq ($(UNAME_S),Darwin)
	./scripts/core/stop-loop.sh --resume-daemon
else
	@command -v systemctl >/dev/null 2>&1 || (echo "systemctl not found. Ensure WSL systemd is enabled."; exit 1)
	@systemctl --user start auto-company.service
	@echo "auto-company.service resumed (started)."
endif

# === Interactive ===

engine: ## Interactively pick engine: cursor / codex / vllm
	./scripts/macos/select-engine.sh

vllm-check: ## Ping LAN vLLM / Qwen3.8 endpoint
	AUTO_COMPANY_ROOT="$(CURDIR)" python3 scripts/core/vllm-agent.py --ping

team: ## Start selected engine interactive session (ENGINE=claude|codex|cursor|vllm)
	@engine="$$(printf '%s' "$(ENGINE)" | tr '[:upper:]' '[:lower:]')"; \
	case "$$engine" in \
		claude|codex) cd "$(CURDIR)" && "$$engine" ;; \
		cursor) cd "$(CURDIR)" && cursor-agent ;; \
		vllm|qwen|free) echo "vLLM is headless. Test with: make vllm-check"; exit 0 ;; \
		*) echo "Unsupported ENGINE='$(ENGINE)'. Use cursor, codex, or vllm."; exit 1 ;; \
	esac

# === CineForge ===

cineforge-ci-gate: ## Run CineForge compile-track CI gate (no Key/Omni)
	./projects/cineforge/scripts/accept-ci-gate.sh

cineforge-health: ## Show CineForge /api/health summary
	./projects/cineforge/scripts/status-health.sh

cineforge-waitlist: ## Run waitlist API smoke + print local stats
	./projects/cineforge/scripts/accept-waitlist.sh
	./projects/cineforge/scripts/waitlist-stats.sh

cineforge-push-ready: ## Pre-push validation: secret scan + CI gate + health + waitlist
	./projects/cineforge/scripts/accept-push-ready.sh

cineforge-stage: ## Push-ready + git add full ship manifest (human still commits)
	./projects/cineforge/scripts/stage-for-ship.sh

cineforge-ship-pr: ## Push-ready + branch + commit + push + open PR (one command)
	./projects/cineforge/scripts/open-ship-pr.sh

cineforge-ship-pr-fork: ## Push-ready + fork + push + open PR to upstream (READ-only OK)
	./projects/cineforge/scripts/open-ship-pr-fork.sh

cineforge-verify-post-merge: ## After PR merge, poll cineforge-compile-gate on main until green
	./projects/cineforge/scripts/verify-post-merge.sh

cineforge-pr-readiness: ## PR merge readiness report (workflow approval + push-ready)
	./projects/cineforge/scripts/pr-merge-readiness.sh

cineforge-pre-merge-preflight: ## Full pre-merge validation (push-ready + PR + workflow status)
	./projects/cineforge/scripts/pre-merge-preflight.sh

cineforge-merge-escalate: ## Post merge-blocker escalation to Issue #17
	./projects/cineforge/scripts/merge-escalate-issue.sh

cineforge-merge-watch: ## Poll PR until merged, then run verify-post-merge
	./projects/cineforge/scripts/merge-watch.sh

cineforge-merge-watch-daemon: ## Background merge-watch (macOS/Linux, no setsid)
	./projects/cineforge/scripts/merge-watch-daemon.sh

cineforge-daemon-health: ## Check merge-watch daemon; RESTART=1 auto-restart if dead
	RESTART=$${RESTART:-1} ./projects/cineforge/scripts/daemon-health.sh

cineforge-unblock-card: ## One-screen human unblock card (compile + render tracks)
	./projects/cineforge/scripts/human-unblock-card.sh

cineforge-pr-handoff: ## Post merge handoff comment directly on PR #19
	./projects/cineforge/scripts/pr-handoff-comment.sh

cineforge-merge-nudge: ## Request review + @mention MaxMiksa (GitHub native notify)
	./projects/cineforge/scripts/merge-nudge.sh

cineforge-maintainer-deeplink: ## Print/open Checks + Merge URLs for maintainer (OPEN=1)
	OPEN=$${OPEN:-0} ./projects/cineforge/scripts/maintainer-merge-deeplink.sh

cineforge-issue-nudge: ## Issue #17 assign + label + @mention (alternate notify channel)
	CYCLE=$${CYCLE:-26} ./projects/cineforge/scripts/issue-assign-nudge.sh

cineforge-desktop-nudge: ## macOS desktop notification (non-GitHub channel)
	CYCLE=$${CYCLE:-26} DIALOG=$${DIALOG:-0} SOUND=$${SOUND:-1} ./projects/cineforge/scripts/maintainer-desktop-nudge.sh

cineforge-merge-confidence: ## Generate merge confidence artifact + post to Issue #17
	CYCLE=$${CYCLE:-26} POST=$${POST:-1} ./projects/cineforge/scripts/merge-confidence-pack.sh

cineforge-post-merge-dry-run: ## Verify post-merge automation ready (no merge required)
	./projects/cineforge/scripts/post-merge-dry-run.sh

cineforge-render-preflight: ## Render track readiness (Key/Omni, no mock)
	./projects/cineforge/scripts/render-track-preflight.sh

cineforge-blockers: ## Dual-track blocker dashboard (compile PR + render)
	./projects/cineforge/scripts/blockers-status.sh

cineforge-handoff: ## Create/update GitHub handoff issue for human commit/push
	REQUIRE_PASS=1 ./projects/cineforge/scripts/create-handoff-issue.sh

# === Maintenance ===

clean-logs: ## Remove all cycle logs
	rm -f logs/cycle-*.log logs/auto-loop.log.old
	@echo "Cycle logs cleaned."

reset-consensus: ## Reset consensus to initial Day 0 state (CAUTION)
	@echo "This will reset all company progress. Ctrl+C to cancel."
	@sleep 3
	git checkout -- memories/consensus.md
	@echo "Consensus reset to initial state."

# === Help ===

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help

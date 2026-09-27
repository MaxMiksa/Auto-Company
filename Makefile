.PHONY: start start-awake awake stop status last cycles usage-day usage-week usage-date usage-status monitor dashboard pause resume install uninstall team test-process-supervisor test-auto-loop-integration project-new project-select project-status project-publish project-migrate-legacy project-migrate-rollback clean-logs reset-consensus help

UNAME_S := $(shell uname -s 2>/dev/null || echo Unknown)
ENGINE ?= claude
LANGUAGE ?=

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

usage-day: ## Show today's structured cost/token summary
	python3 ./scripts/core/usage.py summary --period day

usage-week: ## Show this week's structured cost/token summary
	python3 ./scripts/core/usage.py summary --period week

usage-date: ## Show one date (DATE=YYYY-MM-DD)
	@test -n "$(DATE)" || (echo "DATE is required (YYYY-MM-DD)."; exit 1)
	python3 ./scripts/core/usage.py summary --period day --date "$(DATE)"

usage-status: ## Show hard-budget pause state
	python3 ./scripts/core/usage.py status

monitor: ## Tail live logs (Ctrl+C to exit)
	./scripts/core/monitor.sh

dashboard: ## Start local dashboard server (Windows, Linux/WSL, or macOS)
	python3 dashboard/server.py

.PHONY: center
center: ## Open the multi-product center (explicitly register sources in its UI)
	python3 dashboard/center_server.py

test-process-supervisor: ## Test cycle-owned process-tree cleanup with fake engines
	bash tests/test_process_supervisor.sh

test-auto-loop-integration: ## Test sidecar, usage, and governance pause integration with a fake engine
	bash tests/test_auto_loop_integration.sh

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
	@bash ./scripts/wsl/dashboard-wsl.sh check
	@printf 'PAUSE_REASON=manual\n' > .auto-loop-paused
	@bash ./scripts/wsl/dashboard-wsl.sh stop
	@bash ./scripts/core/ui-messages.sh make.paused
endif

resume: ## Resume paused daemon
	@test ! -e .auto-company-center.json -a ! -L .auto-company-center.json || (bash scripts/core/ui-messages.sh center.managed; exit 1)
ifeq ($(UNAME_S),Darwin)
	python3 ./scripts/core/usage.py resume
	./scripts/core/stop-loop.sh --resume-daemon
else
	@bash ./scripts/wsl/dashboard-wsl.sh check
	python3 ./scripts/core/usage.py resume
	@rm -f .auto-loop-paused
	@bash ./scripts/wsl/dashboard-wsl.sh start
	@bash ./scripts/core/ui-messages.sh make.resumed
endif

# === Interactive ===

.PHONY: language next-product
language: ## Save global language (LANGUAGE=zh-CN|en); active products keep their language
	python3 ./scripts/core/localization.py set --language "$(LANGUAGE)"

next-product: ## Start a new product language cycle after stopping (CONFIRM=NEXT)
	python3 ./scripts/core/localization.py next-product --confirm "$(CONFIRM)"

team: ## Start selected engine interactive session (ENGINE=claude|codex)
	@python3 ./scripts/core/localization.py team --engine "$$(printf '%s' "$(ENGINE)" | tr '[:upper:]' '[:lower:]')"

# === Product repositories ===

project-new: ## Create an independent local product repo (NAME=<slug>)
	@test -n "$(NAME)" || (echo "NAME is required. Example: make project-new NAME=my-product"; exit 1)
	./scripts/core/project.sh new --name "$(NAME)"

project-select: ## Select a product explicitly (PROJECT=<slug> CONFIRM=SELECT)
	./scripts/core/project.sh select --project "$(PROJECT)" --confirm "$(CONFIRM)"

project-status: ## Show the selected product repo status (optional PROJECT=<slug>)
	./scripts/core/project.sh status --project "$(PROJECT)"

project-publish: ## Explicitly push a clean product repo (REMOTE_URL=<url> CONFIRM=PUBLISH)
	./scripts/core/project.sh publish --project "$(PROJECT)" --remote-url "$(REMOTE_URL)" --confirm "$(CONFIRM)"

project-migrate-legacy: ## Stage reversible migration of a tracked legacy project (NAME=<slug> CONFIRM=MIGRATE)
	./scripts/core/project.sh migrate-legacy --name "$(NAME)" --confirm "$(CONFIRM)"

project-migrate-rollback: ## Roll back an uncommitted legacy migration (NAME=<slug> CONFIRM=ROLLBACK)
	./scripts/core/project.sh migrate-rollback --name "$(NAME)" --confirm "$(CONFIRM)"

# === Maintenance ===

clean-logs: ## Remove all cycle logs
	rm -f logs/cycle-*.log logs/cycle-*.json logs/auto-loop.log.old
	@echo "Cycle logs cleaned."

reset-consensus: ## Back up and reset business state; preserve human rules (CONFIRM=RESET)
	./scripts/core/consensus-guard.sh reset --confirm "$(CONFIRM)"

# === Help ===

help: ## Show this help
	@bash ./scripts/core/ui-messages.sh help

.DEFAULT_GOAL := help

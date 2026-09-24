"""Serve the real dashboard from disposable files without invoking host services."""

import argparse
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import sys
import tempfile
import threading
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
STATUS_OUTPUT = """=== Guardian ===
State=stopped
=== Daemon ===
State=inactive
=== Autostart ===
State=not_configured
EnabledState=disabled
=== Loop ===
State=stopped
"""
WINDOWS_STATUS_OUTPUT = """=== Windows Guardian ===
Awake guardian: STOPPED
=== Windows Autostart Task ===
Autostart: NOT CONFIGURED
=== WSL Daemon (systemd --user) ===
inactive
=== Auto Company Status ===
Loop: NOT RUNNING
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", choices=("default", "active-product", "save-failure",
                                              "action-success", "running-cycle"),
                        default="default")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="auto-company-browser-") as directory, ExitStack() as stack:
        root = Path(directory)
        # Import a copy so every path, including default arguments, stays in the
        # temporary checkout. No local logs, configuration or services are read.
        shutil.copytree(REPO_ROOT / "dashboard", root / "dashboard")
        core = root / "scripts/core"
        core.mkdir(parents=True)
        for name in ("localization.py", "installation_state.py", "usage_lib.py", "cycle_reports.py", "project_metadata.py", "product_identity.py", "product_media.py", "product_media_process.py", "product_icon_html.py"):
            shutil.copy2(REPO_ROOT / "scripts/core" / name, core / name)
        (root / "memories").mkdir()
        (root / "memories/consensus.md").write_text(
            "# Browser smoke consensus\n## Active Projects\n- Browser Fixture: local test\n"
            "## Company State\n- Product: Browser Fixture, local test\n"
            "## Next Action\nReview the next cycle.\n", encoding="utf-8")
        (root / "projects/browser-fixture").mkdir(parents=True)
        (root / "projects/browser-fixture/.auto-company-project.json").write_text(json.dumps({
            "version": 1, "project": "projects/browser-fixture", "displayName": "Browser Fixture",
            "description": "Local browser fixture", "recordedAt": datetime.now(timezone.utc).isoformat(),
            "source": "project_metadata",
        }), encoding="utf-8")
        (root / ".auto-company.local").write_text("ACTIVE_PROJECT=projects/browser-fixture\n", encoding="utf-8")
        (root / "logs").mkdir()
        (root / "DELIVERY.md").write_text("# Browser Fixture\nLocal browser test artifact.\n", encoding="utf-8")
        (root / "logs/auto-loop.log").write_text("Browser fixture runtime log\n", encoding="utf-8")
        started = datetime.now(timezone.utc) - timedelta(minutes=2)
        completed = {
            "schema_version": 1, "kind": "cycle_usage", "cycle_id": "cycle-0001-browser",
            "project": "projects/browser-fixture",
            "cycle_number": 1, "engine": "codex", "model": "fixture-model",
            "started_at": started.isoformat(), "ended_at": (started + timedelta(seconds=30)).isoformat(),
            "status": "completed", "exit_code": 0,
            "usage": {"input_tokens": 80, "output_tokens": 20, "total_tokens": 100, "status": "reported"},
        }
        (root / "logs/cycle-0001-browser.context.json").write_text(json.dumps({
            "version": 1, "cycleId": "cycle-0001-browser", "project": "projects/browser-fixture",
            "recordedAt": started.isoformat(), "source": "runtime_context",
        }), encoding="utf-8")
        (root / "logs/usage.jsonl").write_text(json.dumps(completed) + "\n", encoding="utf-8")
        (root / "logs/cycle-0001-browser.json").write_text(json.dumps({
            "result": "Browser smoke cycle completed.\n\nVerified the journal fixture."
        }), encoding="utf-8")
        (root / "logs/cycle-0001-browser.log").write_text("Browser fixture cycle log\n", encoding="utf-8")
        spec = importlib.util.spec_from_file_location("dashboard_smoke_server", root / "dashboard/server.py")
        server_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(server_module)

        stack.enter_context(mock.patch.dict(os.environ, {}, clear=True))
        stack.enter_context(mock.patch.object(server_module.localization, "system_language", return_value="en"))
        # Keep parsing, rendering, HTTP handling and language persistence real;
        # replace only the boundary that would inspect or change host services.
        runtime = {"running": args.scenario == "running-cycle"}

        def save_runtime():
            phase = "running" if runtime["running"] else "stopped"
            (root / ".auto-loop-state").write_text(
                f"STATUS={phase}\nENGINE=codex\nMODEL=fixture-model\nLOOP_COUNT=2\nERROR_COUNT=0\n",
                encoding="utf-8")
            marker = root / ".auto-loop.pid"
            if runtime["running"]:
                marker.write_text("12345\n", encoding="utf-8")
                pending = dict(completed, cycle_id="cycle-0002-browser", cycle_number=2,
                               started_at=datetime.now(timezone.utc).isoformat(), ended_at=None,
                               status="interrupted", exit_code=130, usage={})
                (root / "logs/cycle-0002-browser.context.json").write_text(json.dumps({
                    "version": 1, "cycleId": "cycle-0002-browser", "project": "projects/browser-fixture",
                    "recordedAt": pending["started_at"], "source": "runtime_context",
                }), encoding="utf-8")
                (root / "logs/usage.jsonl.pending").write_text(json.dumps(pending), encoding="utf-8")
                (root / "logs/cycle-0002-browser.log").write_text(
                    "Current cycle fixture log\n", encoding="utf-8")
            else:
                marker.unlink(missing_ok=True)

        def status_command(*_args):
            output = WINDOWS_STATUS_OUTPUT if platform.system() == "Windows" else STATUS_OUTPUT
            if runtime["running"]:
                output = output.replace("Loop: NOT RUNNING", "Loop: RUNNING (PID 12345)")
                output = output.replace("=== Loop ===\nState=stopped", "=== Loop ===\nState=running\nPid=12345")
            return {"ok": True, "exitCode": 0, "elapsedMs": 1, "output": output}

        def dashboard_action(action):
            if args.scenario != "action-success":
                return {"ok": False, "exitCode": 1, "elapsedMs": 1,
                        "output": "Host actions are disabled in browser smoke tests."}
            runtime["running"] = action == "start"
            save_runtime()
            return {"ok": True, "exitCode": 0, "elapsedMs": 1, "output": "Simulated host action completed."}

        save_runtime()
        stack.enter_context(mock.patch.object(server_module, "run_status_command", side_effect=status_command))
        stack.enter_context(mock.patch.object(server_module, "run_dashboard_action", side_effect=dashboard_action))
        if args.scenario == "active-product":
            server_module.localization.start_product(root, {})
        elif args.scenario == "save-failure":
            stack.enter_context(mock.patch.object(server_module.localization, "set_language",
                                                 side_effect=OSError("simulated write failure")))

        server = server_module.ThreadingHTTPServer(("127.0.0.1", 0), server_module.DashboardHandler)
        thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.05), daemon=True)
        thread.start()
        print(json.dumps({"url": f"http://127.0.0.1:{server.server_address[1]}"}), flush=True)
        try:
            # Closing the parent's pipe shuts down the server and removes state.
            sys.stdin.read()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(5)


if __name__ == "__main__":
    main()

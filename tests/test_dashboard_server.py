import importlib.util
import http.client
import json
import os
import platform
import shutil
import subprocess
import tempfile
import re
import threading
import unittest
from pathlib import Path
from unittest import mock


SERVER_PATH = Path(__file__).resolve().parents[1] / "dashboard" / "server.py"
APP_JS_PATH = Path(__file__).resolve().parents[1] / "dashboard" / "app.js"
SPEC = importlib.util.spec_from_file_location("dashboard_server", SERVER_PATH)
assert SPEC is not None
assert SPEC.loader is not None
dashboard_server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dashboard_server)


class DashboardServerTests(unittest.TestCase):
    def test_runtime_phase_only_refines_a_live_loop(self) -> None:
        for process_state, saved_phase, expected in (
            ("running", "paused", "paused"),
            ("running", "waiting_limit", "waiting_limit"),
            ("running", "circuit_break", "circuit_break"),
            ("running", "idle", "idle"),
            ("stopped", "running", "stopped"),
            ("stopped", "paused", "stopped"),
        ):
            with self.subTest(process=process_state, phase=saved_phase):
                result = {"ok": True, "exitCode": 0, "elapsedMs": 1,
                          "output": f"=== Loop ===\nState={process_state}\n"}
                with mock.patch.object(dashboard_server, "run_status_command", return_value=result), \
                        mock.patch.object(dashboard_server, "read_state_file_pairs", return_value={"STATUS": saved_phase}), \
                        mock.patch.object(dashboard_server, "read_text_file", return_value=""), \
                        mock.patch.object(dashboard_server, "read_tail", return_value=""):
                    payload = dashboard_server.gather_status_payload("Linux")
                self.assertEqual(payload["parsed"]["loop"]["state"], expected)
                self.assertEqual(payload["parsed"]["loop"]["processState"], process_state)

    def test_usage_payload_preserves_coverage_and_recorded_budget_without_env_inference(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            ledger = root / "usage.jsonl"
            pause = root / "pause"
            recorded_budget = {"state": "warning", "period": "week", "start_date": "2026-08-31",
                               "end_date": "2026-09-06", "alerts": [{"level": "warning", "metric": "cost_usd",
                               "actual": 1.25, "limit": 1, "coverage": "partial"}]}
            records = [{
                "schema_version": 1, "kind": "cycle_usage", "cycle_id": "known",
                "ended_at": "2026-09-02T12:00:00+08:00", "cost_usd": 1.25,
                "usage": {"input_tokens": 8, "output_tokens": 2, "total_tokens": 10},
            }, {
                "schema_version": 1, "kind": "cycle_usage", "cycle_id": "unknown",
                "ended_at": "2026-09-02T13:00:00+08:00", "cost_usd": None,
                "usage": {"input_tokens": None, "output_tokens": None, "total_tokens": None},
                "budget": recorded_budget,
            }]
            ledger.write_text("\n".join(json.dumps(record) for record in records) + "\ninvalid-json\n", encoding="utf-8")
            pause.write_text(json.dumps({"reason": "budget_unverifiable"}), encoding="utf-8")
            with mock.patch.dict(os.environ, {"USAGE_WARNING_USD": "99999", "OPENAI_COMPATIBLE_API_KEY": "private-sentinel"}):
                payload = dashboard_server.gather_usage_payload(
                    period="day", target_date="2026-09-02", ledger_path=ledger, pause_path=pause)
            self.assertEqual(payload["summary"]["cost_usd"], {
                "value": 1.25, "status": "partial", "known_cycles": 1, "unknown_cycles": 1})
            self.assertEqual(payload["summary"]["usage"]["total_tokens"]["unknown_cycles"], 1)
            self.assertEqual(payload["summary"]["latest_budget"], recorded_budget)
            self.assertEqual(payload["summary"]["invalid_records"], 1)
            self.assertEqual(payload["budgetPause"]["reason"], "budget_unverifiable")
            self.assertNotIn("private-sentinel", json.dumps(payload))
            # A different reporting window has no recorded budget or zero-dollar
            # claim; the independent current pause marker still remains visible.
            empty = dashboard_server.gather_usage_payload(
                period="day", target_date="2026-09-03", ledger_path=ledger, pause_path=pause)
            self.assertEqual(empty["summary"]["cycles"], 0)
            self.assertIsNone(empty["summary"]["cost_usd"]["value"])
            self.assertIsNone(empty["summary"]["latest_budget"])
            self.assertEqual(empty["budgetPause"]["reason"], "budget_unverifiable")

    def test_http_actions_enforce_host_origin_and_content_type(self) -> None:
        server = dashboard_server.ThreadingHTTPServer(("127.0.0.1", 0), dashboard_server.DashboardHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_address[1]
        try:
            with mock.patch.object(dashboard_server, "run_dashboard_action", return_value={
                "ok": True, "exitCode": 0, "elapsedMs": 1, "output": "mock action"
            }) as action:
                cases = [
                    ({"Host": f"attacker.example:{port}", "Content-Type": "application/json"}, 403),
                    ({"Origin": "https://attacker.example", "Content-Type": "application/json"}, 403),
                    ({"Origin": f"http://localhost:{port + 1}", "Content-Type": "application/json"}, 403),
                    ({"Content-Type": "text/plain"}, 415),
                    ({"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{port}"}, 200),
                ]
                for headers, expected in cases:
                    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                    connection.request("POST", "/api/action/start", body="{}", headers=headers)
                    response = connection.getresponse()
                    self.assertEqual(response.status, expected, headers)
                    response.read()
                    connection.close()
                action.assert_called_once_with("start")
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            connection.request("GET", "/")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertIn(b"Auto", response.read())
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(5)

    def test_remote_bind_is_rejected_before_server_creation(self) -> None:
        with mock.patch("sys.argv", ["server.py", "--host", "0.0.0.0"]):
            with self.assertRaises(SystemExit) as result:
                dashboard_server.main()
        self.assertEqual(result.exception.code, 2)

    @unittest.skipUnless(platform.system() == "Linux", "Linux adapter uses Bash and /proc")
    def test_linux_service_adapter_requires_matching_checkout(self) -> None:
        source = SERVER_PATH.parents[1] / "scripts" / "wsl" / "dashboard-wsl.sh"
        fixture = Path(__file__).parent / "fixtures" / "fake-systemctl.sh"
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            adapter = root / "scripts" / "wsl" / "dashboard-wsl.sh"
            adapter.parent.mkdir(parents=True)
            shutil.copy2(source, adapter)
            (root / "scripts/core").mkdir()
            for name in ("ui-messages.sh", "localization.py", "stop-loop.sh", "loop-lock.py"):
                shutil.copy2(SERVER_PATH.parents[1] / "scripts/core" / name, root / "scripts/core" / name)
            shutil.copytree(SERVER_PATH.parents[1] / "i18n", root / "i18n")
            fake_bin = root / "bin"
            fake_bin.mkdir()
            shutil.copy2(fixture, fake_bin / "systemctl")
            (fake_bin / "systemctl").chmod(0o755)
            env = dict(os.environ, PATH=f"{fake_bin}:{os.environ['PATH']}",
                       FAKE_SERVICE_ROOT=str(root), FAKE_SERVICE_LOG=str(root / "actions"),
                       FAKE_SERVICE_STATE="active", FAKE_SERVICE_ENABLED="enabled")
            def run(action: str) -> subprocess.CompletedProcess:
                return subprocess.run(["bash", str(adapter), action], env=env,
                                      capture_output=True, text=True, timeout=10)
            for state in ("active", "inactive", "failed"):
                env["FAKE_SERVICE_STATE"] = state
                result = run("status")
                parsed = dashboard_server.parse_linux_status_output(result.stdout)
                self.assertEqual(parsed["daemon"]["state"], state)
                self.assertEqual(parsed["autostart"]["enabledState"], "enabled")
            env["FAKE_SERVICE_STATE"] = "active"
            self.assertEqual(run("start").returncode, 0)
            self.assertEqual(run("stop").returncode, 0)
            self.assertEqual((root / "actions").read_text().splitlines(), ["start", "stop"])
            env["FAKE_SERVICE_ROOT"] = "/another/checkout"
            self.assertEqual(run("start").returncode, 3)
            self.assertEqual(run("stop").returncode, 3)
            parsed = dashboard_server.parse_linux_status_output(run("status").stdout)
            self.assertEqual(parsed["daemon"]["state"], "mismatched")
            self.assertEqual((root / "actions").read_text().splitlines(), ["start", "stop"])
            env["FAKE_SERVICE_MISSING"] = "1"
            self.assertEqual(run("start").returncode, 2)
            self.assertIn("make install", run("status").stdout)
            env.pop("FAKE_SERVICE_MISSING")
            shutil.copy2(SERVER_PATH.parents[1] / "Makefile", root / "Makefile")
            for name in ("usage.py", "usage_lib.py"):
                shutil.copy2(SERVER_PATH.parents[1] / "scripts/core" / name, root / "scripts/core" / name)
            pause = root / ".auto-loop-paused"
            budget = root / ".auto-loop-budget-paused"
            pause.write_text("operator marker\n")
            budget.write_text('{"reason":"usage_hard_limit"}')
            for target in ("pause", "resume"):
                result = subprocess.run(["make", target, "UNAME_S=Linux"], cwd=root,
                                        env=env, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(pause.read_text(), "operator marker\n")
                self.assertEqual(budget.read_text(), '{"reason":"usage_hard_limit"}')
                self.assertEqual((root / "actions").read_text().splitlines(), ["start", "stop"])
            env["FAKE_SERVICE_ROOT"] = str(root)
            for target in ("pause", "resume"):
                result = subprocess.run(["make", target, "UNAME_S=Linux"], cwd=root,
                                        env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(pause.exists())
            self.assertFalse(budget.exists())
            self.assertEqual((root / "actions").read_text().splitlines(), ["start", "stop", "stop", "start"])

    def test_frontend_translates_every_backend_state(self) -> None:
        source = (APP_JS_PATH.parent / "i18n.js").read_text(encoding="utf-8")
        match = re.search(r"window\.JOURNAL_MESSAGES\s*=\s*(\{.*\});", source, re.DOTALL)
        self.assertIsNotNone(match)
        assert match is not None
        dictionaries = json.loads(match.group(1))
        for language in ("en", "zh-CN"):
            for state in dashboard_server.KNOWN_STATES:
                with self.subTest(language=language, state=state):
                    key = "statusUnavailable" if state == "unavailable" else state
                    self.assertTrue(dictionaries[language].get(key))

    def test_windows_not_running_maps_to_stopped(self) -> None:
        raw = """=== Windows Guardian ===
Awake guardian: STOPPED

=== Windows Autostart Task ===
Autostart: NOT CONFIGURED

=== WSL Daemon (systemd --user) ===
active
MainPID=321
ActiveState=active
SubState=running

=== Auto Company Status ===
Loop: NOT RUNNING
Daemon: ACTIVE (systemd --user auto-company.service)
ENGINE=claude
MODEL=sonnet
"""
        parsed = dashboard_server.parse_status_output(raw, system_name="Windows")
        self.assertEqual(parsed["guardian"]["state"], "stopped")
        self.assertEqual(parsed["autostart"]["state"], "not_configured")
        self.assertEqual(parsed["daemon"]["state"], "active")
        self.assertEqual(parsed["loop"]["state"], "stopped")
        self.assertIsNone(parsed["loop"]["pid"])

    def test_windows_not_installed_daemon_maps_correctly(self) -> None:
        raw = """=== Windows Guardian ===
Awake guardian: RUNNING (PID 45)

=== Windows Autostart Task ===
Autostart: CONFIGURED (AutoCompany-WSL-Start)

=== WSL Daemon (systemd --user) ===
auto-company.service: not installed

=== Auto Company Status ===
Loop: RUNNING (PID 77)
Daemon: NOT INSTALLED (systemd --user auto-company.service)
"""
        parsed = dashboard_server.parse_status_output(raw, system_name="Windows")
        self.assertEqual(parsed["guardian"]["state"], "running")
        self.assertEqual(parsed["guardian"]["pid"], 45)
        self.assertEqual(parsed["autostart"]["state"], "configured")
        self.assertEqual(parsed["daemon"]["state"], "not_installed")
        self.assertEqual(parsed["loop"]["state"], "running")
        self.assertEqual(parsed["loop"]["pid"], 77)

    def test_windows_failed_daemon_is_not_collapsed_to_inactive(self) -> None:
        raw = """=== WSL Daemon (systemd --user) ===
failed
MainPID=0
ActiveState=failed
SubState=failed
"""
        parsed = dashboard_server.parse_status_output(raw, system_name="Windows")
        self.assertEqual(parsed["daemon"]["state"], "failed")
        self.assertEqual(parsed["daemon"]["activeState"], "failed")

    def test_linux_active_enabled_running_maps_correctly(self) -> None:
        raw = """=== Guardian ===
State=unsupported
Raw=No separate awake guardian on Linux/WSL

=== Daemon ===
State=active
ActiveState=active
SubState=running
MainPID=222
Raw=systemd --user auto-company.service: active/running

=== Autostart ===
State=configured
EnabledState=enabled
Raw=systemd --user auto-company.service is enabled

=== Loop ===
State=running
Pid=222
DaemonSummary=active (systemd --user auto-company.service)
Raw=Loop running

=== State File ===
ENGINE=codex
MODEL=gpt-5
LOOP_COUNT=12
PAUSE_REASON=unresolved_p1
"""
        parsed = dashboard_server.parse_status_output(raw, system_name="Linux")
        self.assertEqual(parsed["guardian"]["state"], "unsupported")
        self.assertEqual(parsed["daemon"]["state"], "active")
        self.assertEqual(parsed["daemon"]["mainPid"], 222)
        self.assertEqual(parsed["autostart"]["state"], "configured")
        self.assertEqual(parsed["autostart"]["enabledState"], "enabled")
        self.assertEqual(parsed["loop"]["state"], "running")
        self.assertEqual(parsed["loop"]["pid"], 222)
        self.assertEqual(parsed["loop"]["engine"], "codex")
        self.assertEqual(parsed["loop"]["pauseReason"], "unresolved_p1")

    def test_linux_inactive_disabled_stopped_maps_correctly(self) -> None:
        raw = """=== Guardian ===
State=unsupported

=== Daemon ===
State=inactive
ActiveState=inactive
SubState=dead
Raw=systemd --user auto-company.service: inactive/dead

=== Autostart ===
State=not_configured
EnabledState=disabled
Raw=systemd --user auto-company.service is disabled

=== Loop ===
State=stopped
DaemonSummary=inactive (systemd --user auto-company.service)
Raw=Loop not running
"""
        parsed = dashboard_server.parse_status_output(raw, system_name="Linux")
        self.assertEqual(parsed["daemon"]["state"], "inactive")
        self.assertEqual(parsed["daemon"]["activeState"], "inactive")
        self.assertEqual(parsed["daemon"]["subState"], "dead")
        self.assertEqual(parsed["autostart"]["state"], "not_configured")
        self.assertEqual(parsed["autostart"]["enabledState"], "disabled")
        self.assertEqual(parsed["loop"]["state"], "stopped")

    def test_linux_failed_daemon_maps_correctly(self) -> None:
        raw = """=== Daemon ===
State=failed
ActiveState=failed
SubState=failed
Raw=systemd --user auto-company.service: failed/failed

=== Autostart ===
State=configured
EnabledState=enabled

=== Loop ===
State=stopped
"""
        parsed = dashboard_server.parse_status_output(raw, system_name="Linux")
        self.assertEqual(parsed["daemon"]["state"], "failed")
        self.assertEqual(parsed["autostart"]["state"], "configured")

    def test_linux_not_installed_has_actionable_state(self) -> None:
        raw = """=== Daemon ===
State=not_installed
ActiveState=unknown
SubState=unknown
Raw=auto-company.service is not installed; run make install

=== Autostart ===
State=not_configured
EnabledState=not-found
Raw=auto-company.service is not installed; run make install

=== Loop ===
State=stopped
DaemonSummary=NOT INSTALLED (systemd --user auto-company.service)
Raw=Loop not running
"""
        parsed = dashboard_server.parse_status_output(raw, system_name="Linux")
        self.assertEqual(parsed["daemon"]["state"], "not_installed")
        self.assertIn("make install", parsed["daemon"]["raw"])
        self.assertEqual(parsed["autostart"]["state"], "not_configured")

    def test_macos_active_configured_running_maps_correctly(self) -> None:
        raw = """=== Guardian ===
State=running
Pid=111
Raw=caffeinate -w 456

=== Daemon ===
State=active
MainPID=222
Raw=launchd agent loaded

=== Autostart ===
State=configured
Raw=LaunchAgent plist present

=== Loop ===
State=running
Pid=456
Raw=Loop running

=== State File ===
ENGINE=claude
MODEL=sonnet
LOOP_COUNT=9
ERROR_COUNT=0
LAST_RUN=2026-03-14 12:00:00
"""
        parsed = dashboard_server.parse_status_output(raw, system_name="Darwin")
        self.assertEqual(parsed["guardian"]["state"], "running")
        self.assertEqual(parsed["guardian"]["pid"], 111)
        self.assertEqual(parsed["daemon"]["state"], "active")
        self.assertEqual(parsed["daemon"]["mainPid"], 222)
        self.assertEqual(parsed["autostart"]["state"], "configured")
        self.assertEqual(parsed["loop"]["state"], "running")
        self.assertEqual(parsed["loop"]["pid"], 456)
        self.assertEqual(parsed["loop"]["engine"], "claude")
        self.assertEqual(parsed["loop"]["loopCount"], "9")

    def test_macos_inactive_configured_stopped_and_guardian_without_caffeinate(self) -> None:
        raw = """=== Guardian ===
State=stopped
Raw=Sleep guard: loop running without caffeinate

=== Daemon ===
State=inactive
Raw=LaunchAgent paused (.auto-loop-paused present)

=== Autostart ===
State=configured
Raw=LaunchAgent plist present

=== Loop ===
State=stopped
Raw=Loop stopped (stale PID 456)
"""
        parsed = dashboard_server.parse_status_output(raw, system_name="Darwin")
        self.assertEqual(parsed["guardian"]["state"], "stopped")
        self.assertEqual(parsed["daemon"]["state"], "inactive")
        self.assertEqual(parsed["autostart"]["state"], "configured")
        self.assertEqual(parsed["loop"]["state"], "stopped")

    def test_macos_not_installed_maps_correctly(self) -> None:
        raw = """=== Guardian ===
State=stopped
Raw=Sleep guard: not active

=== Daemon ===
State=not_installed
Raw=LaunchAgent plist not installed

=== Autostart ===
State=not_configured
Raw=LaunchAgent plist absent

=== Loop ===
State=stopped
Raw=Loop not running
"""
        parsed = dashboard_server.parse_status_output(raw, system_name="Darwin")
        self.assertEqual(parsed["daemon"]["state"], "not_installed")
        self.assertEqual(parsed["autostart"]["state"], "not_configured")
        self.assertEqual(parsed["loop"]["state"], "stopped")

    def test_windows_start_uses_powershell_runner(self) -> None:
        with mock.patch.object(
            dashboard_server,
            "run_powershell_script",
            return_value={"ok": True, "exitCode": 0, "elapsedMs": 1, "output": ""},
        ) as runner:
            result = dashboard_server.run_dashboard_action("start", system_name="Windows")
        self.assertTrue(result["ok"])
        runner.assert_called_once_with(
            dashboard_server.WINDOWS_START_SCRIPT, args=None, timeout=120
        )

    def test_macos_stop_uses_shell_runner_with_pause_daemon(self) -> None:
        with mock.patch.object(
            dashboard_server,
            "run_shell_script",
            return_value={"ok": True, "exitCode": 0, "elapsedMs": 1, "output": ""},
        ) as runner:
            result = dashboard_server.run_dashboard_action("stop", system_name="Darwin")
        self.assertTrue(result["ok"])
        runner.assert_called_once_with(
            dashboard_server.MACOS_STOP_SCRIPT,
            args=["--pause-daemon"],
            timeout=120,
        )

    def test_linux_start_uses_systemd_service_adapter(self) -> None:
        with mock.patch.object(
            dashboard_server,
            "run_shell_script",
            return_value={"ok": True, "exitCode": 0, "elapsedMs": 1, "output": ""},
        ) as runner:
            result = dashboard_server.run_dashboard_action("start", system_name="Linux")
        self.assertTrue(result["ok"])
        runner.assert_called_once_with(
            dashboard_server.LINUX_DASHBOARD_SCRIPT,
            args=["start"],
            timeout=120,
        )

    def test_linux_stop_uses_systemd_service_adapter(self) -> None:
        with mock.patch.object(
            dashboard_server,
            "run_shell_script",
            return_value={"ok": True, "exitCode": 0, "elapsedMs": 1, "output": ""},
        ) as runner:
            result = dashboard_server.run_dashboard_action("stop", system_name="Linux")
        self.assertTrue(result["ok"])
        runner.assert_called_once_with(
            dashboard_server.LINUX_DASHBOARD_SCRIPT,
            args=["stop"],
            timeout=120,
        )

    def test_refresh_uses_status_script(self) -> None:
        with mock.patch.object(
            dashboard_server,
            "run_shell_script",
            return_value={"ok": True, "exitCode": 0, "elapsedMs": 1, "output": ""},
        ) as runner:
            dashboard_server.run_dashboard_action("refresh", system_name="Darwin")
        runner.assert_called_once_with(
            dashboard_server.MACOS_STATUS_SCRIPT, timeout=90
        )

    def test_linux_refresh_uses_systemd_status_adapter(self) -> None:
        with mock.patch.object(
            dashboard_server,
            "run_shell_script",
            return_value={"ok": True, "exitCode": 0, "elapsedMs": 1, "output": ""},
        ) as runner:
            dashboard_server.run_dashboard_action("refresh", system_name="Linux")
        runner.assert_called_once_with(
            dashboard_server.LINUX_DASHBOARD_SCRIPT,
            args=["status"],
            timeout=90,
        )

    def test_invalid_log_tail_lines_fall_back_to_default(self) -> None:
        self.assertEqual(dashboard_server.parse_positive_int("abc", default=180), 180)
        self.assertEqual(dashboard_server.parse_positive_int("-5", default=180), 180)
        self.assertEqual(dashboard_server.parse_positive_int("12", default=180), 12)

    def test_linux_host_is_supported(self) -> None:
        self.assertEqual(dashboard_server.detect_host_kind("Linux"), "linux")

    def test_unsupported_host_raises(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "only supports Windows hosts"):
            dashboard_server.detect_host_kind("FreeBSD")

    def test_usage_payload_reads_structured_ledger_and_pause_state(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            ledger = root / "usage.jsonl"
            pause = root / ".auto-loop-budget-paused"
            ledger.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "kind": "cycle_usage",
                        "cycle_id": "cycle-1",
                        "cycle_number": 1,
                        "ended_at": "2026-09-02T12:00:00+08:00",
                        "usage": {
                            "input_tokens": 50,
                            "output_tokens": 10,
                            "total_tokens": 60,
                        },
                        "cost_usd": None,
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            pause.write_text(
                json.dumps({"reason": "usage_hard_limit"}), encoding="utf-8"
            )
            payload = dashboard_server.gather_usage_payload(
                period="day",
                target_date="2026-09-02",
                ledger_path=ledger,
                pause_path=pause,
            )
        self.assertEqual(payload["summary"]["cycles"], 1)
        self.assertEqual(
            payload["summary"]["usage"]["total_tokens"]["value"], 60
        )
        self.assertIsNone(payload["summary"]["cost_usd"]["value"])
        self.assertEqual(payload["budgetPause"]["reason"], "usage_hard_limit")

    def test_api_usage_route_forwards_period_and_date(self) -> None:
        handler = dashboard_server.DashboardHandler.__new__(
            dashboard_server.DashboardHandler
        )
        handler.path = "/api/usage?period=week&date=2026-09-02"
        handler._request_allowed = mock.Mock(return_value=True)
        handler._json = mock.Mock()
        expected = {"summary": {"cycles": 2}, "budgetPause": None}
        with mock.patch.object(
            dashboard_server, "gather_usage_payload", return_value=expected
        ) as gather:
            handler.do_GET()
        gather.assert_called_once_with(period="week", target_date="2026-09-02")
        handler._json.assert_called_once_with(expected)

    def test_shared_ui_assets_have_explicit_static_routes(self) -> None:
        handler = dashboard_server.DashboardHandler.__new__(dashboard_server.DashboardHandler)
        handler._request_allowed = mock.Mock(return_value=True)
        handler._serve_file = mock.Mock()
        for filename, mime in [("ui.js", "application/javascript; charset=utf-8"), ("ui.css", "text/css; charset=utf-8")]:
            handler.path = "/ui-assets/" + filename
            handler.do_GET()
            handler._serve_file.assert_called_once_with(dashboard_server.DASHBOARD_DIR / "ui-assets" / filename, mime)
            handler._serve_file.reset_mock()

    def test_frontend_translation_asset_uses_explicit_static_route(self) -> None:
        handler = dashboard_server.DashboardHandler.__new__(
            dashboard_server.DashboardHandler
        )
        handler._request_allowed = mock.Mock(return_value=True)
        handler._serve_file = mock.Mock()
        handler._text = mock.Mock()
        handler.path = "/i18n.js"
        handler.do_GET()
        handler._serve_file.assert_called_once_with(
            dashboard_server.DASHBOARD_DIR / "i18n.js",
            "application/javascript; charset=utf-8",
        )
        handler._serve_file.reset_mock()
        handler.path = "/../scripts/core/auto-loop.sh"
        handler.do_GET()
        handler._serve_file.assert_not_called()
        handler._text.assert_called_once_with("Not found", code=404)


if __name__ == "__main__":
    unittest.main()

import importlib.util
import unittest
from pathlib import Path
from unittest import mock


SERVER_PATH = Path(__file__).resolve().parents[1] / "dashboard" / "server.py"
SPEC = importlib.util.spec_from_file_location("dashboard_server", SERVER_PATH)
assert SPEC is not None
assert SPEC.loader is not None
dashboard_server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dashboard_server)


class DashboardServerTests(unittest.TestCase):
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

    def test_invalid_log_tail_lines_fall_back_to_default(self) -> None:
        self.assertEqual(dashboard_server.parse_positive_int("abc", default=180), 180)
        self.assertEqual(dashboard_server.parse_positive_int("-5", default=180), 180)
        self.assertEqual(dashboard_server.parse_positive_int("12", default=180), 12)

    def test_unsupported_host_raises(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "only supports Windows hosts"):
            dashboard_server.detect_host_kind("Linux")


if __name__ == "__main__":
    unittest.main()

"""Real macOS launchd acceptance; never control the host's Auto Company agent.

Set AUTO_COMPANY_TEST_LAUNCHD=1 to require these tests (missing prerequisites fail).
Each case rewrites only the fixed label in temporary source copies, uses a fresh
HOME and a harmless loop probe, and calls the actual Dashboard Start/Stop chain.
"""

import importlib.util
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
import uuid


REPO = Path(__file__).resolve().parents[1]
SETTINGS = {"ENGINE": "codex", "MODEL": "launchd-probe-model", "CYCLE_TIMEOUT_SECONDS": "77",
            "LOOP_INTERVAL": "91", "USAGE_BUDGET_PERIOD": "week", "USAGE_WARNING_USD": "2",
            "USAGE_HARD_LIMIT_USD": "3", "USAGE_HARD_LIMIT_TOKENS": "9876",
            "CODEX_SANDBOX_MODE": "workspace-write"}


@unittest.skipUnless(os.environ.get("AUTO_COMPANY_TEST_LAUNCHD") == "1",
                     "set AUTO_COMPANY_TEST_LAUNCHD=1 for isolated real launchd probes")
class LaunchdRuntimeTests(unittest.TestCase):
    def setUp(self):
        if platform.system() != "Darwin" or not Path("/bin/launchctl").is_file():
            self.fail("requested launchd probes require macOS and /bin/launchctl")
        self.temp = tempfile.TemporaryDirectory(prefix="auto-company-launchd-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.project = self.root / 'Repo & "trial"'
        self.label = "com.autocompany.probe." + uuid.uuid4().hex
        self.home = self.root / "home"
        self.plist = self.home / f"Library/LaunchAgents/{self.label}.plist"
        self.plist.parent.mkdir(parents=True)
        shutil.copytree(REPO / "scripts", self.project / "scripts")
        (self.project / "dashboard").mkdir()
        for name in ("server.py", "journal_data.py", "observability_data.py"):
            shutil.copy2(REPO / "dashboard" / name, self.project / "dashboard" / name)
        for relative in ("scripts/core/launchd-config.py", "scripts/core/stop-loop.sh",
                         "scripts/macos/install-daemon.sh", "scripts/macos/start-daemon.sh",
                         "scripts/macos/launchd-job.py"):
            path = self.project / relative
            path.write_text(path.read_text().replace("com.autocompany.loop", self.label))
        # Keep the real command path/arguments. Only its body becomes a local
        # sentinel: no engine invocation, network, repository writes, or children
        # other than short sleeps. launchd owns and cleans up this probe process.
        (self.project / "scripts/core/auto-loop.sh").write_text(
            '#!/bin/bash\nset -eu\n'
            'while [ -f .auto-loop-paused ]; do /bin/sleep 0.05; done\n'
            'printf "%s\\n" "$PWD" "$ENGINE" "$MODEL" "$CYCLE_TIMEOUT_SECONDS" '
            '"$LOOP_INTERVAL" "$USAGE_BUDGET_PERIOD" "$USAGE_WARNING_USD" '
            '"$USAGE_HARD_LIMIT_USD" "$USAGE_HARD_LIMIT_TOKENS" "$CODEX_SANDBOX_MODE" '
            '"$$" > probe-result\n'
            'while :; do /bin/sleep 1; done\n')
        self.cli = self.root / "fake-codex"
        self.cli.write_text('#!/bin/sh\ntest "$*" = --version || exit 99\nprintf "local-probe\\n"\n')
        self.cli.chmod(0o755)
        self.env = {"HOME": str(self.home), "PATH": os.environ["PATH"],
                    "PYTHONDONTWRITEBYTECODE": "1"}
        self.addCleanup(self.cleanup_agent)
        spec = importlib.util.spec_from_file_location("launchd_probe_dashboard", self.project / "dashboard/server.py")
        self.dashboard = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.dashboard)

    def control(self, *args):
        return subprocess.run(["/bin/launchctl", *args], env=self.env,
                              capture_output=True, text=True, timeout=15)

    def cleanup_agent(self):
        if self.plist.exists():
            self.control("unload", str(self.plist))
        # If unloading reports an error, remove only this test's unique label.
        self.control("remove", self.label)
        remaining = self.control("list", self.label)
        self.assertNotEqual(remaining.returncode, 0,
                            "isolated launchd probe remained loaded after cleanup: " + remaining.stdout)

    def start(self, settings=None):
        env = dict(self.env, **(settings or {}))
        with mock.patch.dict(os.environ, env, clear=True):
            result = self.dashboard.run_dashboard_action("start", system_name="Darwin")
        self.assertTrue(result["ok"], result["output"])

    def stop(self, environment=None):
        with mock.patch.dict(os.environ, {**self.env, **(environment or {})}, clear=True):
            return self.dashboard.run_dashboard_action("stop", system_name="Darwin")

    def wait_probe(self):
        result = self.project / "probe-result"
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if result.is_file() and len(result.read_text().splitlines()) == 11:
                actual = result.read_text().splitlines()
                self.assertEqual(actual[:-1], [str(self.project), *SETTINGS.values()])
                return int(actual[-1])
            time.sleep(0.05)
        status = self.control("list", self.label)
        self.fail("launchd did not run the isolated probe: " + status.stdout + status.stderr)

    def install(self):
        self.start(dict(SETTINGS, CODEX_BIN=str(self.cli)))
        pid = self.wait_probe()
        config = plistlib.loads(self.plist.read_bytes())
        self.assertEqual(config["Label"], self.label)
        for name, value in SETTINGS.items():
            self.assertEqual(config["EnvironmentVariables"][name], value)
        return pid

    def loaded_pid(self):
        result = subprocess.run([sys.executable, str(self.project / "scripts/macos/launchd-job.py"),
                                 self.label], env=self.env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        metadata = plistlib.loads(result.stdout.encode())
        self.assertEqual(metadata["Label"], self.label)
        pid = metadata["PID"]
        self.assertIsInstance(pid, int)
        self.assertGreater(pid, 0)
        return pid

    def test_first_start_installs_and_runs_saved_environment(self):
        self.install()

    def test_prepared_install_is_unloaded_until_explicit_start(self):
        result = subprocess.run(["/bin/bash", str(self.project / "scripts/macos/install-daemon.sh"), "--prepare"],
                                env=dict(self.env, **SETTINGS, CODEX_BIN=str(self.cli)),
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotEqual(self.control("list", self.label).returncode, 0)
        self.assertFalse((self.project / "probe-result").exists())
        before = self.plist.read_bytes()
        config = plistlib.loads(before)
        self.assertIs(config["RunAtLoad"], False)
        self.assertIs(config["KeepAlive"], False)
        self.start()
        self.wait_probe()
        self.assertEqual(self.plist.read_bytes(), before)

    def test_loaded_start_preserves_configuration_and_process(self):
        before_pid = self.install()
        self.assertEqual(self.loaded_pid(), before_pid)
        before = self.plist.read_bytes()
        self.start()
        self.assertEqual(self.plist.read_bytes(), before)
        # Read launchd's live PID, not the sentinel file left by the old process.
        self.assertEqual(self.loaded_pid(), before_pid)

    def test_unloaded_start_reuses_configuration_with_empty_dashboard_environment(self):
        self.install()
        before = self.plist.read_bytes()
        result = self.control("unload", str(self.plist))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        (self.project / "probe-result").unlink()
        pause = self.project / ".auto-loop-paused"
        pause.write_text("operator pause\n")
        self.start()
        self.wait_probe()
        self.assertEqual(self.plist.read_bytes(), before)
        self.assertFalse(pause.exists())

    def test_pause_foreign_checkout_cannot_touch_flags_or_owned_service(self):
        pid = self.install()
        before = self.plist.read_bytes()
        foreign = self.root / "Other checkout"
        shutil.copytree(self.project / "scripts", foreign / "scripts")
        pause = foreign / ".auto-loop-paused"
        pause.write_text("original foreign pause\n")
        result = subprocess.run(["/bin/bash", str(foreign / "scripts/core/stop-loop.sh"), "--pause-daemon"],
                                env=self.env, capture_output=True, text=True, timeout=15)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(pause.read_text(), "original foreign pause\n")
        self.assertFalse((foreign / ".auto-loop-stop").exists())
        self.assertFalse((foreign / ".auto-loop.pid").exists())
        self.assertEqual(self.loaded_pid(), pid)
        self.assertEqual(self.plist.read_bytes(), before)

    def test_pause_unloads_and_resume_preserves_saved_settings(self):
        self.install()
        before = self.plist.read_bytes()
        result = self.stop()
        self.assertTrue(result["ok"], result["output"])
        self.assertNotEqual(self.control("list", self.label).returncode, 0)
        self.assertEqual((self.project / ".auto-loop-paused").read_text(), "PAUSE_REASON=manual\n")
        self.assertEqual(self.plist.read_bytes(), before)
        (self.project / "probe-result").unlink()
        self.start()
        self.wait_probe()
        self.assertEqual(self.plist.read_bytes(), before)

    def test_unload_failure_reports_error_and_retry_controls_only_test_label(self):
        pid = self.install()
        before = self.plist.read_bytes()
        fail_bin = self.root / "fail-bin"
        fail_bin.mkdir()
        wrapper = fail_bin / "launchctl"
        wrapper.write_text('#!/bin/sh\n[ "$1" != unload ] || exit 5\nexec /bin/launchctl "$@"\n')
        wrapper.chmod(0o755)
        result = self.stop({"PATH": str(fail_bin) + os.pathsep + self.env["PATH"]})
        self.assertFalse(result["ok"], result["output"])
        self.assertEqual(self.loaded_pid(), pid)
        self.assertEqual(self.plist.read_bytes(), before)
        self.assertEqual((self.project / ".auto-loop-paused").read_text(), "PAUSE_REASON=manual\n")
        self.assertTrue((self.project / ".auto-loop-stop").exists())
        retry = self.stop()
        self.assertTrue(retry["ok"], retry["output"])
        self.assertNotEqual(self.control("list", self.label).returncode, 0)
        self.assertEqual(self.plist.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()

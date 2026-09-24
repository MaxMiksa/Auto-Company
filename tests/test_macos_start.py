"""Dashboard Start/Stop regressions with a temporary HOME and fake launchctl."""

import importlib.util
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock


REPO = Path(__file__).resolve().parents[1]
LABEL = "com.autocompany.loop"
SETTINGS = {"ENGINE": "codex", "MODEL": "custom-model", "CYCLE_TIMEOUT_SECONDS": "77",
            "LOOP_INTERVAL": "91", "USAGE_BUDGET_PERIOD": "week", "USAGE_WARNING_USD": "2",
            "USAGE_HARD_LIMIT_USD": "3", "USAGE_HARD_LIMIT_TOKENS": "9876",
            "CODEX_SANDBOX_MODE": "workspace-write"}


@unittest.skipIf(os.name == "nt", "macOS shell contracts execute in POSIX/WSL CI")
class MacosStartTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="auto-company-macos-start-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / 'Repo & "trial"'
        shutil.copytree(REPO / "scripts", self.project / "scripts")
        (self.project / "dashboard").mkdir()
        for name in ("server.py", "journal_data.py", "observability_data.py"):
            shutil.copy2(REPO / "dashboard" / name, self.project / "dashboard" / name)
        self.home = self.root / "home"
        self.plist = self.home / f"Library/LaunchAgents/{LABEL}.plist"
        self.plist.parent.mkdir(parents=True)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.trace = self.root / "trace"
        self.loaded = self.root / "loaded.plist"
        self.pause = self.project / ".auto-loop-paused"
        self.pause.write_text("operator pause\n")
        self.env = {"HOME": str(self.home), "PATH": str(self.bin), "TRACE": str(self.trace),
                    "LOADED": str(self.loaded), "PYTHONDONTWRITEBYTECODE": "1"}
        for name in ("dirname", "tr", "python3", "grep", "head", "cat", "mkdir", "rm", "tail", "cp", "awk", "touch"):
            (self.bin / name).symlink_to(shutil.which(name))
        self.fake("uname", 'printf "Darwin\\n"')
        self.fake("bash", "exit 1")  # Do not source the host's interactive shell.
        self.fake("claude", 'test "$*" = --version || exit 99\nprintf "fake-version\\n"')
        # Substitute only the native read boundary on non-macOS hosts. Keep the
        # exported job shape, downstream validation, and shell control real.
        (self.project / "scripts/macos/launchd-job.py").write_text('''import os, plistlib, sys
if os.environ.get("FAIL_QUERY") == "1":
    sys.exit("native LaunchAgent metadata unavailable")
config = plistlib.load(open(os.environ["LOADED"], "rb"))
exported = {key: config[key] for key in ("Label", "ProgramArguments", "Program") if key in config}
exported.update(PID=123, LastExitStatus=0)
sys.stdout.buffer.write(plistlib.dumps(exported))
''')
        self.fake("launchctl", '''printf '%s\\n' "$*" >> "$TRACE"
case "$1" in
  list)
    [ "${FAIL_LIST:-}" != 1 ] || exit 5
    if [ "$#" = 1 ]; then
      [ ! -f "$LOADED" ] || printf '123 0 com.autocompany.loop\\n'
    elif [ "$2" = -x ]; then
      exit 113 ; # Current macOS treats -x as a label, not an XML option.
    else
      [ -f "$LOADED" ] || exit 113
    fi ;;
  load) [ "${FAIL_LOAD:-}" != 1 ] || exit 5; cp "$2" "$LOADED" ;;
  unload) [ "${FAIL_UNLOAD:-}" != 1 ] || exit 5; rm -f "$LOADED" ;;
  start) [ -f "$LOADED" ] || exit 113 ;;
  *) exit 99 ;;
esac''')
        spec = importlib.util.spec_from_file_location("start_dashboard", self.project / "dashboard/server.py")
        self.dashboard = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.dashboard)

    def fake(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/sh\n" + body + "\n")
        path.chmod(0o755)

    def install_config(self, loaded=False, project=None):
        project = project or self.project
        config = {"Label": LABEL, "WorkingDirectory": str(project),
                  "ProgramArguments": ["/bin/bash", str(project / "scripts/core/auto-loop.sh"), "--daemon"],
                  "EnvironmentVariables": dict(SETTINGS, HOME=str(self.home), PATH=str(self.bin)),
                  "RunAtLoad": True,
                  "KeepAlive": {"PathState": {str(project / ".auto-loop-paused"): False}}}
        self.plist.write_bytes(plistlib.dumps(config, sort_keys=False))
        if loaded:
            shutil.copy2(self.plist, self.loaded)
        return self.plist.read_bytes()

    def start(self):
        with mock.patch.dict(os.environ, self.env, clear=True):
            return self.dashboard.run_dashboard_action("start", system_name="Darwin")

    def stop(self):
        with mock.patch.dict(os.environ, self.env, clear=True):
            return self.dashboard.run_dashboard_action("stop", system_name="Darwin")

    def assert_pause_rejected(self):
        result = self.stop()
        self.assertFalse(result["ok"], result["output"])
        self.assertEqual(self.pause.read_text(), "operator pause\n")
        self.assertFalse((self.project / ".auto-loop-stop").exists())
        self.assertFalse((self.project / ".auto-loop.pid").exists())
        if self.trace.exists():
            self.assertNotIn("unload", self.trace.read_text())
        return result

    def test_pause_foreign_disk_owner_rejected_before_flags_or_signal(self):
        original = self.install_config(True, self.root / "other")
        self.assert_pause_rejected()
        self.assertEqual(self.plist.read_bytes(), original)
        self.assertEqual(self.loaded.read_bytes(), original)
        self.assertFalse(self.trace.exists())

    def test_pause_foreign_loaded_owner_rejected_before_flags_or_signal(self):
        foreign = self.install_config(True, self.root / "other")
        original = self.install_config()
        self.assert_pause_rejected()
        self.assertEqual(self.plist.read_bytes(), original)
        self.assertEqual(self.loaded.read_bytes(), foreign)

    def test_pause_missing_or_malformed_plist_rejected(self):
        for content in (None, b"not a plist", plistlib.dumps(["invalid"])):
            with self.subTest(content=content):
                if content is not None:
                    self.plist.write_bytes(content)
                self.assert_pause_rejected()

    def test_pause_failed_list_or_native_query_rejected_before_mutation(self):
        original = self.install_config(True)
        for variable in ("FAIL_LIST", "FAIL_QUERY"):
            with self.subTest(variable=variable):
                self.env[variable] = "1"
                self.assert_pause_rejected()
                self.env.pop(variable)
                self.assertEqual(self.loaded.read_bytes(), original)

    def test_pause_owned_loaded_and_already_unloaded_agents(self):
        original = self.install_config(True)
        for attempt in range(2):
            with self.subTest(attempt=attempt):
                result = self.stop()
                self.assertTrue(result["ok"], result["output"])
                self.assertEqual(self.pause.read_text(), "PAUSE_REASON=manual\n")
                self.assertTrue((self.project / ".auto-loop-stop").exists())
                self.assertFalse(self.loaded.exists())
                self.assertEqual(self.plist.read_bytes(), original)
        self.assertEqual(sum(line.startswith("unload ") for line in self.trace.read_text().splitlines()), 1)
        self.assertTrue(self.start()["ok"])
        self.assertEqual(self.loaded.read_bytes(), original)

    def test_pause_unload_failure_propagates_and_allows_retry(self):
        original = self.install_config(True)
        self.env["FAIL_UNLOAD"] = "1"
        result = self.stop()
        self.assertFalse(result["ok"], result["output"])
        self.assertEqual(self.pause.read_text(), "PAUSE_REASON=manual\n")
        self.assertTrue((self.project / ".auto-loop-stop").exists())
        self.assertEqual(self.loaded.read_bytes(), original)
        self.assertEqual(self.plist.read_bytes(), original)
        self.env.pop("FAIL_UNLOAD")
        result = self.stop()
        self.assertTrue(result["ok"], result["output"])
        self.assertFalse(self.loaded.exists())
        self.assertEqual(self.plist.read_bytes(), original)

    def assert_preserved(self, loaded, inherited=False):
        original = self.install_config(loaded)
        if inherited:
            self.env.update(ENGINE="claude", MODEL="different", USAGE_HARD_LIMIT_TOKENS="1")
        result = self.start()
        self.assertTrue(result["ok"], result["output"])
        self.assertEqual(self.plist.read_bytes(), original)
        self.assertEqual(self.loaded.read_bytes(), original)
        self.assertFalse(self.pause.exists())

    def test_loaded_start_preserves_original_settings(self):
        self.assert_preserved(True)

    def test_stopped_start_preserves_original_settings(self):
        self.assert_preserved(False)

    def test_conflicting_dashboard_environment_does_not_reinstall(self):
        self.assert_preserved(True, inherited=True)

    def test_first_start_installs(self):
        result = self.start()
        self.assertTrue(result["ok"], result["output"])
        self.assertTrue(self.plist.is_file())
        self.assertEqual(self.loaded.read_bytes(), self.plist.read_bytes())

    def test_other_checkout_is_rejected_before_mutation(self):
        original = self.install_config(True, self.root / "other")
        result = self.start()
        self.assertFalse(result["ok"], result["output"])
        self.assertEqual(self.plist.read_bytes(), original)
        self.assertEqual(self.pause.read_text(), "operator pause\n")
        self.assertFalse(self.trace.exists())

    def test_prepared_service_requires_explicit_start_after_load(self):
        self.install_config()
        config = plistlib.loads(self.plist.read_bytes())
        config.update(RunAtLoad=False, KeepAlive=False)
        self.plist.write_bytes(plistlib.dumps(config))
        before = self.plist.read_bytes()
        result = self.start()
        self.assertTrue(result["ok"], result["output"])
        calls = self.trace.read_text().splitlines()
        self.assertIn(f"load {self.plist}", calls)
        self.assertIn(f"start {LABEL}", calls)
        self.assertEqual(before, self.plist.read_bytes())

    def test_malformed_plist_is_rejected_before_mutation(self):
        for raw in (b"not a plist", b'<?xml version="1.0"?><plist><dict>', plistlib.dumps(["invalid"]),
                    plistlib.dumps({"Label": LABEL, "WorkingDirectory": str(self.project)})):
            with self.subTest(raw=raw):
                self.plist.write_bytes(raw)
                result = self.start()
                self.assertFalse(result["ok"], result["output"])
                self.assertEqual(self.plist.read_bytes(), raw)
                self.assertEqual(self.pause.read_text(), "operator pause\n")
                self.assertFalse(self.trace.exists())

    def test_loaded_agent_with_missing_plist_does_not_install(self):
        original = self.install_config(True)
        self.plist.unlink()
        result = self.start()
        self.assertFalse(result["ok"], result["output"])
        self.assertFalse(self.plist.exists())
        self.assertEqual(self.loaded.read_bytes(), original)
        self.assertEqual(self.pause.read_text(), "operator pause\n")

    def test_installed_start_does_not_probe_dashboard_default_engine(self):
        (self.bin / "claude").unlink()
        self.assert_preserved(False)

    def test_loaded_foreign_program_arguments_are_rejected(self):
        self.install_config(True, self.root / "other")
        foreign = self.loaded.read_bytes()
        original = self.install_config()
        result = self.start()
        self.assertFalse(result["ok"], result["output"])
        self.assertEqual(self.plist.read_bytes(), original)
        self.assertEqual(self.loaded.read_bytes(), foreign)
        self.assertEqual(self.pause.read_text(), "operator pause\n")

    def test_resume_missing_plist_keeps_pause(self):
        result = subprocess.run(["/bin/bash", str(self.project / "scripts/core/stop-loop.sh"),
                                 "--resume-daemon"], env=self.env, capture_output=True, text=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.pause.read_text(), "operator pause\n")

    def test_load_failure_keeps_pause_and_configuration(self):
        original = self.install_config()
        self.env["FAIL_LOAD"] = "1"
        result = self.start()
        self.assertFalse(result["ok"], result["output"])
        self.assertEqual(self.plist.read_bytes(), original)
        self.assertEqual(self.pause.read_text(), "operator pause\n")

    def test_native_metadata_failure_keeps_pause_and_configuration(self):
        original = self.install_config(True)
        self.env["FAIL_QUERY"] = "1"
        result = self.start()
        self.assertFalse(result["ok"], result["output"])
        self.assertIn("native LaunchAgent metadata unavailable", result["output"])
        self.assertEqual(self.plist.read_bytes(), original)
        self.assertEqual(self.loaded.read_bytes(), original)
        self.assertEqual(self.pause.read_text(), "operator pause\n")
        self.assertEqual(self.trace.read_text().splitlines(), ["list " + LABEL])


if __name__ == "__main__":
    unittest.main()

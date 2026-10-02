"""Exercise installers against fake service managers, never the host service."""

import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'tests'))
from isolation_fixture import install as install_fixture_boundary


@unittest.skipIf(os.name == "nt", "installer contracts execute in POSIX/WSL CI")
class DaemonInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.project = root / 'Repo & "trial" %data'
        for directory in ("scripts/core", "scripts/macos", "scripts/wsl"):
            (self.project / directory).mkdir(parents=True, exist_ok=True)
        for filename in ("scripts/core/engine-adapters.sh", "scripts/core/process-supervisor.sh", "scripts/core/launchd-config.py", "scripts/core/ui-messages.sh", "scripts/core/localization.py",
                         "scripts/macos/install-daemon.sh", "scripts/wsl/install-wsl-daemon.sh"):
            shutil.copy2(REPO / filename, self.project / filename)
        shutil.copytree(REPO / "i18n", self.project / "i18n")
        install_fixture_boundary(self.project)
        self.home_dir = root / "home"
        self.home_dir.mkdir()
        self.bin_dir = root / "bin"
        self.bin_dir.mkdir()
        self.env = os.environ.copy()
        self.env.update(HOME=str(self.home_dir), PATH=f"{self.bin_dir}:{os.environ['PATH']}",
                        ENGINE="claude", CLAUDE_PERMISSION_MODE="default",
                        CLAUDE_BIN=str(self.bin_dir / "fake-claude"),
                        CYCLE_TIMEOUT_SECONDS="80", USAGE_HARD_LIMIT_TOKENS="9876",
                        OPENAI_COMPATIBLE_API_KEY="sentinel-must-not-be-stored")
        self.fake("fake-claude", 'printf "fake-version\\n"')
        self.fake("launchctl", "exit 0")
        self.fake("systemctl", "exit 0")
        self.fake("loginctl", 'printf "yes\\n"')

    def fake(self, name, body):
        path = self.bin_dir / name
        path.write_text("#!/bin/sh\n" + body + "\n", encoding="utf-8")
        path.chmod(0o755)

    def run_installer(self, script, *args):
        result = subprocess.run(["bash", str(self.project / script), *args], env=self.env,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def test_mac_install_preserves_budget_and_special_paths(self):
        self.fake("uname", 'printf "Darwin\\n"')
        self.run_installer("scripts/macos/install-daemon.sh")
        raw = (self.home_dir / "Library/LaunchAgents/com.autocompany.loop.plist").read_bytes()
        config = plistlib.loads(raw)
        self.assertEqual(config["WorkingDirectory"], str(self.project))
        self.assertEqual(config["EnvironmentVariables"]["USAGE_HARD_LIMIT_TOKENS"], "9876")
        self.assertEqual(config["EnvironmentVariables"]["CYCLE_TIMEOUT_SECONDS"], "80")
        self.assertNotIn(b"sentinel-must-not-be-stored", raw)

    def test_mac_uninstall_does_not_require_valid_engine_configuration(self):
        self.fake("uname", 'printf "Darwin\\n"')
        self.env["ENGINE"] = "not-an-engine"
        self.env["CLAUDE_PERMISSION_MODE"] = "invalid"
        self.run_installer("scripts/macos/install-daemon.sh", "--uninstall")

    def test_systemd_formats_literal_paths_and_quoted_command_arguments(self):
        self.run_installer("scripts/wsl/install-wsl-daemon.sh")
        unit = (self.home_dir / ".config/systemd/user/auto-company.service").read_text()
        escaped = str(self.project).replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%")
        self.assertIn(f'ExecStart=/usr/bin/bash "{escaped}/scripts/core/auto-loop.sh"', unit)
        literal_path = str(self.project).replace("%", "%%")
        self.assertIn(f'WorkingDirectory={literal_path}\n', unit)
        self.assertIn(f'EnvironmentFile=-{literal_path}/.auto-loop.env\n', unit)
        self.assertIn("RestartPreventExitStatus=78", unit)


if __name__ == "__main__":
    unittest.main()

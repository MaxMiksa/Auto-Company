"""Validate generated units with systemd, using only isolated probe services.

Parser checks need systemd-analyze. Runtime checks additionally require a user
manager and AUTO_COMPANY_TEST_SYSTEMD_USER=1 (missing prerequisites then fail).
They never install or start the host's auto-company.service and never execute
an actual company loop.
"""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import uuid


REPO = Path(__file__).resolve().parents[1]
PATHS = ("repo", "repo with spaces", "repo%data", 'Repo & "trial" %data')


class SystemdFixture(unittest.TestCase):
    def setUp(self):
        if os.name == "nt" or not shutil.which("systemd-analyze"):
            if os.environ.get("AUTO_COMPANY_TEST_SYSTEMD_USER") == "1":
                self.fail("requested systemd checks require Linux/WSL with systemd-analyze")
            self.skipTest("real systemd parser requires Linux/WSL with systemd-analyze")
        self.temp = tempfile.TemporaryDirectory(prefix="auto-company-systemd-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.bin = self.root / "bin"
        self.home.mkdir()
        self.bin.mkdir()
        for name in ("systemctl", "loginctl"):
            fake = self.bin / name
            fake.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            fake.chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.home),
                        PATH=f"{self.bin}:{os.environ['PATH']}")

    def generate_unit(self, name, with_env=True, prepare=False):
        project = self.root / name
        (project / "scripts/wsl").mkdir(parents=True)
        (project / "scripts/core").mkdir()
        installer = project / "scripts/wsl/install-wsl-daemon.sh"
        shutil.copy2(REPO / "scripts/wsl/install-wsl-daemon.sh", installer)
        for filename in ("ui-messages.sh", "localization.py"):
            shutil.copy2(REPO / "scripts/core" / filename, project / "scripts/core" / filename)
        shutil.copytree(REPO / "i18n", project / "i18n")
        (project / "scripts/core/auto-loop.sh").write_text(
            '#!/bin/bash\nset -eu\nprintf "%s\\n" "$PWD" '
            '"${AUTO_COMPANY_SYSTEMD_SENTINEL-missing}" > probe-result\n',
            encoding="utf-8")
        if with_env:
            (project / ".auto-loop.env").write_text(
                'AUTO_COMPANY_SYSTEMD_SENTINEL="loaded from env % with spaces"\n',
                encoding="utf-8")
        if prepare:
            (self.bin / "systemctl").write_text('#!/bin/sh\ncase "$*" in *" cat "*) exit 1;; esac\nexit 0\n')
        result = subprocess.run(["bash", str(installer), *(["--prepare"] if prepare else [])], env=self.env,
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        unit = (self.home / ".config/systemd/user/auto-company.service").read_text()
        return project, unit


class SystemdParserTests(SystemdFixture):
    def verify_path(self, name):
        _, unit = self.generate_unit(name)
        path = self.root / "auto-company-parser-probe.service"
        path.write_text(unit, encoding="utf-8")
        # The offline user-unit parser needs a runtime directory, not a login
        # session. Keep its lookup paths separate from any real user manager.
        runtime_dir = self.root / "parser-runtime"
        runtime_dir.mkdir(mode=0o700)
        parser_env = dict(os.environ, HOME=str(self.home),
                          XDG_CONFIG_HOME=str(self.home / ".config"),
                          XDG_RUNTIME_DIR=str(runtime_dir))
        parser_env.pop("DBUS_SESSION_BUS_ADDRESS", None)
        result = subprocess.run(["systemd-analyze", "--user", "verify", str(path)],
                                env=parser_env, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        # Invalid EnvironmentFile= is only a warning: exit status alone misses it.
        self.assertNotIn("EnvironmentFile=", result.stderr, result.stderr)

    def test_plain_path(self):
        self.verify_path(PATHS[0])

    def test_space_path(self):
        self.verify_path(PATHS[1])

    def test_percent_path(self):
        self.verify_path(PATHS[2])

    def test_combined_special_path(self):
        self.verify_path(PATHS[3])


@unittest.skipUnless(os.environ.get("AUTO_COMPANY_TEST_SYSTEMD_USER") == "1",
                     "set AUTO_COMPANY_TEST_SYSTEMD_USER=1 for isolated user-service probes")
class SystemdRuntimeTests(SystemdFixture):
    def setUp(self):
        super().setUp()
        self.systemctl = shutil.which("systemctl")
        if not self.systemctl or not os.environ.get("XDG_RUNTIME_DIR"):
            self.fail("systemd user manager needs systemctl and XDG_RUNTIME_DIR")
        available = self.control("show-environment")
        if available.returncode:
            self.fail("systemd user bus unavailable: " + available.stderr.strip())

    def control(self, *args):
        return subprocess.run([self.systemctl, "--user", *args],
                              capture_output=True, text=True, timeout=20)

    def cleanup_unit(self, name, path, created_dirs):
        try:
            self.control("stop", name)
            self.control("reset-failed", name)
        finally:
            path.unlink(missing_ok=True)
            self.control("daemon-reload")
            for directory in reversed(created_dirs):
                if directory.exists() and not any(directory.iterdir()):
                    directory.rmdir()

    def run_probe(self, name, with_env=True):
        project, unit = self.generate_unit(name, with_env)
        unit_name = "auto-company-probe-" + uuid.uuid4().hex + ".service"
        unit_dir = Path(os.environ["XDG_RUNTIME_DIR"]) / "systemd/user"
        created_dirs = [p for p in (unit_dir.parent, unit_dir) if not p.exists()]
        unit_dir.mkdir(parents=True, exist_ok=True)
        unit_path = unit_dir / unit_name
        self.addCleanup(self.cleanup_unit, unit_name, unit_path, created_dirs)
        # Only lifecycle policy changes; path directives and ExecStart are verbatim.
        unit = unit.replace("Type=simple", "Type=oneshot").replace("Restart=always", "Restart=no")
        unit_path.write_text(unit, encoding="utf-8")
        result = self.control("daemon-reload")
        self.assertEqual(result.returncode, 0, result.stderr)
        result = self.control("start", unit_name)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        result_path = project / "probe-result"
        self.assertTrue(result_path.is_file(), "probe did not run in the checkout directory")
        self.assertEqual(result_path.read_text().splitlines(),
                         [str(project), "loaded from env % with spaces" if with_env else "missing"])

    def test_plain_path_loads_env(self):
        self.run_probe(PATHS[0])

    def test_space_path_loads_env(self):
        self.run_probe(PATHS[1])

    def test_percent_path_loads_env(self):
        self.run_probe(PATHS[2])

    def test_combined_special_path_loads_env(self):
        self.run_probe(PATHS[3])

    def test_missing_optional_env_still_runs(self):
        self.run_probe(PATHS[0], with_env=False)

    def test_prepared_service_stays_disabled_until_manual_start(self):
        project, unit = self.generate_unit("prepared repo", prepare=True)
        unit_name = "auto-company-probe-" + uuid.uuid4().hex + ".service"
        unit_dir = Path(os.environ["XDG_RUNTIME_DIR"]) / "systemd/user"
        created_dirs = [p for p in (unit_dir.parent, unit_dir) if not p.exists()]
        unit_dir.mkdir(parents=True, exist_ok=True)
        unit_path = unit_dir / unit_name
        self.addCleanup(self.cleanup_unit, unit_name, unit_path, created_dirs)
        unit_path.write_text(unit.replace("Type=simple", "Type=oneshot").replace("Restart=always", "Restart=no"))
        self.assertEqual(self.control("daemon-reload").returncode, 0)
        self.assertEqual(self.control("is-enabled", unit_name).stdout.strip(), "disabled")
        self.assertEqual(self.control("is-active", unit_name).stdout.strip(), "inactive")
        self.assertFalse((project / "probe-result").exists())
        started = self.control("start", unit_name)
        self.assertEqual(started.returncode, 0, started.stdout + started.stderr)
        self.assertTrue((project / "probe-result").exists())


if __name__ == "__main__":
    unittest.main()

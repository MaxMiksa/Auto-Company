"""Maintenance gates protect managed installs without changing clone behavior."""

import importlib.util
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/core"))
import installation_state
import localization


class InstallationStateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / ".auto-company"
        self.state.mkdir()

    def managed(self):
        (self.state / "install.json").write_text('{"schema":1,"language":"zh-CN"}')

    def test_clone_does_not_register_installer_files(self):
        with installation_state.writer_lease(self.root):
            self.assertFalse((self.state / "writers").exists())

    def test_managed_writer_exists_for_full_lifetime_then_cleans_up(self):
        self.managed()
        with self.assertRaisesRegex(RuntimeError, "probe"):
            with installation_state.writer_lease(self.root):
                records = list((self.state / "writers").glob("*.json"))
                self.assertEqual(len(records), 1)
                self.assertEqual(json.loads(records[0].read_text())["pid"], os.getpid())
                raise RuntimeError("probe")
        self.assertEqual(list((self.state / "writers").glob("*.json")), [])

    def test_maintenance_arriving_during_registration_prevents_start(self):
        self.managed()
        original = installation_state.check_maintenance
        count = 0

        def raced(root):
            nonlocal count
            count += 1
            if count == 2:
                (self.state / "maintenance.json").write_text("{}")
            original(root)

        with mock.patch.object(installation_state, "check_maintenance", side_effect=raced):
            with self.assertRaisesRegex(ValueError, "安装维护"):
                with installation_state.writer_lease(self.root):
                    self.fail("writer started during maintenance")
        self.assertEqual(list((self.state / "writers").glob("*.json")), [])

    def test_config_change_is_blocked_without_changing_saved_language(self):
        self.managed()
        local = self.root / ".auto-company.local"
        local.write_text("AUTO_COMPANY_LANGUAGE=zh-CN\n")
        (self.state / "maintenance.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "安装维护"):
            localization.set_language(self.root, "en")
        self.assertEqual(local.read_text(), "AUTO_COMPANY_LANGUAGE=zh-CN\n")
        self.assertFalse((self.root / ".auto-company.local.lock").exists())

    def test_malformed_maintenance_still_blocks_in_english(self):
        (self.state / "maintenance.json").write_text("invalid json")
        with self.assertRaisesRegex(ValueError, "maintenance is unfinished"):
            installation_state.check_maintenance(self.root)

    @unittest.skipIf(os.name == "nt", "project commands execute in POSIX runtime")
    def test_project_command_cannot_create_registry_during_maintenance(self):
        self.managed()
        (self.state / "maintenance.json").write_text("{}")
        result = subprocess.run(["bash", str(ROOT / "scripts/core/project.sh"), "new", "--name", "probe"],
                                env=dict(os.environ, AUTO_COMPANY_ROOT=str(self.root)),
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertFalse((self.root / "projects").exists())

    @unittest.skipIf(os.name == "nt", "exec preserves the POSIX project writer identity")
    def test_project_exec_keeps_lease_pid_and_literal_arguments(self):
        self.managed()
        directory = self.root / "scripts/core"
        directory.mkdir(parents=True)
        (directory / "project.sh").write_text('#!/bin/bash\nprintf "%s\\n" "$$" "$AUTO_COMPANY_PROJECT_WRITER" "$@"\n')
        literal = "project with $() and ' quote"
        result = subprocess.run([sys.executable, str(ROOT / "scripts/core/installation_state.py"),
                                 "project", "--root", str(self.root), "--", literal],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        pid, guard, value = result.stdout.splitlines()
        self.assertEqual(pid, guard)
        self.assertEqual(value, literal)
        record = json.loads(next((self.state / "writers").glob("*.json")).read_text())
        self.assertEqual(record["pid"], int(pid))
        self.assertEqual(record["kind"], "project-command")


if __name__ == "__main__":
    unittest.main()

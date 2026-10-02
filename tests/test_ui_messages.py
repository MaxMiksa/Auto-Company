"""Bilingual operator output with unchanged machine protocols and fake services."""

import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from isolation_fixture import install as install_fixture_boundary
SPEC = importlib.util.spec_from_file_location("ui_localization", ROOT / "scripts/core/localization.py")
LOCALIZATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LOCALIZATION)


class OperatorMessageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = dict(os.environ)
        self.env.pop("AUTO_COMPANY_LANGUAGE", None)

    def run_language(self, *args, **env):
        return subprocess.run([sys.executable, str(ROOT / "scripts/core/localization.py"),
                               *args, "--root", str(self.root)],
                              env=dict(self.env, **env), capture_output=True, text=True,
                              encoding="utf-8", timeout=10)

    def test_language_selection_and_invalid_config_diagnostic_fallback(self):
        local = self.root / ".auto-company.local"
        with mock.patch.dict(os.environ, self.env, clear=True):
            with mock.patch.object(LOCALIZATION, "system_language", return_value="zh-CN"):
                self.assertIn("当前没有", LOCALIZATION.message(self.root, "budget.not_paused"))
            local.write_text("AUTO_COMPANY_LANGUAGE=en\n", encoding="utf-8")
            self.assertEqual(LOCALIZATION.message(self.root, "budget.not_paused"), "Budget pause was not active.")
            with mock.patch.dict(os.environ, AUTO_COMPANY_LANGUAGE="zh-CN"):
                self.assertEqual(LOCALIZATION.message(self.root, "budget.not_paused"), "Budget pause was not active.")
            with mock.patch.dict(os.environ, AUTO_COMPANY_LANGUAGE="invalid"):
                self.assertEqual(LOCALIZATION.diagnostic_language(self.root), "en")
            local.write_text("$(touch sentinel)\n", encoding="utf-8")
            self.assertEqual(LOCALIZATION.diagnostic_language(self.root), "en")
        self.assertFalse((self.root / "sentinel").exists())

    def test_catalog_languages_placeholders_and_make_targets_match(self):
        catalog = json.loads((ROOT / "i18n/messages.json").read_text(encoding="utf-8"))
        for key, entry in catalog.items():
            with self.subTest(key=key):
                self.assertEqual(set(entry), {"en", "zh-CN"})
                self.assertEqual(re.findall(r"\{[0-9]+\}", entry["en"]),
                                 re.findall(r"\{[0-9]+\}", entry["zh-CN"]))
        targets = set(re.findall(r"^([a-zA-Z_-]+):.*?## ", (ROOT / "Makefile").read_text(), re.M))
        self.assertEqual(targets, {key[5:] for key in catalog if key.startswith("help.")})

    def test_safe_one_pass_substitution_and_missing_translation_fallback(self):
        with mock.patch.object(LOCALIZATION, "ROOT", self.root):
            (self.root / "i18n").mkdir()
            (self.root / "i18n/messages.json").write_text(json.dumps({
                "test": {"en": "Path {0}; reason {1}"}
            }), encoding="utf-8")
            value = "$(touch sentinel); {1} `false` %s"
            self.assertEqual(LOCALIZATION.message(self.root, "test", value, "safe", language="zh-CN"),
                             f"Path {value}; reason safe")
            for translated in ("", "  ", "Wrong {0} {0}", "Wrong {0} {9}", "Missing {0}"):
                (self.root / "i18n/messages.json").write_text(json.dumps({
                    "test": {"en": "Path {0}; reason {1}", "zh-CN": translated}
                }), encoding="utf-8")
                self.assertEqual(LOCALIZATION.message(self.root, "test", value, "safe", language="zh-CN"),
                                 f"Path {value}; reason safe")
            self.assertEqual(LOCALIZATION.message(self.root, "missing", value), f"[missing] {value}")
            for invalid in ('{"test":[]}', '{"test":{"en":" "}}'):
                (self.root / "i18n/messages.json").write_text(invalid, encoding="utf-8")
                self.assertEqual(LOCALIZATION.message(self.root, "test", value), f"[test] {value}")

    def test_set_success_invalid_and_next_product_running_messages_both_languages(self):
        for language, saved, running in (("zh-CN", "已保存", "请用 make stop"),
                                         ("en", "Saved", "stop the foreground loop with make stop")):
            with self.subTest(language=language):
                result = self.run_language("set", "--language", language, AUTO_COMPANY_LANGUAGE=language)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(saved, result.stdout)
                result = self.run_language("set", "--language", "invalid", AUTO_COMPANY_LANGUAGE=language)
                self.assertEqual(result.returncode, 78)
                self.assertIn("Error: language must be zh-CN or en", result.stderr)
                pid = self.root / ".auto-loop.pid"
                pid.write_text("1234", encoding="utf-8")
                before = (self.root / ".auto-company.local").read_bytes()
                result = self.run_language("next-product", "--confirm", "NEXT", AUTO_COMPANY_LANGUAGE=language)
                self.assertEqual(result.returncode, 78)
                self.assertIn(running, result.stderr)
                self.assertIn("make pause", result.stderr)
                self.assertEqual((self.root / ".auto-company.local").read_bytes(), before)
                pid.unlink()

    def test_check_keeps_exact_machine_language_output(self):
        for language in ("zh-CN", "en"):
            result = self.run_language("check", AUTO_COMPANY_LANGUAGE=language)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, language + "\n", ""))
        result = self.run_language("check", AUTO_COMPANY_LANGUAGE="invalid")
        self.assertEqual(result.returncode, 78)
        self.assertEqual(result.stdout, "")
        self.assertIn("Check AUTO_COMPANY_LANGUAGE", result.stderr)

    @unittest.skipUnless(os.name == "posix" and Path("/bin/bash").exists(), "Native POSIX Bash")
    def test_native_bash_nounset_handles_messages_with_and_without_parameters(self):
        # /bin/bash is 3.2 on macOS; empty arrays there differ from modern Bash.
        command = ["/bin/bash", "-uc",
                   'source "$1/scripts/core/ui-messages.sh"; PROJECT_DIR="$1"; '
                   'ui_message loop.stopping; ui_message language.saved en',
                   "message-test", str(ROOT)]
        for language, saved in (("en", "Saved language preference: en"),
                                ("zh-CN", "已保存语言偏好：en")):
            result = subprocess.run(command, env=dict(self.env, AUTO_COMPANY_LANGUAGE=language),
                                    capture_output=True, text=True, encoding="utf-8", timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(len(result.stdout.splitlines()), 2)
            self.assertIn(saved, result.stdout)
            self.assertEqual(result.stderr, "")


@unittest.skipUnless(os.name == "posix" and sys.platform == "linux", "Linux/WSL entrypoint fixtures")
class ShellOperatorMessageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="auto-company-ui-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'repo {1} & test'
        self.root.mkdir()
        shutil.copytree(ROOT / "scripts", self.root / "scripts")
        install_fixture_boundary(self.root)
        shutil.copytree(ROOT / "i18n", self.root / "i18n")
        shutil.copy2(ROOT / "Makefile", self.root / "Makefile")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.home = self.root / "home"
        self.home.mkdir()
        self.env = dict(os.environ, HOME=str(self.home), PATH=f"{self.bin}:{os.environ['PATH']}",
                        ENGINE="claude", CLAUDE_PERMISSION_MODE="default")
        self.env.pop("AUTO_COMPANY_LANGUAGE", None)
        self.fake("systemctl", "exit 1")
        self.fake("loginctl", "exit 0")

    def fake(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/sh\n" + body + "\n", encoding="utf-8")
        path.chmod(0o755)

    def run_script(self, relative, *args, language="zh-CN"):
        return subprocess.run(["/bin/bash", str(self.root / relative), *args],
                              env=dict(self.env, AUTO_COMPANY_LANGUAGE=language), cwd=self.root,
                              capture_output=True, text=True, encoding="utf-8", timeout=20)

    def test_shell_values_are_literal_and_do_not_execute(self):
        value = '$(touch injected); `touch injected` {1} " %s'
        result = self.run_script("scripts/core/ui-messages.sh", "loop.started", value)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(value, result.stdout)
        self.assertFalse((self.root / "injected").exists())

    def test_make_help_default_and_language_precedence(self):
        (self.root / ".auto-company.local").write_text("AUTO_COMPANY_LANGUAGE=en\n", encoding="utf-8")
        result = subprocess.run(["make"], cwd=self.root, env=self.env, capture_output=True,
                                text=True, encoding="utf-8", timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Start the auto-loop", result.stdout)
        result = subprocess.run(["make", "help"], cwd=self.root,
                                env=dict(self.env, AUTO_COMPANY_LANGUAGE="zh-CN"),
                                capture_output=True, text=True, encoding="utf-8", timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Start the auto-loop", result.stdout)
        (self.root / ".auto-company.local").unlink()
        result = subprocess.run(["make", "help"], cwd=self.root,
                                env=dict(self.env, AUTO_COMPANY_LANGUAGE="zh-CN"),
                                capture_output=True, text=True, encoding="utf-8", timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("在前台启动自动循环", result.stdout)

    def test_missing_python_has_actionable_fallback_and_keeps_original_error(self):
        empty_bin = self.root / "minimal-bin"
        empty_bin.mkdir()
        for tool in ("dirname", "tr"):
            (empty_bin / tool).symlink_to(shutil.which(tool))
        self.env["PATH"] = str(empty_bin)
        result = self.run_script("scripts/core/auto-loop.sh", language="en")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Error: python3 is required", result.stdout)
        self.assertIn("Install Python 3", result.stdout)
        self.assertNotIn("Traceback", result.stderr)
        result = self.run_script("scripts/core/ui-messages.sh", "help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Start the auto-loop", result.stdout)

    def test_systemd_install_uninstall_both_languages_without_host_service(self):
        self.fake("systemctl", "exit 0")
        units = []
        for language, installed, removed in (("zh-CN", "已安装：", "卸载完成"),
                                             ("en", "Installed:", "Uninstall complete")):
            result = self.run_script("scripts/wsl/install-wsl-daemon.sh", language=language)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(installed, result.stdout)
            unit = self.home / ".config/systemd/user/auto-company.service"
            units.append(unit.read_bytes())
            result = self.run_script("scripts/wsl/uninstall-wsl-daemon.sh", language=language)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(removed, result.stdout)
            self.assertFalse(unit.exists())
        self.assertEqual(*units)

    def test_mac_install_and_stop_help_both_languages_with_fake_launchctl(self):
        self.fake("uname", "printf 'Darwin\\n'")
        self.fake("launchctl", "exit 0")
        self.fake("fake-engine", "printf 'fake 1\\n'")
        self.env["CLAUDE_BIN"] = str(self.bin / "fake-engine")
        for language, installed, usage in (("zh-CN", "后台服务已安装并启动", "用法："),
                                           ("en", "Daemon installed and started", "Usage:")):
            result = self.run_script("scripts/macos/install-daemon.sh", language=language)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(installed, result.stdout)
            result = self.run_script("scripts/core/stop-loop.sh", "--help", language=language)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(usage, result.stdout)

    def test_status_protocol_outputs_do_not_change_with_language(self):
        for script, args in (("scripts/core/monitor.sh", ("--status",)),
                             ("scripts/wsl/dashboard-wsl.sh", ("status",))):
            results = [self.run_script(script, *args, language=lang) for lang in ("en", "zh-CN")]
            self.assertEqual(results[0].stdout, results[1].stdout)
            self.assertEqual(results[0].returncode, results[1].returncode)
            self.assertIn("===", results[0].stdout)

    def test_usage_json_unchanged_and_human_budget_explanation_localized(self):
        pause = self.root / ".auto-loop-budget-paused"
        pause.write_text('{"reason":"usage_hard_limit"}', encoding="utf-8")
        outputs = []
        for language, expected in (("en", "Review usage and limits"), ("zh-CN", "请先检查用量和限额")):
            command = [sys.executable, str(self.root / "scripts/core/usage.py"), "status"]
            env = dict(self.env, AUTO_COMPANY_LANGUAGE=language)
            result = subprocess.run(command + ["--format", "json"], env=env, capture_output=True,
                                    text=True, encoding="utf-8", timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            outputs.append(result.stdout)
            result = subprocess.run(command, env=env, capture_output=True,
                                    text=True, encoding="utf-8", timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(expected, result.stdout)
        self.assertEqual(*outputs)
        self.assertTrue(json.loads(outputs[0])["paused"])


if __name__ == "__main__":
    unittest.main()

"""Language selection, customization preservation and real fake-engine routing."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
from concurrent.futures import ThreadPoolExecutor


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("localization", ROOT / "scripts/core/localization.py")
LOCALIZATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LOCALIZATION)


class LocalizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.local = self.root / ".auto-company.local"

    def test_precedence_and_explicit_invalid_values(self):
        with mock.patch.object(LOCALIZATION, "system_language", return_value="en"):
            self.assertEqual(LOCALIZATION.resolve_language(self.root, {}), "en")
        self.assertEqual(LOCALIZATION.resolve_language(self.root, {"AUTO_COMPANY_LANGUAGE": "zh-CN"}), "zh-CN")
        for value in ("", "fr", "../../en", "EN"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                LOCALIZATION.resolve_language(self.root, {"AUTO_COMPANY_LANGUAGE": value})
        self.local.write_text("AUTO_COMPANY_LANGUAGE=en\n", encoding="utf-8")
        self.assertEqual(LOCALIZATION.resolve_language(self.root, {}), "en")
        for value in ("zh-CN", "invalid"):
            self.assertEqual(LOCALIZATION.resolve_language(self.root, {"AUTO_COMPANY_LANGUAGE": value}), "en")

    def test_set_preserves_selection_comments_and_line_endings(self):
        before = b"# human-owned\r\nACTIVE_PROJECT=projects/example\r\nAUTO_COMPANY_LANGUAGE=zh-CN\r\nCUSTOM_SETTING=keep"
        self.local.write_bytes(before)
        LOCALIZATION.set_language(self.root, "en")
        self.assertEqual(self.local.read_bytes(), before.replace(b"LANGUAGE=zh-CN", b"LANGUAGE=en"))
        LOCALIZATION.set_language(self.root, "en")
        self.assertEqual(self.local.read_bytes().count(b"AUTO_COMPANY_LANGUAGE="), 1)

    def test_running_loop_can_save_next_product_preference_without_changing_pin(self):
        LOCALIZATION.set_language(self.root, "en")
        first = LOCALIZATION.start_product(self.root)
        (self.root / ".auto-loop.pid").write_text("1234")
        LOCALIZATION.set_language(self.root, "zh-CN")
        state = LOCALIZATION.language_state(self.root)
        self.assertEqual((state["language"], state["nextLanguage"], state["pending"]), ("en", "zh-CN", True))
        self.assertEqual(state["productId"], first["productId"])
        with self.assertRaises(LOCALIZATION.LanguageLockedError):
            LOCALIZATION.next_product(self.root, "NEXT")
        (self.root / ".auto-loop.pid").write_text("")
        self.assertEqual(LOCALIZATION.start_product(self.root), state, "restart retains the product pin")
        second = LOCALIZATION.next_product(self.root, "NEXT")
        self.assertEqual((second["language"], second["pending"]), ("zh-CN", False))
        self.assertNotEqual(second["productId"], first["productId"])

    def test_malformed_config_is_not_overwritten(self):
        for raw in (b"AUTO_COMPANY_LANGUAGE=en\nAUTO_COMPANY_LANGUAGE=zh-CN\n", b"$(touch sentinel)\n"):
            self.local.write_bytes(raw)
            with self.assertRaises(ValueError):
                LOCALIZATION.set_language(self.root, "en")
            self.assertEqual(self.local.read_bytes(), raw)

    def test_actual_host_ui_locale_and_fallbacks(self):
        with mock.patch.object(LOCALIZATION.platform, "system", return_value="Windows"), \
                mock.patch.object(LOCALIZATION.ctypes, "windll", create=True) as windows:
            windows.kernel32.GetUserDefaultUILanguage.return_value = 2052
            self.assertEqual(LOCALIZATION.system_language({"LANG": "en_US.UTF-8"}), "zh-CN")
        with mock.patch.object(LOCALIZATION.platform, "system", return_value="Linux"), \
                mock.patch.object(LOCALIZATION.platform, "release", return_value="microsoft-standard-WSL2"), \
                mock.patch.object(LOCALIZATION.shutil, "which", return_value="powershell.exe"), \
                mock.patch.object(LOCALIZATION, "_locale_command", return_value="en-US") as command:
            self.assertEqual(LOCALIZATION.system_language({"LANG": "zh_CN.UTF-8"}), "en")
            self.assertIn("GetUserDefaultUILanguage", command.call_args.args[0][-1])
        with mock.patch.object(LOCALIZATION.platform, "system", return_value="Darwin"), \
                mock.patch.object(LOCALIZATION, "_locale_command", return_value='(\n    "zh-Hans-CN",\n    "en-US"\n)'):
            self.assertEqual(LOCALIZATION.system_language({"LANG": "en_US.UTF-8"}), "zh-CN")
        with mock.patch.object(LOCALIZATION.platform, "system", return_value="Linux"), \
                mock.patch.object(LOCALIZATION.platform, "release", return_value="generic"):
            self.assertEqual(LOCALIZATION.system_language({"LC_MESSAGES": "zh_CN.UTF-8", "LANG": "en_US"}), "zh-CN")
            self.assertEqual(LOCALIZATION.system_language({"LANG": "de_DE.UTF-8"}), "en")
            self.assertEqual(LOCALIZATION.system_language({}), "en")

    def project_config(self, command):
        result = subprocess.run([sys.executable, str(ROOT / "scripts/core/project-context.py"),
                                 command, "--root", str(self.root)], capture_output=True, text=True)
        self.assertIn(result.returncode, (0, 42), result.stderr)
        return result.returncode

    def test_preference_update_preserves_governance_and_recovers_interrupted_transaction(self):
        self.local.write_bytes(b"# keep\r\nACTIVE_PROJECT=projects/original\r\nAUTO_COMPANY_LANGUAGE=en\r\n")
        LOCALIZATION.start_product(self.root)
        self.project_config("capture")
        self.local.write_bytes(self.local.read_bytes().replace(b"projects/original", b"projects/engine-edit"))
        original_write = LOCALIZATION.atomic_write

        def interrupted_write(path, data):
            if path.name.endswith("cycle-backup"):
                raise OSError("simulated interruption after the preference file was replaced")
            original_write(path, data)

        with mock.patch.object(LOCALIZATION, "atomic_write", side_effect=interrupted_write), self.assertRaises(OSError):
            LOCALIZATION.set_language(self.root, "zh-CN")
        self.assertTrue((self.root / ".auto-company.local.language-update").exists())
        self.assertEqual(self.project_config("verify"), 42)
        state = LOCALIZATION.language_state(self.root)
        self.assertEqual((state["language"], state["nextLanguage"]), ("en", "zh-CN"))
        self.assertIn(b"ACTIVE_PROJECT=projects/original\r\n", self.local.read_bytes())
        self.assertFalse((self.root / ".auto-company.local.language-update").exists())

    def test_corrupt_state_and_journal_fail_closed(self):
        LOCALIZATION.set_language(self.root, "en")
        LOCALIZATION.start_product(self.root)
        original = self.local.read_bytes()
        self.local.write_bytes(original.replace(b"PRODUCT_STATUS=active", b"PRODUCT_STATUS=broken"))
        for operation in (lambda: LOCALIZATION.language_state(self.root),
                          lambda: LOCALIZATION.set_language(self.root, "zh-CN"),
                          lambda: LOCALIZATION.start_product(self.root)):
            with self.assertRaises(ValueError):
                operation()
        self.local.write_bytes(original)
        (self.root / ".auto-company.local.language-update").write_text('{"language":"bad"}')
        with self.assertRaises(ValueError):
            LOCALIZATION.language_state(self.root)
        self.assertEqual(self.local.read_bytes(), original)

    def test_new_product_requires_confirmation_and_recovered_governance(self):
        LOCALIZATION.set_language(self.root, "en")
        original = LOCALIZATION.start_product(self.root)
        with self.assertRaises(ValueError):
            LOCALIZATION.next_product(self.root, "")
        memories = self.root / "memories"
        memories.mkdir()
        (memories / ".consensus-cycle-pending").write_text("1")
        with self.assertRaises(LOCALIZATION.LanguageLockedError):
            LOCALIZATION.next_product(self.root, "NEXT")
        self.assertEqual(LOCALIZATION.language_state(self.root), original)

    def test_concurrent_start_and_preference_change_have_one_consistent_pin(self):
        LOCALIZATION.set_language(self.root, "en")
        with ThreadPoolExecutor(max_workers=2) as executor:
            start = executor.submit(LOCALIZATION.start_product, self.root)
            change = executor.submit(LOCALIZATION.set_language, self.root, "zh-CN")
            initial = start.result()
            change.result()
        state = LOCALIZATION.language_state(self.root)
        self.assertEqual(state["nextLanguage"], "zh-CN")
        self.assertEqual(state["productId"], initial["productId"])
        self.assertEqual(state["language"], initial["language"])
        self.assertEqual(LOCALIZATION.start_product(self.root), state)

    def test_managed_root_blocks_interactive_team_before_config_or_engine(self):
        (self.root / ".auto-company-center.json").write_text("{}")
        before = {str(path.relative_to(self.root)): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        with mock.patch.object(LOCALIZATION.shutil, "which") as executable, \
                mock.patch.object(LOCALIZATION.subprocess, "run") as run:
            with self.assertRaises(LOCALIZATION.LanguageLockedError):
                LOCALIZATION.interactive_team(self.root, "claude")
            executable.assert_not_called()
            run.assert_not_called()
        after = {str(path.relative_to(self.root)): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        self.assertEqual(after, before)

    def test_interactive_session_blocks_transition_and_inherits_pin(self):
        LOCALIZATION.set_language(self.root, "en")

        def interactive(arguments, **kwargs):
            self.assertEqual(kwargs["env"]["AUTO_COMPANY_LANGUAGE"], "en")
            self.assertIn("AUTO_COMPANY_LANGUAGE=en", arguments[1])
            LOCALIZATION.set_language(self.root, "zh-CN")
            with self.assertRaises(LOCALIZATION.LanguageLockedError):
                LOCALIZATION.next_product(self.root, "NEXT")
            return subprocess.CompletedProcess(arguments, 0)

        with mock.patch.object(LOCALIZATION.shutil, "which", return_value="fake-claude"), \
                mock.patch.object(LOCALIZATION.subprocess, "run", side_effect=interactive):
            self.assertEqual(LOCALIZATION.interactive_team(self.root, "claude"), 0)
        self.assertFalse((self.root / ".auto-company.local.team-active").exists())
        self.assertEqual(LOCALIZATION.language_state(self.root)["language"], "en")
        self.assertEqual(LOCALIZATION.next_product(self.root, "NEXT")["language"], "zh-CN")

    def test_killed_writer_requires_explicit_recovery_and_preserves_pin(self):
        LOCALIZATION.set_language(self.root, "en")
        original = LOCALIZATION.start_product(self.root)
        self.project_config("capture")
        script = (
            "import importlib.util, pathlib, sys, time, json; "
            "s=importlib.util.spec_from_file_location('l', sys.argv[1]); "
            "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
            "root=pathlib.Path(sys.argv[2]); lease=m.configuration_lock(root); lease.__enter__(); "
            "m.atomic_write(root/'.auto-company.local.language-update', json.dumps({'version':1,'language':'zh-CN'}).encode()); "
            "(root/'writer-ready').touch(); time.sleep(60)"
        )
        process = subprocess.Popen([sys.executable, "-c", script, str(ROOT / "scripts/core/localization.py"), str(self.root)])
        try:
            deadline = time.monotonic() + 5
            while not (self.root / "writer-ready").exists():
                self.assertIsNone(process.poll())
                if time.monotonic() > deadline:
                    self.fail("writer did not acquire the configuration lease")
                time.sleep(0.02)
            process.kill()
            process.wait(timeout=5)
            self.assertEqual(LOCALIZATION.language_state(self.root), original)
            with self.assertRaises(ValueError), LOCALIZATION.configuration_lock(self.root, timeout=0.01):
                self.fail("a dead lease must not be stolen automatically")
            with self.assertRaises(ValueError):
                LOCALIZATION.recover_configuration_lock(self.root, "")
            (self.root / ".auto-company.local.team-active").write_text("12345")
            recovered = LOCALIZATION.recover_configuration_lock(self.root, "RECOVER")
            self.assertEqual(recovered["productId"], original["productId"])
            self.assertEqual((recovered["language"], recovered["nextLanguage"]), ("en", "zh-CN"))
            self.assertEqual(self.project_config("verify"), 0)
            self.assertFalse((self.root / ".auto-company.local.team-active").exists())
            self.assertFalse((self.root / ".auto-company.local.language-update").exists())
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)

    def test_translated_resource_falls_back_for_customized_or_missing_asset(self):
        source = self.root / "PROMPT.md"
        source.write_bytes("原文\n".encode())
        translated = self.root / "i18n/en/PROMPT.md"
        translated.parent.mkdir(parents=True)
        translated.write_text("Translated prompt\n", encoding="utf-8")
        (self.root / "i18n/source-hashes.json").write_text(json.dumps({
            "PROMPT.md": hashlib.sha256(source.read_bytes()).hexdigest(),
        }), encoding="utf-8")
        self.assertTrue(LOCALIZATION.build_prompt(self.root, "en").startswith("Translated prompt"))
        source.write_bytes("原文\r\n".encode())
        self.assertTrue(LOCALIZATION.build_prompt(self.root, "en").startswith("Translated prompt"))
        source.write_text("My exact custom instruction", encoding="utf-8")
        self.assertTrue(LOCALIZATION.build_prompt(self.root, "en").startswith("My exact custom instruction"))
        self.assertEqual(source.read_text(), "My exact custom instruction")
        source.write_bytes("原文\n".encode())
        translated.unlink()
        self.assertTrue(LOCALIZATION.build_prompt(self.root, "en").startswith("原文"))

    def test_packaged_resource_manifest_matches_sources(self):
        manifest = json.loads((ROOT / "i18n/source-hashes.json").read_text(encoding="utf-8"))
        self.assertIn("PROMPT.md", manifest)
        for name, digest in manifest.items():
            with self.subTest(name=name):
                self.assertEqual(LOCALIZATION.source_digest(ROOT / name), digest,
                                 "Source changed: review translations and update their baseline")
                self.assertTrue(any((ROOT / "i18n" / lang / name).is_file() for lang in LOCALIZATION.LANGUAGES))

    def test_customized_roles_and_skills_override_bundled_translations(self):
        manifest = {}
        names = (".claude/agents/ceo-bezos.md", ".claude/skills/team/SKILL.md")
        for name in names:
            original = self.root / name
            original.parent.mkdir(parents=True)
            original.write_text("Original role or skill\n", encoding="utf-8")
            translated = self.root / "i18n/en" / name
            translated.parent.mkdir(parents=True)
            translated.write_text("Translated role or skill\n", encoding="utf-8")
            manifest[name] = LOCALIZATION.source_digest(original)
        (self.root / "i18n/source-hashes.json").write_text(json.dumps(manifest), encoding="utf-8")
        before = LOCALIZATION.resource_map(self.root, "en")
        self.assertEqual(before[names[0]], "i18n/en/" + names[0])
        self.assertEqual(before[names[1]], names[1], "skill instructions always use the canonical source")
        for name in names:
            (self.root / name).write_text("My custom instructions\n", encoding="utf-8")
        self.assertEqual(LOCALIZATION.resource_map(self.root, "en"), {name: name for name in names})

    @unittest.skipUnless(os.name == "posix" and os.uname().sysname == "Linux", "Linux fake-engine cycle")
    def test_real_loop_delivers_selected_language_and_preserves_human_config(self):
        for language in LOCALIZATION.LANGUAGES:
            with self.subTest(language=language), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                shutil.copytree(ROOT / "scripts/core", root / "scripts/core")
                shutil.copytree(ROOT / "i18n", root / "i18n")
                shutil.copytree(ROOT / ".claude", root / ".claude")
                (root / "memories").mkdir()
                shutil.copy2(ROOT / "memories/consensus.template.md", root / "memories")
                shutil.copy2(ROOT / "PROMPT.md", root)
                shutil.copy2(ROOT / "CLAUDE.md", root)
                config = f"AUTO_COMPANY_LANGUAGE={language}\n".encode()
                (root / ".auto-company.local").write_bytes(config)
                fake = root / "fake-engine"
                fake.write_text("#!/usr/bin/env python3\nimport json, os, pathlib, sys, time\n"
                                "if '--version' in sys.argv: print('fake 1'); sys.exit(0)\n"
                                "pathlib.Path(os.environ['CAPTURE']).write_text(json.dumps(sys.argv), encoding='utf-8')\n"
                                "pathlib.Path(os.environ['CAPTURE'] + '.language').write_text(os.environ.get('AUTO_COMPANY_LANGUAGE', ''))\n"
                                "while not pathlib.Path(os.environ['RELEASE']).exists(): time.sleep(0.02)\n"
                                "print(json.dumps({'result':'ok','usage':{'input_tokens':2,'output_tokens':2}}))\n")
                fake.chmod(0o755)
                env = dict(os.environ, ENGINE="claude", CLAUDE_BIN=str(fake), CLAUDE_PERMISSION_MODE="default",
                           CAPTURE=str(root / "captured.json"), USAGE_HARD_LIMIT_TOKENS="1",
                           RELEASE=str(root / "release-engine"),
                           LOOP_INTERVAL="60", BUDGET_PAUSE_POLL_SECONDS="60", CYCLE_TIMEOUT_SECONDS="10")
                env.pop("AUTO_COMPANY_LANGUAGE", None)
                with (root / "output").open("w") as stream:
                    process = subprocess.Popen(["bash", str(root / "scripts/core/auto-loop.sh")],
                                               env=env, stdout=stream, stderr=stream)
                    try:
                        deadline = time.monotonic() + 20
                        while not (root / "captured.json").exists():
                            if process.poll() is not None or time.monotonic() > deadline:
                                self.fail((root / "output").read_text())
                            time.sleep(0.05)
                        next_language = "en" if language == "zh-CN" else "zh-CN"
                        LOCALIZATION.set_language(root, next_language)
                        (root / "release-engine").touch()
                        while not (root / ".auto-loop-budget-paused").exists():
                            if process.poll() is not None or time.monotonic() > deadline:
                                self.fail((root / "output").read_text())
                            time.sleep(0.05)
                        args = json.loads((root / "captured.json").read_text())
                        prompt = args[args.index("-p") + 1]
                        self.assertIn(f"AUTO_COMPANY_LANGUAGE={language}", prompt)
                        self.assertIn(".claude/skills/team/SKILL.md", prompt)
                        self.assertIn("## Human Overrides", prompt)
                        self.assertIn("product interface text", prompt)
                        state = LOCALIZATION.language_state(root)
                        self.assertTrue(state["locked"])
                        self.assertEqual(state["language"], language)
                        self.assertEqual((root / "captured.json.language").read_text(), language)
                        self.assertEqual(state["nextLanguage"], next_language)
                        self.assertTrue(state["pending"])
                        self.assertFalse((root / ".auto-loop-paused").exists(), "authorized preference changes must not trigger governance pauses")
                    finally:
                        if process.poll() is None:
                            process.send_signal(signal.SIGTERM)
                        process.wait(timeout=10)


if __name__ == "__main__":
    unittest.main()

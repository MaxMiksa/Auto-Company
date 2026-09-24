"""Bootstrap contracts without installing packages, services or model calls."""

import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = ROOT / "scripts/install/bootstrap.sh"


class BootstrapCatalogTests(unittest.TestCase):
    def test_catalog_is_complete_and_placeholders_match(self):
        entries = {}
        for line in (ROOT / "scripts/install/bootstrap-messages.tsv").read_text(encoding="utf-8").splitlines():
            key, english, chinese = line.split("\t")
            self.assertNotIn(key, entries)
            self.assertTrue(english and chinese)
            self.assertEqual(re.findall(r"\{\d+\}", english), re.findall(r"\{\d+\}", chinese))
            entries[key] = (english, chinese)
        shell = BOOTSTRAP.read_text(encoding="utf-8")
        powershell = (ROOT / "scripts/install/bootstrap.ps1").read_text(encoding="utf-8")
        used = set(re.findall(r"bootstrap_message ([a-z_]+)", shell))
        used.update(re.findall(r"(?:Write|Get)-BootstrapMessage '([a-z_]+)'", powershell))
        self.assertFalse(used - entries.keys())

    def test_powershell_entrypoints_are_ascii_for_51(self):
        for name in ("setup.ps1", "scripts/install/bootstrap.ps1"):
            (ROOT / name).read_bytes().decode("ascii")


@unittest.skipIf(os.name == "nt", "POSIX bootstrap executes under Linux/macOS; run this suite in WSL")
class PosixBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="auto setup ' $ ")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.source = self.base / "payload 空格 $ '"
        self.source.mkdir()
        (self.source / "release-files.json").write_text("{}", encoding="utf-8")
        self.target = self.base / "stable 空格 $ '"
        self.environment = dict(os.environ, HOME=str(self.base / "home"), XDG_STATE_HOME=str(self.base / "state"),
                                XDG_DATA_HOME=str(self.base / "data"), LANG="en_US.UTF-8", LANGUAGE="", LC_ALL="")
        self.environment.pop("WSL_DISTRO_NAME", None)
        self.environment.pop("WSL_INTEROP", None)
        Path(self.environment["HOME"]).mkdir()

    def run_shell(self, body, *arguments, input_text=""):
        script = self.base / "case.sh"
        script.write_text('source "$1"\nshift\n' + body, encoding="utf-8")
        return subprocess.run(["bash", str(script), str(BOOTSTRAP), *map(str, arguments)],
                              env=self.environment, input=input_text, capture_output=True, text=True, timeout=20)

    def test_language_detection_before_python_macos_and_linux(self):
        result = self.run_shell("""
python3() { echo 'PYTHON MUST NOT RUN' >&2; return 99; }
uname() { echo Darwin; }
defaults() { printf '(\\n    "zh-Hant-CN",\\n    "en-US"\\n)\\n'; }
bootstrap_system_language
uname() { echo Linux; }
LANG=fr_FR.UTF-8 LANGUAGE= LC_MESSAGES=zh_CN.UTF-8 bootstrap_system_language
LANG=zh_CN.UTF-8 LANGUAGE=en_GB LC_MESSAGES= bootstrap_system_language
""")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ["zh-CN", "zh-CN", "en"])
        self.assertNotIn("PYTHON", result.stderr)

    def test_message_values_are_not_reinterpreted(self):
        result = self.run_shell('bootstrap_message plan \'literal {1} $() %s\' en codex')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'System: literal {1} $() %s | Language: en | Engine: codex\n')

    def test_explicit_language_covers_failure_before_python(self):
        result = self.run_shell('python3() { return 99; }; bootstrap_main --language zh-CN --invalid')
        self.assertEqual(result.returncode, 2)
        self.assertIn("选项或参数值无效", result.stderr)
        self.assertFalse((self.base / "state").exists())

    def test_plan_and_cancel_do_not_write_state_or_install(self):
        body = """
bootstrap_system_language() { echo en; }
bootstrap_inspect() { bootstrap_message missing 'Python'; }
bootstrap_install_packages() { echo 'UNEXPECTED INSTALL'; return 99; }
bootstrap_main --source "$1" --target "$2" --language zh-CN "$3"
"""
        planned = self.run_shell(body, self.source, self.target, "--plan")
        self.assertEqual(planned.returncode, 0, planned.stderr)
        self.assertIn("安装位置", planned.stdout)
        self.assertFalse((self.base / "state").exists())
        cancelled = self.run_shell(body.replace('"$3"', ''), self.source, self.target, input_text="n\n")
        self.assertEqual(cancelled.returncode, 0, cancelled.stderr)
        self.assertIn("已取消", cancelled.stdout)
        self.assertFalse((self.base / "state").exists())
        self.assertNotIn("UNEXPECTED", cancelled.stdout)

    def test_checkpoint_preserves_literal_paths_language_and_manual_override(self):
        body = """
BOOTSTRAP_STATE="$1"
BOOTSTRAP_TARGET="$2" BOOTSTRAP_LANGUAGE=zh-CN BOOTSTRAP_ENGINE=codex BOOTSTRAP_MEDIA=yes
bootstrap_save_state dependencies || exit
BOOTSTRAP_LANGUAGE=en
bootstrap_read_state || exit
printf '%s\\n' "$SAVED_LANGUAGE" "$SAVED_TARGET" "$SAVED_ENGINE" "$SAVED_MEDIA"
bootstrap_inspect() { :; }
bootstrap_main --source "$3" --plan --language en
"""
        state = self.base / "state/auto-company/setup-state.tsv"
        result = self.run_shell(body, state, self.target, self.source)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines()[:4], ["zh-CN", str(self.target), "codex", "yes"])
        self.assertIn("Language: en | Engine: codex", result.stdout)
        self.assertEqual(state.stat().st_mode & 0o777, 0o600)

    def test_state_is_not_executable_and_symlinks_are_rejected(self):
        state = self.base / "state.tsv"
        state.write_text('language\ten\ntarget\t$(touch SHOULD_NOT_EXIST)\nengine\tcodex\nmedia\tno\n', encoding="utf-8")
        result = self.run_shell('BOOTSTRAP_STATE="$1"; bootstrap_read_state; printf "%s\\n" "$SAVED_TARGET"', state)
        self.assertEqual(result.returncode, 0)
        self.assertIn("$(touch SHOULD_NOT_EXIST)", result.stdout)
        link = self.base / "link.tsv"
        link.symlink_to(state)
        rejected = self.run_shell('BOOTSTRAP_STATE="$1"; bootstrap_read_state', link)
        self.assertNotEqual(rejected.returncode, 0)
        state.write_text('language\ten\nlanguage\tzh-CN\n', encoding="utf-8")
        duplicate = self.run_shell('BOOTSTRAP_STATE="$1"; bootstrap_read_state', state)
        self.assertNotEqual(duplicate.returncode, 0)

    def test_missing_homebrew_and_unsupported_linux_fail_without_install(self):
        result = self.run_shell("""
BOOTSTRAP_LANGUAGE=zh-CN BOOTSTRAP_OS=Linux BOOTSTRAP_PACKAGES='git python3'
bootstrap_ubuntu_supported() { return 1; }
sudo() { echo UNEXPECTED; return 99; }
bootstrap_install_packages
""")
        self.assertEqual(result.returncode, 3)
        self.assertIn("手动准备", result.stderr)
        self.assertNotIn("UNEXPECTED", result.stdout)

    def test_node_hash_mismatch_never_extracts(self):
        result = self.run_shell("""
BOOTSTRAP_NEED_NODE=yes BOOTSTRAP_OS=Linux BOOTSTRAP_TOOLS="$1"
uname() { echo x86_64; }
curl() { while [ "$1" != -o ]; do shift; done; printf tampered > "$2"; }
tar() { echo 'UNEXPECTED EXTRACT'; return 99; }
bootstrap_install_node
""", self.base / "tools")
        self.assertEqual(result.returncode, 3)
        self.assertNotIn("UNEXPECTED", result.stdout)
        self.assertFalse((self.base / "tools/node-v22.22.0-linux-x64").exists())

    def test_windows_npm_engine_shim_is_not_reused_in_wsl(self):
        tool = self.base / "windows-npm"
        tool.mkdir()
        executable = tool / "codex"
        executable.write_text('#!/bin/sh\n# Windows shim uses node.exe\necho UNEXPECTED_ENGINE\n', encoding="utf-8")
        executable.chmod(0o755)
        self.environment["PATH"] = str(tool) + os.pathsep + self.environment["PATH"]
        result = self.run_shell('BOOTSTRAP_ENGINE=codex; bootstrap_engine_ok')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("UNEXPECTED_ENGINE", result.stdout)

    def test_existing_environment_conflict_is_preserved(self):
        self.target.mkdir()
        environment = self.target / ".auto-loop.env"
        original = b'ENGINE="claude"\nPRIVATE_VALUE="keep"\n'
        environment.write_bytes(original)
        result = self.run_shell('BOOTSTRAP_TARGET="$1" BOOTSTRAP_ENGINE=codex; codex() { :; }; bootstrap_environment', self.target)
        self.assertEqual(result.returncode, 3)
        self.assertEqual(environment.read_bytes(), original)

    def test_new_environment_has_selected_engine_and_literal_tool_path(self):
        self.target.mkdir()
        tool = self.base / "bin space"
        tool.mkdir()
        executable = tool / "codex"
        executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        executable.chmod(0o755)
        self.environment["PATH"] = str(tool) + os.pathsep + self.environment["PATH"]
        result = self.run_shell('BOOTSTRAP_TARGET="$1" BOOTSTRAP_ENGINE=codex; bootstrap_environment', self.target)
        self.assertEqual(result.returncode, 0, result.stderr)
        text = (self.target / ".auto-loop.env").read_text()
        self.assertIn('ENGINE="codex"', text)
        self.assertIn('CODEX_BIN="' + str(executable) + '"', text)

    def test_full_boundary_flow_prepares_only_and_forwards_distro(self):
        # Real paths/config/state, mock only OS/dependency/manager boundaries.
        body = """
bootstrap_inspect() { BOOTSTRAP_NEED_ENGINE=no; BOOTSTRAP_NEED_NODE=no; BOOTSTRAP_PACKAGES=''; }
uname() { echo Darwin; }
id() { echo 1000; }
systemctl() { return 0; }
codex() { printf 'ENGINE %s\\n' "$*" >> "$TRACE"; return 0; }
python3() {
    case "$1" in */manager.py)
        printf 'MANAGER' >> "$TRACE"; printf ' <%s>' "$@" >> "$TRACE"; printf '\\n' >> "$TRACE"
        if [ "$2" = install ]; then mkdir -p "$BOOTSTRAP_TARGET"; fi
        return 0;;
    esac
    command python3 "$@"
}
bash() {
    case "$1" in */install-wsl-daemon.sh|*/macos/install-daemon.sh) printf 'SERVICE %s\\n' "$2" >> "$TRACE"; return 0;; esac
    command bash "$@"
}
export TRACE="$3"
bootstrap_main --source "$1" --target "$2" --engine codex --distro 'Different Ubuntu' --yes --no-dashboard
"""
        trace = self.base / "trace"
        result = self.run_shell(body, self.source, self.target, trace)
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = trace.read_text()
        self.assertIn("<--distro> <Different Ubuntu>", calls)
        self.assertIn("SERVICE --prepare", calls)
        self.assertIn("<register>", calls)
        self.assertIn("ENGINE login status", calls)
        self.assertNotIn("ENGINE exec", calls)
        self.assertNotIn("SERVICE start", calls)
        self.assertIn("Core installation ready", result.stdout)
        later = next(line.split(": ", 1)[1] for line in result.stdout.splitlines()
                     if line.startswith("Open Dashboard later with: "))
        copied = subprocess.run(
            ["bash", "-c", "python3() { printf '%s\\n' \"$@\"; }\n" + later],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(copied.returncode, 0, copied.stderr)
        self.assertEqual(copied.stdout.splitlines(), [
            str(self.target / "dashboard/server.py"), "--host", "127.0.0.1",
            "--port", "8787", "--open-browser",
        ])
        self.assertIn('ENGINE="codex"', (self.target / ".auto-loop.env").read_text())

    def test_optional_node_failure_keeps_core_and_prepares_service(self):
        body = """
bootstrap_inspect() { BOOTSTRAP_NEED_ENGINE=no; BOOTSTRAP_NEED_NODE=yes; BOOTSTRAP_PACKAGES=''; }
id() { echo 1000; }
systemctl() { return 0; }
codex() { return 0; }
bootstrap_install_node() { return 3; }
python3() {
    case "$1" in */manager.py)
        if [ "$2" = install ]; then mkdir -p "$BOOTSTRAP_TARGET"; fi
        return 0;;
    esac
    command python3 "$@"
}
bash() { printf 'SERVICE %s\\n' "$2"; }
bootstrap_main --source "$1" --target "$2" --engine codex --media --yes --no-dashboard
"""
        result = self.run_shell(body, self.source, self.target)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Optional screenshots are not ready", result.stdout)
        self.assertIn("Core installation ready", result.stdout)
        self.assertIn("SERVICE --prepare", result.stdout)


if __name__ == "__main__":
    unittest.main()

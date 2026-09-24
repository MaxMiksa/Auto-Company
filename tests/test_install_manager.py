"""Real temporary Git/filesystem checks; no models, services or host installs."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("install_manager", ROOT / "scripts/install/manager.py")
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
HEADER = "name\tpath\tlifecycle\tcreated_at_utc\n"
EXAMPLE = "example\tprojects/example\tdistribution\tunknown\n"
USER = "mine\tprojects/mine\tactive\tunknown\n"


class ManifestTests(unittest.TestCase):
    def test_reject_unsafe_paths(self):
        for path in ("../outside", "/outside", "C:/outside", "a\\b", ".git/config", "x/../../y",
                     "logs/a", "memories/consensus.md", ".auto-company/install.json", "a/NUL.txt", "a/../b", "a//b"):
            with self.subTest(path=path), self.assertRaises(M.InstallError):
                M.validate_manifest({"schema": 1, "version": "1.0.0", "source_commit": "a" * 40,
                                     "registry_baseline": HEADER, "files": [{"path": path, "mode": "100644", "sha256": "a" * 64}]})

    def test_registry_preserves_user_rows_and_applies_new_distribution_rows(self):
        old = HEADER + EXAMPLE
        new = HEADER + EXAMPLE.replace("distribution", "published") + "second\tprojects/second\tdistribution\tunknown\n"
        merged = M.merge_registry(old, old + USER, new)
        self.assertIn(USER, merged)
        self.assertIn("published", merged)
        self.assertIn("second\tprojects/second", merged)

    def test_registry_conflicts_on_modified_deleted_or_colliding_rows(self):
        old = HEADER + EXAMPLE
        for local, new in ((HEADER, old), (old.replace("distribution", "edited"), old),
                           (old + USER, old + USER), (old + USER, old + "new\tprojects/mine\tpublished\tunknown\n")):
            with self.subTest(local=local), self.assertRaises(M.InstallError):
                M.merge_registry(old, local, new)

    def test_catalog_has_both_languages(self):
        self.assertIn("安装", M.message("installed", "zh-CN"))
        self.assertIn("Installation", M.message("installed", "en"))

    def test_modes_hashes_and_case_collisions_are_rejected(self):
        base = {"schema": 1, "version": "1.0.0", "source_commit": "a" * 40, "registry_baseline": HEADER,
                "files": [{"path": "projects/registry.tsv", "mode": "100644", "sha256": hashlib.sha256(HEADER.encode()).hexdigest()}]}
        for entry in ({"path": "bad", "mode": "120000", "sha256": "a" * 64},
                      {"path": "bad", "mode": "100644", "sha256": "invalid"},
                      {"path": "PROJECTS/Registry.tsv", "mode": "100644", "sha256": "a" * 64}):
            with self.subTest(entry=entry), self.assertRaises(M.InstallError):
                M.validate_manifest({**base, "files": [*base["files"], entry]})


@unittest.skipUnless(os.name == "posix" and shutil.which("git"), "lifecycle requires POSIX runtime Git (Windows uses WSL)")
class InstallManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="installer space 中文 % ")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.target = self.base / "installed"
        self.home = self.base / "manager"
        self.source = self.payload("source", "1.0.0", "first\r\n", HEADER + EXAMPLE)

    def payload(self, name, version, program, registry):
        root = self.base / name
        root.mkdir()
        data = {"program.py": program.encode(), "package.json": json.dumps({"version": version}).encode(),
                "projects/registry.tsv": registry.encode(), ".claude/skill.md": b"hidden resource\n",
                "projects/example/main.py": b"# bundled example\n", "script.sh": b"#!/bin/sh\nexit 0\n"}
        files = []
        for relative, content in data.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            mode = "100755" if relative.endswith(".sh") else "100644"
            path.chmod(int(mode, 8) & 0o777)
            files.append({"path": relative, "sha256": hashlib.sha256(content).hexdigest(), "mode": mode})
        M.write_json(root / "release-files.json", {"schema": 1, "version": version, "source_commit": ("a" if version == "1.0.0" else "b") * 40,
                                                    "files": files, "registry_baseline": registry})
        return root

    def run_cli(self, *arguments, success=True, executor=None):
        result = subprocess.run([sys.executable, "-B", str(executor or ROOT / "scripts/install/manager.py"), *map(str, arguments), "--json"],
                                capture_output=True, text=True)
        try:
            output = json.loads(result.stdout)
        except ValueError:
            self.fail(result.stdout + result.stderr)
        if success:
            self.assertEqual(result.returncode, 0, output)
        else:
            self.assertNotEqual(result.returncode, 0, output)
        return output

    def install(self):
        return self.run_cli("install", "--source", self.source, "--target", self.target, "--manager-home", self.home,
                            "--engine", "codex", "--language", "zh-CN", "--yes")

    def update(self, source=None, success=True):
        source = source or self.payload("new", "1.1.0", "second\n", HEADER + EXAMPLE)
        return self.run_cli("update", "--root", self.target, "--source", source, "--yes", success=success)

    def test_install_complete_raw_git_baseline_and_no_remote(self):
        result = self.install()
        self.assertEqual(result["language"], "zh-CN")
        meta = M.metadata(self.target)
        self.assertEqual(meta["engine"], "codex")
        self.assertEqual(M.git(self.target, "show", "HEAD:program.py"), b"first\r\n")
        self.assertEqual((self.target / "program.py").read_bytes(), b"first\r\n")
        self.assertIn(b".claude/skill.md", M.git(self.target, "ls-files"))
        self.assertIn(b"projects/example/main.py", M.git(self.target, "ls-files"))
        self.assertEqual(M.git(self.target, "remote"), b"")
        self.assertEqual(M.git(self.target, "config", "core.autocrlf").strip(), b"false")
        self.assertNotIn(b"release-files.json", M.git(self.target, "ls-files"))
        self.assertEqual((self.target / ".auto-company.local").read_text(), "AUTO_COMPANY_LANGUAGE=zh-CN\n")
        self.assertFalse((self.target / M.MARKER).exists())
        self.assertTrue(Path(result["executor"]).is_file())
        self.assertEqual(self.run_cli("doctor", "--root", self.target)["login"], "unverified")

    def test_reject_existing_directory_and_parent_git_is_untouched(self):
        self.target.mkdir()
        sentinel = self.target / "mine.txt"
        sentinel.write_text("keep")
        output = self.run_cli("install", "--source", self.source, "--target", self.target, "--engine", "claude", "--yes", success=False)
        self.assertEqual(output["code"], "existing_target")
        self.assertEqual(sentinel.read_text(), "keep")
        self.target.rmdir() if not list(self.target.iterdir()) else None

    def test_cancelled_install_does_not_create_target_or_manager_home(self):
        result = self.run_cli("install", "--source", self.source, "--target", self.target,
                              "--manager-home", self.home, "--engine", "codex", success=False)
        self.assertEqual(result["code"], "confirmation")
        self.assertFalse(self.target.exists())
        self.assertFalse(self.home.exists())

    def test_parent_git_is_not_used(self):
        M.git(self.base, "init", "--template=", "--initial-branch=parent")
        original = (self.base / ".git/HEAD").read_bytes()
        self.install()
        self.assertEqual((self.base / ".git/HEAD").read_bytes(), original)
        self.assertEqual(M.git(self.base, "ls-files"), b"")
        self.assertEqual(M.git(self.target, "rev-parse", "--show-toplevel").decode().strip(), str(self.target))

    def test_global_hooks_filters_identity_and_signing_are_not_used(self):
        config = self.base / "global"
        sentinel = self.base / "BAD"
        hookdir = self.base / "hooks"
        hookdir.mkdir()
        hook = hookdir / "pre-commit"
        hook.write_text("#!/bin/sh\ntouch '" + str(sentinel) + "'\nexit 1\n")
        hook.chmod(0o755)
        config.write_text("[core]\n hooksPath = " + str(hookdir) + "\n[commit]\n gpgsign = true\n[user]\n name = Existing\n email = existing@example.org\n")
        before = config.read_bytes()
        with mock.patch.dict(os.environ, {"GIT_CONFIG_GLOBAL": str(config)}):
            self.install()
        self.assertFalse(sentinel.exists())
        self.assertEqual(config.read_bytes(), before)

    def test_repeated_install_preserves_product_pin_and_preference(self):
        self.install()
        original = "AUTO_COMPANY_LANGUAGE=zh-CN\nAUTO_COMPANY_PRODUCT_ID=" + "a" * 32 + "\nAUTO_COMPANY_PRODUCT_LANGUAGE=zh-CN\nAUTO_COMPANY_PRODUCT_STATUS=active\n"
        (self.target / ".auto-company.local").write_text(original)
        result = self.run_cli("install", "--source", self.source, "--target", self.target, "--engine", "codex", "--language", "en", "--yes")
        self.assertTrue(result["resumed"])
        self.assertEqual((self.target / ".auto-company.local").read_text(), original)
        self.assertEqual(M.metadata(self.target)["language"], "en")

    def test_resume_rejects_different_saved_distribution(self):
        self.install()
        result = self.run_cli("install", "--source", self.source, "--target", self.target, "--engine", "codex", "--distro", "other", "--yes", success=False)
        self.assertEqual(result["code"], "existing_target")

    def test_registered_launcher_is_backed_up_and_removed_only_when_owned(self):
        self.install()
        launcher = self.base / "launcher"
        launcher.write_text("installation=" + str(self.target))
        self.run_cli("register", "--root", self.target, "--path", launcher, "--kind", "launcher")
        original = launcher.read_bytes()
        launcher.write_text("another installation")
        self.assertEqual(self.run_cli("uninstall", "--root", self.target, "--yes", success=False)["code"], "service_conflict")
        self.assertTrue((self.target / "program.py").exists())
        launcher.write_bytes(original)
        result = self.run_cli("uninstall", "--root", self.target, "--yes")
        self.assertFalse(launcher.exists())
        self.assertEqual((Path(result["transaction"]) / "external/0").read_bytes(), original)
        self.assertFalse((self.target / ".git").exists())

    def test_same_working_directory_different_service_command_is_not_owned(self):
        unit = self.base / "auto-company.service"
        unit.write_text("[Service]\nWorkingDirectory=" + str(self.target) + "\nExecStart=/bin/another-program\n")
        with self.assertRaises(M.InstallError) as raised:
            M.service_owned(unit, "systemd", self.target)
        self.assertEqual(raised.exception.code, "service_conflict")

    def test_update_preserves_data_registry_and_raw_local_baseline(self):
        self.install()
        (self.target / "projects/registry.tsv").write_text(HEADER + EXAMPLE + USER)
        (self.target / "projects/mine").mkdir()
        (self.target / "projects/mine/data").write_bytes(b"product\x00data")
        (self.target / "logs").mkdir()
        (self.target / "logs/cycle.log").write_text("retain")
        preference = (self.target / ".auto-company.local").read_bytes()
        new = self.payload("new", "1.1.0", "second\n", HEADER + EXAMPLE.replace("distribution", "published"))
        result = self.update(new)
        self.assertTrue((Path(result["transaction"]) / "executor/manager.py").is_file())
        self.assertEqual((self.target / "program.py").read_text(), "second\n")
        self.assertEqual((self.target / ".auto-company.local").read_bytes(), preference)
        self.assertEqual((self.target / "projects/mine/data").read_bytes(), b"product\x00data")
        self.assertIn(USER, (self.target / "projects/registry.tsv").read_text())
        self.assertNotIn(USER.encode(), M.git(self.target, "show", "HEAD:projects/registry.tsv"))
        self.assertFalse((self.target / M.MARKER).exists())

    def test_program_modified_missing_new_collision_and_staged_changes_refuse(self):
        self.install()
        old = (self.target / "program.py").read_bytes()
        (self.target / "program.py").write_text("human change")
        self.assertEqual(self.update(success=False)["code"], "conflict")
        self.assertEqual((self.target / "program.py").read_text(), "human change")
        (self.target / "program.py").write_bytes(old)
        M.git(self.target, "update-index", "--force-remove", "program.py")
        self.assertEqual(self.run_cli("update", "--root", self.target, "--source", self.base / "new", "--yes", success=False)["code"], "git_changed")

    def test_active_loop_and_dashboard_refuse_without_signalling(self):
        import fcntl
        self.install()
        source = self.payload("new", "1.1.0", "second\n", HEADER + EXAMPLE)
        with (self.target / ".auto-loop.pid").open("w") as stream:
            stream.write(str(os.getpid()))
            stream.flush()
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.update(source, success=False)["code"], "busy")
        self.assertFalse((self.target / M.MARKER).exists())
        M.write_json(self.target / ".auto-company/writers/dashboard.json", {"schema": 1, "pid": os.getpid(), "host": sys.platform, "kind": "dashboard"})
        self.assertEqual(self.update(source, success=False)["code"], "busy")
        self.assertFalse((self.target / M.MARKER).exists())

    def test_cross_host_writer_and_unknown_config_lock_refuse(self):
        self.install()
        source = self.payload("new", "1.1.0", "second\n", HEADER + EXAMPLE)
        M.write_json(self.target / ".auto-company/writers/dashboard.json", {"pid": 99999999, "host": "unknown-host", "kind": "dashboard"})
        self.assertEqual(self.update(source, success=False)["code"], "busy")
        (self.target / ".auto-company/writers/dashboard.json").unlink()
        (self.target / ".auto-company.local.lock").mkdir()
        self.assertEqual(self.update(source, success=False)["code"], "busy")
        self.assertTrue((self.target / ".auto-company.local.lock").is_dir())

    def test_project_helper_retains_lock_after_parent_releases_it(self):
        import fcntl
        self.install()
        source = self.payload("new", "1.1.0", "second\n", HEADER + EXAMPLE)
        lock_path = self.target / ".auto-company/project-registry.lock"
        with lock_path.open("a+") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            child = subprocess.Popen([sys.executable, "-c", "import sys; sys.stdin.read()"],
                                     stdin=subprocess.PIPE, pass_fds=(stream.fileno(),))
        try:
            inode = lock_path.stat().st_ino
            for operation in ("update", "uninstall"):
                arguments = [operation, "--root", self.target, "--yes"]
                if operation == "update":
                    arguments += ["--source", source]
                self.assertEqual(self.run_cli(*arguments, success=False)["code"], "busy")
                self.assertFalse((self.target / M.MARKER).exists())
                self.assertFalse((self.target / ".auto-company.local.lock").exists())
                self.assertEqual(lock_path.stat().st_ino, inode)
                self.assertEqual((self.target / "program.py").read_bytes(), b"first\r\n")
        finally:
            child.communicate(timeout=10)
        self.assertEqual(self.update(source)["code"], "updated")

    def test_symlink_rejected_before_update_or_copy(self):
        self.install()
        (self.target / "program.py").unlink()
        outside = self.base / "outside"
        outside.write_text("private")
        (self.target / "program.py").symlink_to(outside)
        self.assertEqual(self.update(success=False)["code"], "unsafe_path")
        self.assertEqual(outside.read_text(), "private")

    def test_rollback_preserves_new_user_products_and_registry_rows(self):
        self.install()
        self.update()
        (self.target / "projects/registry.tsv").write_text(HEADER + EXAMPLE + USER)
        result = self.run_cli("rollback", "--root", self.target, "--yes")
        self.assertEqual(result["code"], "rolled_back")
        self.assertEqual((self.target / "program.py").read_bytes(), b"first\r\n")
        self.assertIn(USER, (self.target / "projects/registry.tsv").read_text())
        self.assertEqual(M.metadata(self.target)["version"], "1.0.0")

    def test_rollback_refuses_unknown_data_compatibility(self):
        self.install()
        self.update()
        M.write_json(self.target / ".auto-company/new-runtime-schema.json", {"schema": 900})
        result = self.run_cli("rollback", "--root", self.target, "--yes", success=False)
        self.assertEqual(result["code"], "data_changed")
        self.assertEqual((self.target / "program.py").read_text(), "second\n")

    def test_rollback_rechecks_data_compatibility_after_acquiring_locks(self):
        self.install()
        self.update()
        original = M.stage_executor

        def change_after_preflight(directory):
            executor = original(directory)
            (self.target / ".auto-company.local").write_text("AUTO_COMPANY_LANGUAGE=en\n")
            return executor

        args = M.parser().parse_args(["rollback", "--root", str(self.target), "--yes"])
        with mock.patch.object(M, "stage_executor", side_effect=change_after_preflight):
            with self.assertRaises(M.InstallError) as raised:
                M.stage_operation(args)
        self.assertEqual(raised.exception.code, "data_changed")
        self.assertEqual(M.metadata(self.target)["version"], "1.1.0")
        self.assertFalse((self.target / M.MARKER).exists())

    def test_maintenance_publication_is_complete_and_does_not_replace_owner(self):
        self.install()
        expected = {"schema": 1, "transaction": "first"}
        real_link = M.os.link

        def verify_before_visible(source, target):
            self.assertEqual(json.loads(Path(source).read_bytes()), expected)
            self.assertFalse(Path(target).exists())
            real_link(source, target)
            self.assertEqual(json.loads(Path(target).read_bytes()), expected)

        with mock.patch.object(M.os, "link", side_effect=verify_before_visible):
            M.publish_marker(self.target, expected)
        with self.assertRaises(M.InstallError):
            M.publish_marker(self.target, {"transaction": "other"})
        self.assertEqual(M.read_json(self.target / M.MARKER), expected)
        M.clear_marker(self.target)

    def test_uninstall_preserves_products_logs_config_and_registry_rows(self):
        self.install()
        (self.target / "projects/registry.tsv").write_text(HEADER + EXAMPLE + USER)
        (self.target / "projects/mine").mkdir()
        (self.target / "projects/mine/data").write_text("keep")
        original = (self.target / ".auto-company.local").read_bytes()
        result = self.run_cli("uninstall", "--root", self.target, "--yes")
        self.assertEqual(result["code"], "uninstalled")
        self.assertFalse((self.target / "program.py").exists())
        self.assertEqual((self.target / "projects/mine/data").read_text(), "keep")
        self.assertEqual((self.target / ".auto-company.local").read_bytes(), original)
        self.assertEqual((self.target / "projects/registry.tsv").read_text(), HEADER + USER)
        self.assertEqual(M.metadata(self.target)["status"], "uninstalled")

    def test_disk_space_failure_has_no_target_changes(self):
        self.install()
        args = M.parser().parse_args(["update", "--root", str(self.target), "--source", str(self.source), "--yes"])
        before = (self.target / M.META).read_bytes()
        with mock.patch.object(M.shutil, "disk_usage", return_value=type("Usage", (), {"free": 1})()):
            with self.assertRaises(M.InstallError) as raised:
                M.stage_operation(args)
        self.assertEqual(raised.exception.code, "space")
        self.assertEqual((self.target / M.META).read_bytes(), before)
        self.assertFalse((self.target / M.MARKER).exists())

    def test_failed_health_check_automatically_recovers_program_git_and_registry(self):
        self.install()
        before = (self.target / M.META).read_bytes()
        (self.target / M.REGISTRY).write_text(HEADER + EXAMPLE + USER)
        source = self.payload("bad", "1.1.0", "def broken syntax(\n", HEADER + EXAMPLE)
        result = self.update(source, success=False)
        self.assertEqual(result["code"], "operation_failed")
        self.assertTrue(result["details"]["recovered"])
        self.assertEqual((self.target / M.META).read_bytes(), before)
        self.assertEqual((self.target / "program.py").read_bytes(), b"first\r\n")
        self.assertEqual((self.target / M.REGISTRY).read_text(), HEADER + EXAMPLE + USER)
        self.assertFalse((self.target / M.MARKER).exists())

    def interrupted_transaction(self):
        self.install()
        result = self.update()
        transaction = Path(result["transaction"])
        state = M.read_json(transaction / "transaction.json")
        state["phase"] = "applying"
        M.write_json(transaction / "transaction.json", state)
        M.write_json(self.target / M.MARKER, {"schema": 1, "install_id": state["install_id"], "transaction": str(transaction),
                                            "manager_home": str(self.home), "operation": "update"})
        return transaction, state

    def test_external_recover_survives_removed_installed_programs(self):
        transaction, state = self.interrupted_transaction()
        (self.target / "program.py").unlink()
        (self.target / M.META).write_text("corrupt")
        damaged = self.target / "scripts/core/localization.py"
        damaged.parent.mkdir(parents=True)
        damaged.write_text("def broken syntax(\n")
        self.run_cli("recover", "--root", self.target, "--transaction", transaction, "--yes", executor=transaction / "executor/manager.py")
        self.assertEqual((self.target / "program.py").read_bytes(), b"first\r\n")
        self.assertEqual(M.metadata(self.target)["version"], "1.0.0")
        self.assertFalse((self.target / M.MARKER).exists())

    def test_recovery_after_killed_manager_reclaims_only_proven_owned_lock(self):
        transaction, state = self.interrupted_transaction()
        M.write_json(self.target / ".auto-company.local.lock/installer-owner.json", {"pid": 99999999, "host": sys.platform, "transaction": str(transaction)})
        self.run_cli("recover", "--root", self.target, "--transaction", transaction, "--yes")
        self.assertFalse((self.target / ".auto-company.local.lock").exists())

    def test_changed_backup_refuses_recovery_and_keeps_marker(self):
        transaction, state = self.interrupted_transaction()
        (transaction / "backup/program.py").write_text("changed")
        output = self.run_cli("recover", "--root", self.target, "--yes", success=False)
        self.assertEqual(output["code"], "transaction_invalid")
        self.assertTrue((self.target / M.MARKER).exists())
        self.assertEqual((self.target / "program.py").read_text(), "second\n")

    def test_real_process_kill_mid_update_recovers_from_external_executor(self):
        self.install()
        source = self.payload("new", "1.1.0", "second\n", HEADER + EXAMPLE)
        args = M.parser().parse_args(["update", "--root", str(self.target), "--source", str(source), "--yes"])
        real_run = M.subprocess.run
        staged = []

        def intercept(command, *values, **keywords):
            if "_execute" in command:
                staged.append(Path(command[command.index("--transaction") + 1]))
                return subprocess.CompletedProcess(command, 0, '{"code":"updated"}', "")
            return real_run(command, *values, **keywords)

        with mock.patch.object(M.subprocess, "run", side_effect=intercept):
            M.stage_operation(args)
        transaction = staged[0]
        driver = transaction / "interrupt-test.py"
        driver.write_text(
            "import sys,os,signal,pathlib\n"
            "sys.path.insert(0,sys.argv[1])\nimport manager as m\n"
            "original=m.atomic_bytes\n"
            "def interrupted(path,data,mode=None):\n"
            " original(path,data,mode)\n"
            " if str(path)==sys.argv[2]+'/program.py': os.kill(os.getpid(),signal.SIGKILL)\n"
            "m.atomic_bytes=interrupted\n"
            "args=m.parser().parse_args(['_execute','--root',sys.argv[2],'--transaction',sys.argv[3],'--yes'])\n"
            "m.execute_transaction(args)\n")
        killed = subprocess.run([sys.executable, "-B", str(driver), str(transaction / "executor"), str(self.target), str(transaction)])
        self.assertEqual(killed.returncode, -9)
        self.assertEqual((self.target / "program.py").read_text(), "second\n")
        self.assertTrue((self.target / M.MARKER).exists())
        self.assertEqual(self.run_cli("doctor", "--root", self.target, success=False)["code"], "maintenance")
        self.run_cli("recover", "--root", self.target, "--transaction", transaction, "--yes", executor=transaction / "executor/manager.py")
        self.assertEqual((self.target / "program.py").read_bytes(), b"first\r\n")
        self.assertEqual(M.metadata(self.target)["version"], "1.0.0")
        self.assertFalse((self.target / M.MARKER).exists())

    def test_failed_initial_install_is_identified_and_resumed(self):
        args = M.parser().parse_args(["install", "--source", str(self.source), "--target", str(self.target), "--manager-home", str(self.home),
                                     "--engine", "codex", "--language", "zh-CN", "--yes"])
        with mock.patch.object(M, "baseline", side_effect=OSError("interrupted")):
            with self.assertRaises(OSError):
                M.install(args)
        self.assertTrue((self.target / M.MARKER).exists())
        result = self.install()
        self.assertTrue(result["resumed"])
        self.assertFalse((self.target / M.MARKER).exists())
        self.assertTrue(list(self.home.rglob("partial-git-*")))

    @unittest.skipUnless(sys.platform == "linux" and Path("/dev/shm").is_dir(), "cross-filesystem fixture requires Linux tmpfs")
    def test_cross_filesystem_resume_and_uninstall_keep_verified_git_archive(self):
        with tempfile.TemporaryDirectory(prefix="installer-manager-", dir="/dev/shm") as external:
            if Path(external).stat().st_dev == self.base.stat().st_dev:
                self.skipTest("fixture directories share a filesystem")
            self.home = Path(external) / "manager"
            args = M.parser().parse_args(["install", "--source", str(self.source), "--target", str(self.target),
                                         "--manager-home", str(self.home), "--engine", "codex", "--language", "zh-CN", "--yes"])
            with mock.patch.object(M, "baseline", side_effect=OSError("interrupted")):
                with self.assertRaises(OSError):
                    M.install(args)
            self.install()
            self.assertTrue(list(self.home.rglob("partial-git-*")))
            result = self.run_cli("uninstall", "--root", self.target, "--yes")
            self.assertTrue((Path(result["transaction"]) / "uninstalled-git/HEAD").is_file())
            self.assertFalse((self.target / ".git").exists())


if __name__ == "__main__":
    unittest.main()

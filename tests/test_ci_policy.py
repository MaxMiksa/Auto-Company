"""CI routing and gate regressions, with real Git history and command exits."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts/ci" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CHANGES = load("changes")
GATE = load("gate")


class RoutePolicyTests(unittest.TestCase):
    def selected(self, *paths):
        return {name for name, value in CHANGES.route_paths(paths).items() if value}

    def test_ordinary_documentation_explicitly_skips_all_checks(self):
        self.assertEqual(self.selected("README.md", "README-ZH.md", "docs/windows-setup.md", "docs/images/example.png", "projects/README.md", "LICENSE"), set())
        self.assertEqual(self.selected(), set())

    def test_product_changes_are_independent(self):
        for product in ("tabledelta", "cuecheck", "snapog"):
            with self.subTest(product=product):
                self.assertEqual(self.selected(f"projects/{product}/src/main.js"), {product})
                self.assertEqual(self.selected(f"projects/{product}/README.md"), {product})
        self.assertEqual(self.selected("projects/tabledelta/app.js", "projects/cuecheck/app.js"), {"tabledelta", "cuecheck"})

    def test_ci_policy_and_workflow_changes_select_everything(self):
        for path in (".github/workflows/auto-company-runtime-ci.yml", ".github/workflows/new.yml", ".github/actions/shared/action.yml", "scripts/ci/changes.py", "tests/test_ci_policy.py"):
            with self.subTest(path=path):
                self.assertEqual(self.selected(path), set(CHANGES.ROUTES))

    def test_runtime_and_dashboard_dependency_routing(self):
        for path in ("dashboard/index.html", "dashboard/server.py", "scripts/core/localization.py", "scripts/core/usage_lib.py", "scripts/windows/start-win.ps1", "scripts/wsl/dashboard-wsl.sh", "scripts/macos/start-daemon.sh", "i18n/en/README.md", "tests/browser/smoke.js", "tests/test_dashboard_server.py"):
            with self.subTest(path=path):
                self.assertEqual(self.selected(path), {"runtime", "browser"})
        for path in (".claude/skills/example/SKILL.md", "CLAUDE.md", "PROMPT.md", "Makefile", "projects/registry.tsv", "tests/test_engine_adapters.py", "scripts/check_skill_resources.py"):
            with self.subTest(path=path):
                self.assertEqual(self.selected(path), {"runtime"})

    def test_existing_shell_contract_applies_outside_runtime(self):
        self.assertEqual(self.selected("projects/snapog/check.sh"), {"runtime", "snapog"})
        self.assertEqual(self.selected("docs/example.sh"), {"runtime"})

    def test_optional_product_media_dependencies_and_tests_select_real_browser_checks(self):
        for path in ("scripts/media/package.json", "scripts/media/package-lock.json", "tests/test_product_media.py"):
            with self.subTest(path=path):
                self.assertEqual(self.selected(path), {"runtime", "browser"})

    def test_distribution_sources_and_contracts_select_release_packages(self):
        for path in ("scripts/install/build_release.py", "scripts/install/manager.py", "setup.sh", "setup.ps1", "tests/test_release_packages.py"):
            with self.subTest(path=path):
                self.assertEqual(self.selected(path), {"runtime", "distribution"})
        self.assertEqual(self.selected("docs/install.md"), {"distribution"})
        self.assertEqual(self.selected("i18n/en/docs/install.md"), {"runtime", "browser", "distribution"})
        self.assertEqual(self.selected("package.json"), {"runtime", "distribution"})

    def test_unknown_code_defaults_to_all_and_product_prefix_is_exact(self):
        for path in ("new-build/config.toml", "projects/snapog-copy/code.js", "pyproject.toml"):
            with self.subTest(path=path):
                self.assertEqual(self.selected(path), set(CHANGES.ROUTES))

    def test_release_upload_is_manual_tag_and_existing_draft_only(self):
        workflow = (ROOT / ".github/workflows/distribution.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", workflow)
        self.assertNotIn("pull_request:", workflow)
        self.assertNotIn("push:", workflow)
        self.assertIn("refs/tags/${{ inputs.tag }}", workflow)
        self.assertIn('release.get("draft") is not True', workflow)
        self.assertIn('gh release upload "$RELEASE_TAG"', workflow)
        self.assertIn("actions/workflows/auto-company-runtime-ci.yml/runs", workflow)
        self.assertIn("latest_main_push", workflow)
        self.assertIn("actions: read", workflow)
        self.assertNotIn("--clobber", workflow)
        self.assertNotIn("check-runs", workflow)

    def test_required_gate_runs_new_installer_checks_on_host_platforms(self):
        workflow = (ROOT / ".github/workflows/auto-company-runtime-ci.yml").read_text(encoding="utf-8")
        self.assertGreaterEqual(workflow.count("test_windows_$test.ps1"), 2)
        self.assertIn("'installation'", workflow)
        self.assertEqual(workflow.count("tests/test_install_bootstrap_windows.ps1"), 2)
        for suite in ("tests.test_install_manager", "tests.test_install_bootstrap", "tests.test_installation_state", "tests.test_install_writer_probe"):
            self.assertIn(suite, workflow)
        self.assertIn('"distribution": ("release-packages",)', (ROOT / "scripts/ci/gate.py").read_text(encoding="utf-8"))

    def test_nul_delimited_git_paths_keep_tabs_and_newlines(self):
        paths = [b"docs/spaces and\ttabs.md", b"dashboard/line\nbreak.js", b"projects/snapog/$(touch unsafe).js"]
        result = subprocess.CompletedProcess([], 0, b"\0".join(paths) + b"\0", b"")
        with mock.patch.object(CHANGES, "git", return_value=result) as call:
            found = CHANGES.changed_paths(ROOT, "a" * 40, "b" * 40)
        self.assertEqual(found, [os.fsdecode(path) for path in paths])
        self.assertIn("--no-renames", call.call_args.args)
        self.assertIn("-z", call.call_args.args)
        self.assertEqual(self.selected(*found), {"runtime", "browser", "snapog"})


class GitEventTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.email", "ci-tests@example.invalid")
        self.git("config", "user.name", "CI policy test")
        self.write("README.md")
        self.base = self.commit()

    def git(self, *args):
        result = subprocess.run(["git", "-C", str(self.repo), *args], capture_output=True, check=True)
        return result.stdout.decode("utf-8").strip()

    def write(self, name, content="test\n"):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def commit(self):
        self.git("add", "--all")
        self.git("commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")

    def push(self, before, after):
        return CHANGES.select_routes(self.repo, "push", {"before": before, "after": after})

    def test_push_covers_entire_range_and_deleted_files(self):
        self.write("projects/tabledelta/app.js")
        middle = self.commit()
        self.write("projects/cuecheck/app.js")
        head = self.commit()
        selected, _, paths = self.push(self.base, head)
        self.assertTrue(selected["tabledelta"] and selected["cuecheck"])
        (self.repo / "projects/tabledelta/app.js").unlink()
        deleted = self.commit()
        selected, _, paths = self.push(head, deleted)
        self.assertEqual(paths, ["projects/tabledelta/app.js"])
        self.assertTrue(selected["tabledelta"])
        self.assertNotEqual(middle, head)

    def test_rename_checks_both_the_old_and_new_product(self):
        self.write("projects/tabledelta/app.js")
        before = self.commit()
        (self.repo / "projects/cuecheck").mkdir()
        self.git("mv", "projects/tabledelta/app.js", "projects/cuecheck/app.js")
        selected, _, paths = self.push(before, self.commit())
        self.assertCountEqual(paths, ["projects/tabledelta/app.js", "projects/cuecheck/app.js"])
        self.assertTrue(selected["tabledelta"] and selected["cuecheck"])

    def test_pull_request_excludes_unrelated_base_branch_changes(self):
        self.git("checkout", "-qb", "feature")
        self.write("projects/cuecheck/app.js")
        head = self.commit()
        self.git("checkout", "-qb", "base-advanced", self.base)
        self.write("projects/snapog/app.js")
        base = self.commit()
        selected, _, paths = CHANGES.select_routes(self.repo, "pull_request", {"pull_request": {"base": {"sha": base}, "head": {"sha": head}}})
        self.assertEqual(paths, ["projects/cuecheck/app.js"])
        self.assertTrue(selected["cuecheck"])
        self.assertFalse(selected["snapog"])

    def test_missing_or_zero_commit_conservatively_selects_all(self):
        for before, after in (("f" * 40, self.base), ("0" * 40, self.base), (self.base, "e" * 40)):
            with self.subTest(before=before, after=after):
                selected, reason, paths = self.push(before, after)
                self.assertTrue(all(selected.values()))
                self.assertIn("unavailable", reason)
                self.assertEqual(paths, [])

    def test_unrelated_pull_request_history_conservatively_selects_all(self):
        self.git("checkout", "--orphan", "other")
        self.write("README.md", "unrelated history\n")
        head = self.commit()
        selected, reason, _ = CHANGES.select_routes(self.repo, "pull_request", {"pull_request": {"base": {"sha": self.base}, "head": {"sha": head}}})
        self.assertTrue(all(selected.values()))
        self.assertIn("No pull request merge base", reason)

    def test_malformed_refs_fail_without_executing_git(self):
        with mock.patch.object(CHANGES, "git") as call:
            with self.assertRaises(ValueError):
                self.push("--output=unsafe", self.base)
            call.assert_not_called()

    def test_manual_and_documentation_runs_report_explicit_decisions(self):
        selected, reason, _ = CHANGES.select_routes(self.repo, "workflow_dispatch", {})
        self.assertTrue(all(selected.values()))
        self.assertIn("Manual", reason)
        self.write("README.md", "updated\n")
        selected, reason, _ = self.push(self.base, self.commit())
        self.assertFalse(any(selected.values()))
        self.assertIn("explicitly skipped", reason)

    def test_cli_writes_github_outputs_and_summary(self):
        event = self.repo / "event.json"
        event.write_text("{}", encoding="utf-8")
        output = self.repo / "output"
        summary = self.repo / "summary"
        env = dict(os.environ, GITHUB_EVENT_NAME="workflow_dispatch", GITHUB_EVENT_PATH=str(event), GITHUB_OUTPUT=str(output), GITHUB_STEP_SUMMARY=str(summary))
        result = subprocess.run([sys.executable, str(ROOT / "scripts/ci/changes.py")], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output.read_text().splitlines(), [f"{name}=true" for name in CHANGES.ROUTES])
        self.assertIn("Manual run", summary.read_text())


class GateTests(unittest.TestCase):
    def needs(self, selected=()):
        needs = {"changes": {"result": "success", "outputs": {name: str(name in selected).lower() for name in GATE.JOBS}}}
        for route, jobs in GATE.JOBS.items():
            needs.update({job: {"result": "success" if route in selected else "skipped"} for job in jobs})
        return needs

    def test_documentation_skip_and_selected_success_pass(self):
        for selected in ((), ("runtime",), ("browser", "cuecheck"), tuple(GATE.JOBS)):
            with self.subTest(selected=selected):
                self.assertEqual(GATE.evaluate(self.needs(selected))[0], [])

    def test_every_selected_job_rejects_skipped_failure_and_cancelled(self):
        for route, jobs in GATE.JOBS.items():
            for job in jobs:
                for result in ("skipped", "failure", "cancelled", None):
                    with self.subTest(job=job, result=result):
                        needs = self.needs((route,))
                        needs[job]["result"] = result
                        errors, _ = GATE.evaluate(needs)
                        self.assertTrue(any(f"Selected job {job}" in error for error in errors))

    def test_changes_failure_or_missing_route_fails_closed(self):
        for result in ("failure", "skipped", "cancelled", None):
            needs = self.needs()
            needs["changes"]["result"] = result
            self.assertTrue(GATE.evaluate(needs)[0])
        for value in (None, "", "False", False):
            needs = self.needs()
            needs["changes"]["outputs"]["runtime"] = value
            self.assertTrue(GATE.evaluate(needs)[0])

    def test_missing_jobs_and_unmapped_skips_are_not_authorized(self):
        needs = self.needs()
        del needs["snapog"]
        self.assertTrue(GATE.evaluate(needs)[0])
        needs = self.needs()
        needs["future-job"] = {"result": "skipped"}
        self.assertTrue(GATE.evaluate(needs)[0])

    def test_failure_cannot_be_hidden_by_an_unselected_route(self):
        for result in ("failure", "cancelled"):
            needs = self.needs()
            needs["snapog"]["result"] = result
            self.assertTrue(GATE.evaluate(needs)[0])

    def test_gate_cli_preserves_failure_and_writes_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            summary = Path(directory) / "summary"
            needs = self.needs(("browser",))
            needs["dashboard-browser"]["result"] = "skipped"
            env = dict(os.environ, CI_NEEDS_JSON=json.dumps(needs), GITHUB_STEP_SUMMARY=str(summary))
            result = subprocess.run([sys.executable, str(ROOT / "scripts/ci/gate.py")], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn("**FAILED**", summary.read_text())


class CommandLogTests(unittest.TestCase):
    def run_command(self, directory, *command, label="sample"):
        summary = Path(directory) / "summary"
        env = dict(os.environ, GITHUB_STEP_SUMMARY=str(summary))
        return subprocess.run([sys.executable, str(ROOT / "scripts/ci/run.py"), label, *command], cwd=directory, env=env, capture_output=True)

    def test_stdout_stderr_and_nonzero_exit_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            code = "import sys; print('standard output'); print('standard error', file=sys.stderr); sys.exit(7)"
            result = self.run_command(directory, sys.executable, "-c", code)
            self.assertEqual(result.returncode, 7, result.stderr)
            logged = (Path(directory) / "ci-results/sample.log").read_bytes()
            self.assertIn(b"standard output", logged)
            self.assertIn(b"standard error", logged)
            self.assertIn(logged, result.stdout)
            self.assertIn("**FAIL**", (Path(directory) / "summary").read_text(encoding="utf-8"))

    def test_shell_metacharacters_remain_literal_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            value = "literal; $(echo unsafe) & > escaped.txt"
            result = self.run_command(directory, sys.executable, "-c", "import sys; print(sys.argv[1])", value)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(value.encode(), result.stdout)
            self.assertFalse((Path(directory) / "escaped.txt").exists())
            self.assertIn("**PASS**", (Path(directory) / "summary").read_text(encoding="utf-8"))

    def test_missing_executable_reports_failure_and_keeps_log(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.run_command(directory, "nonexistent-ci-policy-test-command")
            self.assertEqual(result.returncode, 127)
            self.assertIn("Could not launch", (Path(directory) / "ci-results/sample.log").read_text(encoding="utf-8"))

    def test_label_cannot_escape_log_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.run_command(directory, sys.executable, "-c", "pass", label="../outside")
            self.assertEqual(result.returncode, 2)
            self.assertFalse((Path(directory) / "ci-results").exists())


if __name__ == "__main__":
    unittest.main()

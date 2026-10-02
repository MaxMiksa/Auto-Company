"""Behavior regressions for human-owned selection and consensus safeguards."""

import os
import json
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest


SOURCE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE_ROOT / 'tests'))
from isolation_fixture import install as install_fixture_boundary


@unittest.skipIf(os.name == "nt", "POSIX Bash behavior suite; run through WSL on Windows")
class GovernanceFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "framework"
        self.root.mkdir()
        shutil.copytree(SOURCE_ROOT / "scripts/core", self.root / "scripts/core")
        install_fixture_boundary(self.root)
        (self.root / "memories").mkdir()
        shutil.copy2(SOURCE_ROOT / "memories/consensus.template.md", self.root / "memories")
        shutil.copy2(SOURCE_ROOT / ".gitignore", self.root)
        (self.root / "projects").mkdir()
        (self.root / "projects/registry.tsv").write_text(
            "name\tpath\tlifecycle\tcreated_at_utc\n"
        )
        self.git("init", "--initial-branch=main")
        self.git("config", "user.name", "Governance Test")
        self.git("config", "user.email", "governance@example.invalid")
        self.git("add", ".")
        self.git("commit", "-m", "fixture")
        self.env = dict(os.environ, AUTO_COMPANY_ROOT=str(self.root))
        self.consensus = self.root / "memories/consensus.md"

    def git(self, *args, cwd=None):
        return subprocess.run(
            ["git", "-C", str(cwd or self.root), *args],
            check=True, capture_output=True, text=True,
        ).stdout

    def run_script(self, name, *args):
        return subprocess.run(
            ["bash", str(self.root / "scripts/core" / name), *args],
            env=self.env, capture_output=True, text=True,
        )

    def project(self, *args):
        return self.run_script("project.sh", *args)

    def guard(self, *args):
        return self.run_script("consensus-guard.sh", *args)

    def assert_ok(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class GovernanceBoundariesTest(GovernanceFixture):
    def test_new_preserves_human_selection_and_other_local_config_bytes(self):
        config = self.root / ".auto-company.local"
        original = b"# operator settings\r\nACTIVE_PROJECT=projects/existing\r\nCUSTOM=value"
        config.write_bytes(original)
        self.assert_ok(self.project("new", "--name", "candidate"))
        self.assertEqual(config.read_bytes(), original)

    def test_new_does_not_select_on_behalf_of_human(self):
        self.assert_ok(self.project("new", "--name", "candidate"))
        self.assertFalse((self.root / ".auto-company.local").exists())

    def test_select_is_explicit_and_preserves_unrelated_config_bytes(self):
        self.assert_ok(self.project("new", "--name", "candidate"))
        config = self.root / ".auto-company.local"
        config.write_bytes(b"# operator settings\r\nACTIVE_PROJECT=projects/old\r\nCUSTOM=value")
        self.assertNotEqual(self.project("select", "--project", "candidate").returncode, 0)
        self.assert_ok(self.project("select", "--project", "candidate", "--confirm", "SELECT"))
        self.assertEqual(
            config.read_bytes(),
            b"# operator settings\r\nACTIVE_PROJECT=projects/candidate\r\nCUSTOM=value",
        )

    def test_human_operations_are_blocked_from_cycle_context(self):
        self.env["AUTO_COMPANY_CYCLE"] = "1"
        for command, token in (("select", "SELECT"), ("publish", "PUBLISH"), ("migrate-legacy", "MIGRATE")):
            with self.subTest(command=command):
                result = self.project(command, "--confirm", token)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("human-only", result.stderr)

    def test_status_rejects_symlink_project_escape(self):
        (self.root / "projects/escape").symlink_to(self.root, target_is_directory=True)
        self.assertNotEqual(self.project("status", "--project", "escape").returncode, 0)

    def test_migration_rollback_refuses_to_overwrite_later_registrations(self):
        legacy = self.root / "projects/legacy"
        legacy.mkdir()
        (legacy / "user-data.txt").write_text("Existing product data.\n")
        with (self.root / "projects/registry.tsv").open("a") as stream:
            stream.write("legacy\tprojects/legacy\tlegacy-tracked\tunknown\n")
        self.git("add", "projects/registry.tsv")
        self.git("add", "-f", "projects/legacy/user-data.txt")
        self.git("commit", "-m", "legacy product")
        self.assert_ok(self.project("migrate-legacy", "--name", "legacy", "--confirm", "MIGRATE"))
        self.assert_ok(self.project("new", "--name", "later"))
        registry = (self.root / "projects/registry.tsv").read_bytes()
        staged = self.git("diff", "--cached")
        result = self.project("migrate-rollback", "--name", "legacy", "--confirm", "ROLLBACK")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("preserve later registrations", result.stderr)
        self.assertEqual((self.root / "projects/registry.tsv").read_bytes(), registry)
        self.assertEqual(self.git("diff", "--cached"), staged)
        self.assertTrue((legacy / ".git").is_dir())
        self.assertEqual((legacy / "user-data.txt").read_text(), "Existing product data.\n")

    def test_status_rejects_parent_git_repository(self):
        (self.root / "projects/legacy").mkdir()
        result = self.project("status", "--project", "legacy")
        self.assertNotEqual(result.returncode, 0, result.stdout)

    def test_status_does_not_label_an_unselected_candidate_as_active(self):
        self.assert_ok(self.project("new", "--name", "candidate"))
        result = self.project("status", "--project", "candidate")
        self.assert_ok(result)
        self.assertIn("PROJECT=projects/candidate\n", result.stdout)
        self.assertIn("ACTIVE_PROJECT=\n", result.stdout)

    def test_publish_rejects_parent_repository_before_adding_origin(self):
        (self.root / "projects/legacy").mkdir()
        with (self.root / "projects/registry.tsv").open("a") as stream:
            stream.write("legacy\tprojects/legacy\tlegacy-tracked\tunknown\n")
        self.git("add", "projects/registry.tsv")
        self.git("commit", "-m", "legacy registration")
        result = self.project(
            "publish", "--project", "legacy", "--remote-url", str(self.root / "missing.git"),
            "--confirm", "PUBLISH",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("independent", result.stderr)
        self.assertEqual(self.git("remote"), "")

    def test_local_config_is_data_and_accepts_final_line_without_newline(self):
        self.assert_ok(self.project("new", "--name", "candidate"))
        config = self.root / ".auto-company.local"
        config.write_text("ACTIVE_PROJECT=projects/candidate")
        self.assert_ok(self.project("status"))
        marker = self.root / "shell-executed"
        config.write_text(f"ACTIVE_PROJECT=projects/$(touch {marker})\n")
        self.assertNotEqual(self.project("status").returncode, 0)
        self.assertFalse(marker.exists())

    def test_preflight_does_not_repair_deleted_human_heading(self):
        self.assert_ok(self.guard("init"))
        original = self.consensus.read_bytes().replace(b"## Human Overrides", b"## Removed")
        self.consensus.write_bytes(original)
        self.assertEqual(self.guard("preflight", "1").returncode, 42)
        self.assertEqual(self.consensus.read_bytes(), original)

    def test_guard_detects_eof_newline_change(self):
        self.assert_ok(self.guard("init"))
        original = (
            b"# Auto Company Consensus\n## Priority Issues\n- None.\n"
            b"## Human Overrides\n- Keep billing disabled."
        )
        self.consensus.write_bytes(original)
        self.assert_ok(self.guard("begin", "1"))
        self.consensus.write_bytes(original + b"\n")
        self.assertEqual(self.guard("verify", "1").returncode, 42)
        self.assertEqual(self.consensus.read_bytes(), original)

    def test_preflight_rejects_duplicate_priority_sections(self):
        self.assert_ok(self.guard("init"))
        with self.consensus.open("a") as stream:
            stream.write("\n## Priority Issues\n- [ ] P1: must block\n")
        self.assertEqual(self.guard("preflight", "1").returncode, 42)

    def test_preflight_recognizes_markdown_unresolved_p1_list_variants(self):
        self.assert_ok(self.guard("init"))
        for item in ("* [ ] P1: approval", "+ [ ] **P1**: approval", "1. [ ] P1: approval",
                     "- [] P1: approval", "- [?] P1: approval", "- [  ] P1: approval"):
            with self.subTest(item=item):
                self.consensus.write_text(
                    "# Auto Company Consensus\n## Human Overrides\n- Keep.\n"
                    f"## Priority Issues\n{item}\n"
                )
                self.assertEqual(self.guard("preflight", "1").returncode, 41)

    def test_preflight_does_not_recreate_deleted_consensus_after_cycle(self):
        self.assert_ok(self.guard("init"))
        self.assert_ok(self.guard("begin", "1"))
        self.consensus.unlink()
        self.assertEqual(self.guard("preflight", "2").returncode, 42)

    def test_malformed_priority_and_human_headings_are_blocked(self):
        self.assert_ok(self.guard("init"))
        baseline = self.consensus.read_bytes()
        for heading in (b"## Human Overrides", b"## Priority Issues"):
            for variant in (heading + b"  ", heading + b" ##", heading.replace(b"## ", b"##\t")):
                with self.subTest(variant=variant):
                    self.consensus.write_bytes(baseline.replace(heading, variant))
                    self.assertEqual(self.guard("preflight", "1").returncode, 42)

    def test_priority_section_deletion_during_cycle_rolls_back_and_pauses(self):
        self.assert_ok(self.guard("init"))
        baseline = self.consensus.read_bytes()
        self.assert_ok(self.guard("begin", "1"))
        self.consensus.write_bytes(baseline.replace(b"## Priority Issues", b"## Removed"))
        self.assertEqual(self.guard("verify", "1").returncode, 42)
        self.assertEqual(self.consensus.read_bytes(), baseline)

    def test_missing_baseline_pauses_without_claiming_successful_restoration(self):
        self.assert_ok(self.guard("init"))
        self.assert_ok(self.guard("begin", "1"))
        (self.root / "memories/consensus.md.bak").unlink()
        result = self.guard("verify", "1")
        self.assertEqual(result.returncode, 42)
        self.assertIn("restoration failed", result.stderr)
        self.assertNotIn("restored pre-cycle consensus", result.stderr)
        self.assertTrue((self.root / ".auto-loop-paused").exists())

    def test_consensus_symlink_mutation_does_not_overwrite_external_file(self):
        self.assert_ok(self.guard("init"))
        baseline = self.consensus.read_bytes()
        self.assert_ok(self.guard("begin", "1"))
        external = self.root / "external-data"
        external.write_text("Keep this external data.")
        self.consensus.unlink()
        self.consensus.symlink_to(external)
        self.assertEqual(self.guard("verify", "1").returncode, 42)
        self.assertEqual(external.read_text(), "Keep this external data.")
        self.assertFalse(self.consensus.is_symlink())
        self.assertEqual(self.consensus.read_bytes(), baseline)

    def test_cycle_cannot_change_human_selection_or_create_initial_selection(self):
        self.assert_ok(self.guard("init"))
        config = self.root / ".auto-company.local"
        for original in (None, b"# manual\nACTIVE_PROJECT=projects/selected\n"):
            with self.subTest(original=original):
                if original is not None:
                    config.write_bytes(original)
                self.assert_ok(self.guard("begin", "1"))
                config.write_text("ACTIVE_PROJECT=projects/agent-choice\n")
                self.assertEqual(self.guard("verify", "1").returncode, 42)
                if original is None:
                    self.assertFalse(config.exists())
                else:
                    self.assertEqual(config.read_bytes(), original)
                self.assertIn("active_project_mutated", (self.root / ".auto-loop-paused").read_text())
                self.assert_ok(self.guard("close", "1"))

    def test_reset_preserves_human_constraints_pause_and_recoverable_original(self):
        self.assert_ok(self.guard("init"))
        original = self.consensus.read_bytes().replace(b"Not started", b"Yesterday")
        original = original.replace(b"- (none)", b"- Never publish automatically.\r")
        original = original.replace(b"## Priority Issues\n", b"## Priority Issues\n- [ ] P1: approval pending\n")
        self.consensus.write_bytes(original)
        pause = self.root / ".auto-loop-paused"
        pause.write_text("PAUSE_REASON=human_override_mutated\n")
        self.assertNotEqual(self.guard("reset").returncode, 0)
        self.assertEqual(self.consensus.read_bytes(), original)
        self.assert_ok(self.guard("reset", "--confirm", "RESET"))
        self.assertIn(b"Not started", self.consensus.read_bytes())
        self.assertIn(b"- Never publish automatically.\r\n", self.consensus.read_bytes())
        self.assertIn(b"- [ ] P1: approval pending\n", self.consensus.read_bytes())
        self.assertEqual(self.guard("preflight", "1").returncode, 41)
        self.assertEqual(pause.read_text(), "PAUSE_REASON=human_override_mutated\n")
        backups = list((self.root / "memories/resets").glob("*.md"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), original)

    def test_reset_refuses_while_loop_is_alive(self):
        self.assert_ok(self.guard("init"))
        (self.root / ".auto-loop.pid").write_text(f"{os.getpid()}\n")
        result = self.guard("reset", "--confirm", "RESET")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stop the running loop", result.stderr)

    def test_interrupted_recovery_restores_business_and_is_idempotent(self):
        self.assert_ok(self.guard("init"))
        original = self.consensus.read_bytes()
        self.assert_ok(self.guard("begin", "1"))
        self.consensus.write_bytes(original.replace(b"Not started", b"Unfinished business work"))
        self.assertEqual(self.guard("recover").returncode, 42)
        self.assertEqual(self.consensus.read_bytes(), original)
        self.assertFalse((self.root / "memories/.consensus-cycle-pending").exists())
        human_update = original.replace(b"- (none)", b"- Human edited after recovery.")
        self.consensus.write_bytes(human_update)
        self.assert_ok(self.guard("recover"))
        self.assertEqual(self.consensus.read_bytes(), human_update)

    def test_failed_interrupted_recovery_retains_marker_and_blocks_new_baseline(self):
        self.assert_ok(self.guard("init"))
        self.assert_ok(self.guard("begin", "1"))
        (self.root / "memories/consensus.md.bak").unlink()
        self.assertEqual(self.guard("recover").returncode, 42)
        marker = self.root / "memories/.consensus-cycle-pending"
        self.assertTrue(marker.exists())
        self.assertEqual(self.guard("begin", "2").returncode, 42)
        self.assertEqual(marker.read_text(), "1\n")
        self.assertFalse((self.root / "memories/consensus.md.bak").exists())


class PriorityIssuesTest(GovernanceFixture):
    def setUp(self):
        super().setUp()
        self.assert_ok(self.guard("init"))

    def replace_issues(self, issues):
        self.consensus.write_bytes(
            b"# Auto Company Consensus\n## Human Overrides\n- Keep billing disabled.\n"
            b"## Priority Issues\n" + issues + b"\n## Work\n- Before cycle.\n"
        )

    def assert_rejected(self, baseline, rejected):
        result = self.guard("verify", "1")
        self.assertEqual(result.returncode, 42, result.stdout + result.stderr)
        self.assertEqual(self.consensus.read_bytes(), baseline)
        self.assertIn("priority_issue_mutated", (self.root / ".auto-loop-paused").read_text())
        archives = list((self.root / "memories/rejected").glob("*.md"))
        self.assertIn(rejected, [path.read_bytes() for path in archives])
        self.assertFalse((self.root / "memories/snapshots").exists())
        self.assert_ok(self.guard("close", "1"))
        self.assertFalse((self.root / "memories/.consensus-cycle-pending").exists())

    def test_runtime_added_then_checked_p1_is_rejected_and_saved_for_review(self):
        baseline = self.consensus.read_bytes()
        self.assert_ok(self.guard("begin", "1"))
        added = baseline.replace(b"## Priority Issues\n", b"## Priority Issues\n- [ ] P1: approval required\n")
        self.consensus.write_bytes(added)
        rejected = added.replace(b"- [ ] P1:", b"- [x] P1:")
        self.consensus.write_bytes(rejected)
        self.assert_rejected(baseline, rejected)
        self.assertIn("Saved rejected consensus for human review", (self.root / "logs/auto-loop.log").read_text())

    def test_runtime_unresolved_p1_is_saved_then_blocks_next_cycle(self):
        self.assert_ok(self.guard("begin", "1"))
        current = self.consensus.read_bytes().replace(
            b"## Priority Issues\n", b"## Priority Issues\n- [ ] P1: approval required\n"
        )
        self.consensus.write_bytes(current)
        self.assert_ok(self.guard("verify", "1"))
        self.assert_ok(self.guard("finish", "1"))
        self.assertEqual(self.guard("begin", "2").returncode, 41)
        self.assertEqual(self.consensus.read_bytes(), current)
        snapshots = list((self.root / "memories/snapshots").glob("*.md"))
        self.assertEqual([path.read_bytes() for path in snapshots], [current])
        self.assertFalse((self.root / "memories/.consensus-cycle-pending").exists())

    def test_human_closed_prior_p1_persists_and_non_p1_work_can_change(self):
        self.replace_issues(b"- [x] P1: human approved billing\n  Approval: signed by operator.\n- [ ] P2: cosmetic issue\n")
        self.assert_ok(self.guard("begin", "1"))
        updated = self.consensus.read_bytes().replace(b"[ ] P2: cosmetic issue", b"[x] P2: cosmetic issue")
        updated = updated.replace(b"Before cycle.", b"Completed work.")
        self.consensus.write_bytes(updated)
        self.assert_ok(self.guard("finish", "1"))
        self.assertEqual(self.consensus.read_bytes(), updated)

    def test_existing_p1_rewrite_removal_downgrade_and_continuation_change_are_rejected(self):
        issue = b"- [x] P1: operator-approved exception\n  Only for the offline fixture.\n"
        for changed in (
            b"", issue.replace(b"P1:", b"P2:"), issue.replace(b"[x]", b"[ ]"),
            issue.replace(b"operator-approved exception", b"all operations approved"),
            issue.replace(b"  Only for the offline fixture.\n", b""),
            issue.replace(b"offline fixture", b"public service"),
        ):
            with self.subTest(changed=changed):
                self.replace_issues(issue + b"- P2: freely editable\n")
                baseline = self.consensus.read_bytes()
                self.assert_ok(self.guard("begin", "1"))
                rejected = baseline.replace(issue, changed)
                self.consensus.write_bytes(rejected)
                self.assert_rejected(baseline, rejected)

    def test_duplicate_resolved_p1_count_cannot_increase_or_decrease(self):
        issue = b"- [x] P1: human approved exception\n"
        for before, after in ((1, 2), (2, 1)):
            with self.subTest(before=before, after=after):
                self.replace_issues(issue * before)
                baseline = self.consensus.read_bytes()
                self.assert_ok(self.guard("begin", "1"))
                rejected = baseline.replace(issue * before, issue * after)
                self.consensus.write_bytes(rejected)
                self.assert_rejected(baseline, rejected)

    def test_new_p1_checked_markdown_variants_are_rejected(self):
        for item in (b"* [X] **P1**: approval", b"+ [x] __p1__: approval",
                     b"1. [x] P1: approval", b"[x] P1: approval"):
            with self.subTest(item=item):
                self.replace_issues(b"- None.\n")
                baseline = self.consensus.read_bytes()
                self.assert_ok(self.guard("begin", "1"))
                rejected = baseline.replace(b"- None.", item)
                self.consensus.write_bytes(rejected)
                self.assert_rejected(baseline, rejected)

    def test_resolving_reported_p1_after_stopped_cycle_is_accepted(self):
        self.assert_ok(self.guard("begin", "1"))
        self.consensus.write_bytes(self.consensus.read_bytes().replace(
            b"## Priority Issues\n", b"## Priority Issues\n- [ ] P1: human decision required\n"
        ))
        self.assert_ok(self.guard("finish", "1"))
        self.assertEqual(self.guard("begin", "2").returncode, 41)
        self.consensus.write_bytes(self.consensus.read_bytes().replace(b"[ ] P1:", b"[x] P1:"))
        human_baseline = self.consensus.read_bytes()
        self.assert_ok(self.guard("begin", "2"))
        self.assert_ok(self.guard("finish", "2"))
        self.assertEqual(self.consensus.read_bytes(), human_baseline)

    def test_malformed_shadow_governance_heading_cannot_hide_p1(self):
        baseline = self.consensus.read_bytes()
        for heading in (b"### Priority Issues", b"# Priority Issues", b"## priority issues ##"):
            with self.subTest(heading=heading):
                self.consensus.write_bytes(baseline)
                self.assert_ok(self.guard("begin", "1"))
                self.consensus.write_bytes(baseline + heading + b"\n- [x] P1: hidden approval\n")
                self.assertEqual(self.guard("verify", "1").returncode, 42)
                self.assertEqual(self.consensus.read_bytes(), baseline)
                self.assert_ok(self.guard("close", "1"))

    def test_interrupted_p1_mutation_restores_baseline_before_human_update(self):
        self.replace_issues(b"- [x] P1: human-approved historical item\n")
        baseline = self.consensus.read_bytes()
        self.assert_ok(self.guard("begin", "1"))
        self.consensus.write_bytes(baseline.replace(b"P1:", b"P2:"))
        self.assertEqual(self.guard("recover").returncode, 42)
        self.assertEqual(self.consensus.read_bytes(), baseline)
        self.assertFalse((self.root / "memories/.consensus-cycle-pending").exists())
        updated = baseline.replace(b"historical item", b"historical item with human correction")
        self.consensus.write_bytes(updated)
        self.assert_ok(self.guard("recover"))
        self.assert_ok(self.guard("begin", "2"))
        self.assert_ok(self.guard("finish", "2"))
        self.assertEqual(self.consensus.read_bytes(), updated)

    def test_failed_rejected_archive_still_restores_and_pauses(self):
        baseline = self.consensus.read_bytes()
        external = self.root / "external-directory"
        external.mkdir()
        (self.root / "memories/rejected").symlink_to(external, target_is_directory=True)
        self.assert_ok(self.guard("begin", "1"))
        self.consensus.write_bytes(baseline.replace(b"## Priority Issues\n", b"## Priority Issues\n- [x] P1: denied\n"))
        result = self.guard("verify", "1")
        self.assertEqual(result.returncode, 42)
        self.assertEqual(self.consensus.read_bytes(), baseline)
        self.assertEqual(list(external.iterdir()), [])
        self.assertIn("Could not save rejected consensus", result.stderr)
        self.assertIn("priority_issue_mutated", (self.root / ".auto-loop-paused").read_text())

    def test_guard_log_failure_cannot_prevent_p1_restoration(self):
        baseline = self.consensus.read_bytes()
        self.assert_ok(self.guard("begin", "1"))
        log = self.root / "logs/auto-loop.log"
        log.unlink()
        log.mkdir()
        rejected = baseline.replace(b"## Priority Issues\n", b"## Priority Issues\n- [x] P1: unauthorized\n")
        self.consensus.write_bytes(rejected)
        self.assert_rejected(baseline, rejected)


class GovernanceLoopTest(GovernanceFixture):
    def setUp(self):
        super().setUp()
        self.assert_ok(self.guard("init"))
        (self.root / "PROMPT.md").write_text("# Fixture prompt\nUpdate consensus safely.\n")
        self.fake = Path(self.temp.name) / "fake-claude"
        self.fake.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, pathlib, subprocess, sys, time\n"
            "if '--version' in sys.argv:\n"
            "    print('fake-claude 1.0'); sys.exit(0)\n"
            "root = pathlib.Path(os.environ['AUTO_COMPANY_ROOT'])\n"
            "project = os.environ.get('ACTIVE_PROJECT_PATH', '')\n"
            "record = {'cwd': os.getcwd(), 'active': os.environ.get('ACTIVE_PROJECT'), 'project': project, 'argv': sys.argv}\n"
            "with (root / 'calls.jsonl').open('a') as stream: stream.write(json.dumps(record) + '\\n')\n"
            "consensus = root / 'memories/consensus.md'\n"
            "if os.environ.get('FAKE_MODE') == 'interrupt-mutate':\n"
            "    consensus.write_bytes(consensus.read_bytes().replace(b'- (none)', b'- Agent changed the rule.'))\n"
            "    (root / '.auto-company.local').write_text('ACTIVE_PROJECT=projects/agent-choice\\n')\n"
            "    (root / 'mutation-ready.tmp').write_text(str(os.getpid()))\n"
            "    (root / 'mutation-ready.tmp').replace(root / 'mutation-ready')\n"
            "    time.sleep(30)\n"
            "if os.environ.get('FAKE_MODE') in ('p1-checked', 'p1-unresolved'):\n"
            "    consensus.write_bytes(consensus.read_bytes().replace(b'## Priority Issues\\n', b'## Priority Issues\\n- [ ] P1: operator decision required\\n'))\n"
            "    if os.environ['FAKE_MODE'] == 'p1-checked':\n"
            "        consensus.write_bytes(consensus.read_bytes().replace(b'[ ] P1:', b'[x] P1:'))\n"
            "elif os.environ.get('FAKE_MODE') == 'mutate':\n"
            "    consensus.write_bytes(consensus.read_bytes().replace(b'- (none)', b'- Agent changed the rule.'))\n"
            "else:\n"
            "    consensus.write_bytes(consensus.read_bytes().replace(b'Not started', b'Completed fake cycle'))\n"
            "    if project:\n"
            "        (pathlib.Path(project) / 'delivered.txt').write_text('Product-only deliverable.\\n')\n"
            "        subprocess.run(['git', '-C', project, 'add', '.'], check=True)\n"
            "        subprocess.run(['git', '-C', project, 'commit', '-m', 'Fake product milestone'], check=True, stdout=subprocess.DEVNULL)\n"
            "    (root / '.auto-loop-stop').touch()\n"
            "print(json.dumps({'result': 'fake cycle', 'usage': {'input_tokens': 2, 'output_tokens': 3}}))\n"
        )
        self.fake.chmod(0o755)
        self.processes = []
        self.addCleanup(self.stop_processes)

    def stop_processes(self):
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)

    def start_loop(self, mode="success"):
        env = dict(self.env, ENGINE="claude", CLAUDE_BIN=str(self.fake),
                   CLAUDE_PERMISSION_MODE="default", LOOP_INTERVAL="1",
                   CYCLE_TIMEOUT_SECONDS="10", CYCLE_TERM_GRACE_SECONDS="1",
                   CYCLE_KILL_WAIT_SECONDS="1", FAKE_MODE=mode)
        console_path = self.root / f"loop-{len(self.processes)}.console.log"
        with console_path.open("w") as console:
            process = subprocess.Popen(
                ["bash", str(self.root / "scripts/core/auto-loop.sh")],
                env=env, stdout=console, stderr=subprocess.STDOUT,
            )
        self.processes.append(process)
        return process

    def loop_diagnostics(self):
        paths = [*self.root.glob("loop-*.console.log"),
                 self.root / ".auto-loop-state", self.root / "logs/usage.jsonl",
                 self.root / "logs/usage.jsonl.pending"]
        return "\n".join(f"{path.name}:\n{path.read_text()[-8000:]}"
                         for path in paths if path.is_file())

    def wait_until(self, predicate, process):
        deadline = time.monotonic() + 12
        while not predicate():
            if process.poll() is not None:
                self.fail(f"loop exited early: {process.returncode}\n{self.loop_diagnostics()}")
            if time.monotonic() >= deadline:
                self.fail(f"timed out waiting for loop behavior\n{self.loop_diagnostics()}")
            time.sleep(0.05)

    def text_contains(self, path, text):
        return path.exists() and text in path.read_text()

    def wait_for_owner_cleanup(self, engine_pid=None):
        import fcntl

        deadline = time.monotonic() + 8
        with (self.root / ".auto-loop.pid").open("r+") as lock:
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        self.fail("cycle supervisor did not release ownership after loop SIGKILL")
                    time.sleep(0.05)
            if engine_pid is not None:
                self.assertFalse(Path(f"/proc/{engine_pid}").exists(), "old writer outlived its checkout lock")
            fcntl.flock(lock, fcntl.LOCK_UN)

    def test_loop_routes_selected_project_into_real_engine_prompt_and_environment(self):
        self.assert_ok(self.project("new", "--name", "selected"))
        self.assert_ok(self.project("select", "--project", "selected", "--confirm", "SELECT"))
        product = self.root / "projects/selected"
        self.git("config", "user.name", "Product Test", cwd=product)
        self.git("config", "user.email", "product@example.invalid", cwd=product)
        process = self.start_loop()
        self.assertEqual(process.wait(timeout=15), 0)
        calls = [json.loads(line) for line in (self.root / "calls.jsonl").read_text().splitlines()]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["cwd"], str(self.root))
        self.assertEqual(calls[0]["project"], str(product))
        self.assertEqual(calls[0]["active"], "projects/selected")
        self.assertIn(f"Selected product repository: `{product}`", calls[0]["argv"][-1])
        self.assertIn("Dashboard work report (version 2", calls[0]["argv"][-1])
        self.assertEqual(self.git("log", "-1", "--format=%s", cwd=product).strip(), "Fake product milestone")
        self.assertEqual(self.git("ls-files", "--", "projects/selected"), "")
        self.assertEqual(len(list((self.root / "memories/snapshots").glob("*.md"))), 1)

    def test_missing_report_helper_does_not_fail_the_cycle(self):
        (self.root / "scripts/core/cycle_reports.py").unlink()
        process = self.start_loop()
        self.assertEqual(process.wait(timeout=15), 0)
        records = [json.loads(line) for line in (self.root / "logs/usage.jsonl").read_text().splitlines()]
        self.assertEqual(records[-1]["status"], "completed")
        self.assertEqual(len(list((self.root / "memories/snapshots").glob("*.md"))), 1)

    def test_invalid_active_project_prevents_engine_call(self):
        (self.root / ".auto-company.local").write_text("ACTIVE_PROJECT=projects/missing\n")
        process = self.start_loop()
        self.wait_until(lambda: self.text_contains(self.root / ".auto-loop-state", "active_project_invalid"), process)
        self.assertFalse((self.root / "calls.jsonl").exists())
        (self.root / ".auto-loop-stop").touch()
        self.assertEqual(process.wait(timeout=12), 0)

    def test_human_override_pause_survives_process_restart(self):
        process = self.start_loop("mutate")
        self.wait_until(lambda: self.text_contains(self.root / ".auto-loop-state", "human_override_mutated"), process)
        self.wait_until(lambda: (self.root / "logs/usage.jsonl").exists(), process)
        (self.root / ".auto-loop-stop").touch()
        self.assertEqual(process.wait(timeout=12), 0)
        self.assertEqual(len((self.root / "calls.jsonl").read_text().splitlines()), 1)
        self.assertFalse((self.root / "memories/.consensus-cycle-pending").exists())
        self.assertIn("human_override_mutated", (self.root / ".auto-loop-paused").read_text())
        restarted = self.start_loop()
        self.wait_until(lambda: self.text_contains(self.root / ".auto-loop-state", "STATUS=paused"), restarted)
        time.sleep(0.2)
        self.assertEqual(len((self.root / "calls.jsonl").read_text().splitlines()), 1)
        self.assertFalse((self.root / "memories/snapshots").exists())
        (self.root / ".auto-loop-stop").touch()
        self.assertEqual(restarted.wait(timeout=12), 0)

    def test_unresolved_p1_blocks_real_loop_until_human_resolves_it(self):
        self.consensus.write_bytes(self.consensus.read_bytes().replace(
            b"## Priority Issues\n", b"## Priority Issues\n* [ ] P1: human approval\n"
        ))
        process = self.start_loop()
        self.wait_until(lambda: self.text_contains(self.root / ".auto-loop-state", "unresolved_p1"), process)
        self.assertFalse((self.root / "calls.jsonl").exists())
        (self.root / ".auto-loop-stop").touch()
        self.assertEqual(process.wait(timeout=12), 0)
        self.consensus.write_bytes(self.consensus.read_bytes().replace(b"* [ ] P1:", b"* [x] P1:"))
        process = self.start_loop()
        self.assertEqual(process.wait(timeout=15), 0)
        self.assertEqual(len((self.root / "calls.jsonl").read_text().splitlines()), 1)

    def test_runtime_checked_p1_records_failure_and_persistent_pause(self):
        baseline = self.consensus.read_bytes()
        process = self.start_loop("p1-checked")
        self.wait_until(lambda: self.text_contains(self.root / ".auto-loop-state", "priority_issue_mutated"), process)
        self.wait_until(lambda: (self.root / "logs/usage.jsonl").exists(), process)
        (self.root / ".auto-loop-stop").touch()
        self.assertEqual(process.wait(timeout=12), 0)
        self.assertEqual(self.consensus.read_bytes(), baseline)
        self.assertFalse((self.root / "memories/snapshots").exists())
        self.assertEqual(len(list((self.root / "memories/rejected").glob("*.md"))), 1)
        sidecars = [json.loads(path.read_text()) for path in (self.root / "logs").glob("cycle-*.json")]
        sidecars = [record for record in sidecars if "cycle_outcome" in record]
        self.assertEqual(len(sidecars), 1)
        sidecar = sidecars[0]
        self.assertEqual(sidecar["cycle_outcome"], "failure")
        self.assertEqual(sidecar["failure_reason"], "Priority Issues protection violation")
        records = [json.loads(row) for row in (self.root / "logs/usage.jsonl").read_text().splitlines()]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["usage"]["total_tokens"], 5)
        restarted = self.start_loop()
        self.wait_until(lambda: self.text_contains(self.root / ".auto-loop-state", "STATUS=paused"), restarted)
        self.assertEqual(len((self.root / "calls.jsonl").read_text().splitlines()), 1)
        (self.root / ".auto-loop-stop").touch()
        self.assertEqual(restarted.wait(timeout=12), 0)

    def test_runtime_unresolved_p1_stops_next_engine_and_human_can_resolve_after_stop(self):
        process = self.start_loop("p1-unresolved")
        self.wait_until(lambda: self.text_contains(self.root / ".auto-loop-state", "unresolved_p1"), process)
        self.assertEqual(len((self.root / "calls.jsonl").read_text().splitlines()), 1)
        self.assertEqual(len(list((self.root / "memories/snapshots").glob("*.md"))), 1)
        (self.root / ".auto-loop-stop").touch()
        self.assertEqual(process.wait(timeout=12), 0)
        self.consensus.write_bytes(self.consensus.read_bytes().replace(b"[ ] P1:", b"[x] P1:"))
        restarted = self.start_loop()
        self.assertEqual(restarted.wait(timeout=15), 0)
        self.assertIn(b"- [x] P1: operator decision required", self.consensus.read_bytes())
        self.assertEqual(len((self.root / "calls.jsonl").read_text().splitlines()), 2)

    def test_term_during_engine_restores_governance_before_exit(self):
        original = self.consensus.read_bytes()
        process = self.start_loop("interrupt-mutate")
        self.wait_until(lambda: (self.root / "mutation-ready").exists(), process)
        pinned_config = bytes.fromhex(json.loads((self.root / ".auto-company.local.cycle-backup").read_text())["data"])
        process.terminate()
        process.wait(timeout=12)
        self.assertEqual(self.consensus.read_bytes(), original)
        self.assertEqual((self.root / ".auto-company.local").read_bytes(), pinned_config)
        self.assertIn("interrupted_cycle", (self.root / ".auto-loop-paused").read_text())
        self.assertFalse((self.root / "memories/.consensus-cycle-pending").exists())

    def test_sigkill_restart_recovers_pending_governance_before_another_engine(self):
        original = self.consensus.read_bytes()
        process = self.start_loop("interrupt-mutate")
        self.wait_until(lambda: (self.root / "mutation-ready").exists(), process)
        pinned_config = bytes.fromhex(json.loads((self.root / ".auto-company.local.cycle-backup").read_text())["data"])
        engine_pid = int((self.root / "mutation-ready").read_text())
        process.kill()
        process.wait(timeout=3)
        # Kill the fixture engine group to isolate restart governance from process ownership.
        try:
            os.killpg(engine_pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        # Killing the fixture is asynchronous: its supervisor still owns the
        # checkout until it has reaped the process, even after the loop exits.
        self.wait_for_owner_cleanup()
        restarted = self.start_loop()
        self.wait_until(lambda: self.text_contains(self.root / ".auto-loop-state", "STATUS=paused"), restarted)
        self.assertEqual(self.consensus.read_bytes(), original)
        self.assertEqual((self.root / ".auto-company.local").read_bytes(), pinned_config)
        self.assertIn("interrupted_cycle", (self.root / ".auto-loop-paused").read_text())
        self.assertEqual(len((self.root / "calls.jsonl").read_text().splitlines()), 1)
        (self.root / ".auto-loop-stop").touch()
        self.assertEqual(restarted.wait(timeout=12), 0)

    def test_interrupted_invalid_language_is_restored_before_language_validation(self):
        original = self.consensus.read_bytes()
        config = self.root / ".auto-company.local"
        baseline = b"AUTO_COMPANY_LANGUAGE=en\n"
        config.write_bytes(baseline)
        self.assert_ok(self.guard("begin", "1"))
        config.write_bytes(b"AUTO_COMPANY_LANGUAGE=invalid\nnot a configuration line\n")
        self.consensus.write_bytes(original.replace(b'- (none)', b'- Tampered rule.'))
        restarted = self.start_loop()
        self.wait_until(lambda: self.text_contains(self.root / ".auto-loop-state", "STATUS=paused"), restarted)
        self.assertEqual(config.read_bytes(), baseline)
        self.assertEqual(self.consensus.read_bytes(), original)
        self.assertFalse((self.root / "calls.jsonl").exists())
        self.assertFalse((self.root / "memories/.consensus-cycle-pending").exists())
        (self.root / ".auto-loop-stop").touch()
        self.assertEqual(restarted.wait(timeout=12), 0)

    def test_completed_cycle_allows_human_edits_while_stopped(self):
        process = self.start_loop()
        self.assertEqual(process.wait(timeout=15), 0)
        updated = self.consensus.read_bytes().replace(b'- (none)', b'- Human updated the rule.')
        self.consensus.write_bytes(updated)
        restarted = self.start_loop()
        self.assertEqual(restarted.wait(timeout=15), 0)
        self.assertEqual(self.consensus.read_bytes(), updated)
        self.assertFalse((self.root / ".auto-loop-paused").exists())
        self.assertEqual(len((self.root / "calls.jsonl").read_text().splitlines()), 2)

    @unittest.skipUnless(os.path.exists("/proc/self/stat"), "Linux ownership and recovery integration")
    def test_sigkill_owner_cleanup_and_both_recovery_gates_work_together(self):
        original = self.consensus.read_bytes()
        self.env["USAGE_HARD_LIMIT_TOKENS"] = "1"
        process = self.start_loop("interrupt-mutate")
        self.wait_until(lambda: (self.root / "mutation-ready").exists(), process)
        pinned_config = bytes.fromhex(json.loads((self.root / ".auto-company.local.cycle-backup").read_text())["data"])
        engine_pid = int((self.root / "mutation-ready").read_text())
        process.kill()
        process.wait(timeout=3)

        # Unlike the isolated disk-recovery test, do not manually kill the engine.
        # The real supervisor must reap it and release its inherited checkout lock.
        self.wait_for_owner_cleanup(engine_pid)

        restarted = self.start_loop()
        self.wait_until(lambda: self.text_contains(self.root / ".auto-loop-state", "STATUS=paused"), restarted)
        self.wait_until(lambda: (self.root / ".auto-loop-budget-paused").exists(), restarted)
        self.assertEqual(self.consensus.read_bytes(), original)
        self.assertEqual((self.root / ".auto-company.local").read_bytes(), pinned_config)
        self.assertIn("interrupted_cycle", (self.root / ".auto-loop-paused").read_text())
        self.assertIn("budget_unverifiable", (self.root / ".auto-loop-budget-paused").read_text())
        records = [json.loads(row) for row in (self.root / "logs/usage.jsonl").read_text().splitlines()]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["status"], "interrupted")
        self.assertIsNone(records[0]["cost_usd"])
        self.assertIsNone(records[0]["usage"]["total_tokens"])
        self.assertEqual(len((self.root / "calls.jsonl").read_text().splitlines()), 1)
        self.assertFalse((self.root / "memories/.consensus-cycle-pending").exists())
        self.assertFalse((self.root / "logs/usage.jsonl.pending").exists())
        self.wait_until(lambda: self.text_contains(self.root / "logs/auto-loop.log", "Usage governance pause is active"), restarted)
        restarted.terminate()
        self.assertEqual(restarted.wait(timeout=5), 0)

    def test_completed_cycle_closes_governance_before_hard_budget_pause(self):
        self.env["USAGE_HARD_LIMIT_TOKENS"] = "1"
        process = self.start_loop()
        self.assertEqual(process.wait(timeout=15), 0)
        self.assertTrue((self.root / ".auto-loop-budget-paused").exists())
        self.assertFalse((self.root / "memories/.consensus-cycle-pending").exists())
        self.assertFalse((self.root / ".auto-loop-paused").exists())


if __name__ == "__main__":
    unittest.main()

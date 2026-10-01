"""Persistent numbering and explicit source registration, without model calls."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/core"))
import product_identity as products


class ProductIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("alpha", "beta"):
            (self.root / "projects" / name).mkdir(parents=True)

    def reserve(self, attempt, project="projects/alpha", run=1):
        return products.reserve_cycle(self.root, project, attempt, run, "codex", "fixture")

    def complete(self, row):
        products.update_cycle(self.root, row["cycleId"], "dispatching")
        products.update_cycle(self.root, row["cycleId"], "completed")

    def test_read_only_queries_create_nothing(self):
        before = sorted(str(path.relative_to(self.root)) for path in self.root.rglob("*"))
        self.assertIsNone(products.get_identity(self.root, "alpha"))
        self.assertIsNone(products.cycle_projection(self.root, "legacy"))
        self.assertEqual(products.list_cycle_projections(self.root)["cycles"], [])
        self.assertEqual(products.continuation_project(self.root), "")
        self.assertEqual(before, sorted(str(path.relative_to(self.root)) for path in self.root.rglob("*")))

    def test_restart_model_change_and_log_rotation_do_not_reset(self):
        first = self.reserve("run1-1")
        self.complete(first)
        second = self.reserve("run1-2", run=2)
        self.complete(second)
        (self.root / "logs").mkdir()
        (self.root / "logs/old.log").write_text("discarded by retention")
        shutil.rmtree(self.root / "logs")
        third = products.reserve_cycle(self.root, "projects/alpha", "run2-1", 1, "claude", "other")
        self.assertEqual([row["productCycleNumber"] for row in (first, second, third)], [1, 2, 3])
        self.assertEqual([row["sequenceNumber"] for row in (first, second, third)], [1, 2, 3])
        self.assertEqual(third["runCycleNumber"], 1)
        self.assertEqual(first["productId"], third["productId"])
        self.assertEqual(len(products.read_state(self.root)["cycles"]), 3)

    def test_duplicate_start_event_is_atomic_and_idempotent(self):
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(lambda _: self.reserve("same-attempt"), range(8)))
        self.assertEqual(len({row["cycleId"] for row in results}), 1)
        self.assertEqual(products.get_identity(self.root, "alpha")["lastCycleNumber"], 1)
        with self.assertRaises(ValueError):
            self.reserve("same-attempt", project="projects/beta")

    def test_unfinished_reservation_is_not_reused(self):
        first = self.reserve("reserved")
        with self.assertRaises(ValueError):
            self.reserve("second")
        self.assertEqual(products.recover_cycles(self.root)[0]["state"], "not_started")
        self.assertEqual(products.recover_cycles(self.root), [])
        next_row = self.reserve("new-attempt")
        self.assertEqual(next_row["productCycleNumber"], 2)
        self.assertNotEqual(first["cycleId"], next_row["cycleId"])

    def test_dispatch_intent_does_not_claim_provider_execution(self):
        row = self.reserve("uncertain")
        products.update_cycle(self.root, row["cycleId"], "dispatching")
        self.assertEqual(products.recover_cycles(self.root)[0]["state"], "startup_unconfirmed")

    def test_recorded_output_recovers_as_interrupted(self):
        row = self.reserve("interrupted")
        products.update_cycle(self.root, row["cycleId"], "dispatching")
        (self.root / "logs").mkdir()
        (self.root / "logs" / (row["cycleId"] + ".events.jsonl")).write_text('{"type":"thread.started"}\n')
        self.assertEqual(products.recover_cycles(self.root)[0]["state"], "interrupted")

    def test_final_usage_commit_recovers_closed_cycle(self):
        row = self.reserve("closed-before-crash")
        products.update_cycle(self.root, row["cycleId"], "dispatching")
        (self.root / "logs").mkdir()
        (self.root / "logs/usage.jsonl").write_text(json.dumps({"kind": "cycle_usage", "cycle_id": row["cycleId"], "status": "completed"}) + "\n")
        self.assertEqual(products.recover_cycles(self.root)[0]["state"], "completed")

    def test_products_have_independent_sequences(self):
        alpha = self.reserve("alpha-1")
        self.complete(alpha)
        beta = self.reserve("beta-1", project="beta")
        self.complete(beta)
        alpha2 = self.reserve("alpha-2")
        self.assertNotEqual(alpha["productId"], beta["productId"])
        self.assertEqual([alpha["productCycleNumber"], beta["productCycleNumber"], alpha2["productCycleNumber"]], [1, 1, 2])

    def test_explicit_creation_links_exploration_and_continues_product(self):
        exploration = self.reserve("exploration-1", project="")
        products.update_cycle(self.root, exploration["cycleId"], "dispatching")
        product = products.register_project(self.root, "alpha", exploration["cycleId"])
        self.assertEqual(products.continuation_project(self.root), "projects/alpha")
        self.assertEqual(products.cycle_projects(self.root, exploration["cycleId"]), ["projects/alpha"])
        self.assertEqual(products.cycle_projection(self.root, exploration["cycleId"])["linkedProductId"], product["id"])
        with self.assertRaises(ValueError):
            products.register_project(self.root, "beta", exploration["cycleId"])
        self.assertIsNone(products.get_identity(self.root, "beta"))
        self.complete(exploration)
        actual = self.reserve("product-1")
        self.assertEqual(actual["productCycleNumber"], 1)
        self.assertEqual(actual["explorationId"], exploration["identityId"])
        history = products.list_cycle_projections(self.root, product["id"])["cycles"]
        self.assertEqual({row["kind"] for row in history}, {"exploration", "product"})
        self.assertFalse((self.root / ".auto-company.local").exists())

    def test_pagination_and_product_filter_are_exact(self):
        rows = []
        for index in range(5):
            row = self.reserve(f"attempt-{index}")
            self.complete(row)
            rows.append(row)
        first = products.list_cycle_projections(self.root, rows[0]["productId"], limit=2)
        second = products.list_cycle_projections(self.root, rows[0]["productId"], limit=3, before=first["nextBefore"])
        self.assertEqual(len({row["cycleId"] for row in first["cycles"] + second["cycles"]}), 5)
        self.assertEqual(first["total"], 5)
        self.assertIsNone(second["nextBefore"])

    def test_linked_sequence_survives_restart_without_changing_recorded_ids_or_numbers(self):
        explorations = []
        for index in range(3):
            row = self.reserve(f"explore-{index}", project="", run=index + 1)
            if index == 2:
                product = products.register_project(self.root, "alpha", row["cycleId"])
            self.complete(row)
            explorations.append(row)
        first = self.reserve("product-run1", run=1)
        self.complete(first)
        restarted = products.reserve_cycle(self.root, "alpha", "product-run2", 1, "claude", "other")
        self.complete(restarted)
        expected = explorations + [first, restarted]
        state_path = self.root / ".auto-company/product-state.json"
        before = state_path.read_bytes()
        original = json.loads(before)
        all_rows = products.list_cycle_projections(self.root, product["id"], limit=None)
        projected = {row["cycleId"]: row for row in all_rows["cycles"]}
        self.assertEqual(set(projected), {row["cycleId"] for row in expected})
        self.assertEqual([projected[row["cycleId"]]["sequenceNumber"] for row in expected], [1, 2, 3, 4, 5])
        self.assertEqual([projected[row["cycleId"]]["productCycleNumber"] for row in expected], [1, 2, 3, 1, 2])
        self.assertEqual([projected[row["cycleId"]]["runCycleNumber"] for row in expected], [1, 2, 3, 1, 1])
        for cycle_id, row in original["cycles"].items():
            self.assertEqual({key: projected[cycle_id][key] for key in row}, row)
            self.assertEqual(products.cycle_projection(self.root, cycle_id), projected[cycle_id])
        page = products.list_cycle_projections(self.root, product["id"], limit=2)
        remaining = products.list_cycle_projections(self.root, product["id"], limit=None, before=page["nextBefore"])
        self.assertEqual(page["cycles"] + remaining["cycles"], all_rows["cycles"])
        self.assertIsNone(all_rows["nextBefore"])
        self.assertEqual(state_path.read_bytes(), before, "Presentation projection must not rewrite identity history")

    def test_missing_creation_evidence_does_not_invent_a_continuous_offset(self):
        exploration = self.reserve("explore", project="")
        product = products.register_project(self.root, "alpha", exploration["cycleId"])
        self.complete(exploration)
        self.complete(self.reserve("product"))
        state_path = self.root / ".auto-company/product-state.json"
        state = json.loads(state_path.read_text())
        # An older linked ledger can lack the explicit creation-cycle evidence.
        del state["cycles"][exploration["cycleId"]]["createdProductIds"]
        state_path.write_text(json.dumps(state), encoding="utf-8")
        before = state_path.read_bytes()
        rows = products.list_cycle_projections(self.root, product["id"], limit=None)["cycles"]
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row["sequenceNumber"] is None for row in rows))
        self.assertEqual({row["cycleId"] for row in rows}, set(state["cycles"]))
        self.assertEqual(state_path.read_bytes(), before)

    def test_later_exploration_cannot_shift_an_existing_product_creation_boundary(self):
        first = self.reserve("explore-first", project="")
        self.complete(first)
        creation = self.reserve("explore-create", project="", run=2)
        product = products.register_project(self.root, "alpha", creation["cycleId"])
        self.complete(creation)
        product_cycle = self.reserve("product-first")
        self.complete(product_cycle)
        later = self.reserve("explore-later", project="", run=1)
        products.register_project(self.root, "alpha", later["cycleId"])
        self.complete(later)
        self.assertEqual(products.cycle_projection(self.root, product_cycle["cycleId"])["sequenceNumber"], 3)
        self.assertIsNone(products.cycle_projection(self.root, later["cycleId"])["sequenceNumber"])
        self.assertEqual(products.cycle_projection(self.root, creation["cycleId"])["sequenceNumber"], 2)
        self.assertEqual(products.get_identity(self.root, "alpha")["id"], product["id"])

    def test_source_relocation_keeps_identity_and_sequence(self):
        first = self.reserve("before-move")
        self.complete(first)
        (self.root / "projects/alpha").rename(self.root / "projects/renamed")
        products.relocate_identity(self.root, first["productId"], "renamed")
        second = self.reserve("after-move", project="renamed")
        self.assertEqual(second["productId"], first["productId"])
        self.assertEqual(second["productCycleNumber"], 2)

    def test_reused_path_does_not_inherit_old_product(self):
        original = self.reserve("original")
        self.complete(original)
        shutil.rmtree(self.root / "projects/alpha")
        (self.root / "projects/alpha").mkdir()
        self.assertIsNone(products.get_identity(self.root, "alpha"))
        with self.assertRaises(ValueError):
            self.reserve("unregistered-replacement")
        products.register_project(self.root, "alpha")
        replacement = self.reserve("replacement")
        self.assertNotEqual(original["productId"], replacement["productId"])
        self.assertEqual(replacement["productCycleNumber"], 1)

    def test_failed_commit_rolls_back_registration_marker(self):
        original_write = products.atomic_write
        def fail_state(path, data):
            if path.name == "product-state.json":
                raise OSError("test write failure")
            return original_write(path, data)
        with patch.object(products, "atomic_write", side_effect=fail_state):
            with self.assertRaises(OSError):
                products.register_project(self.root, "alpha")
        self.assertIsNone(products.get_identity(self.root, "alpha"))
        self.assertFalse((self.root / "projects/alpha/.auto-company/identity.json").exists())
        self.assertFalse((self.root / ".auto-company/product-state.lock").exists())

    def test_killed_writer_recovers_staged_reservation_without_reusing_number(self):
        code = """
import os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import product_identity as p
original = p.atomic_write
def crash(path, data):
    if path.name == 'product-state.json':
        os._exit(91)
    return original(path, data)
p.atomic_write = crash
p.reserve_cycle(Path(sys.argv[2]), 'projects/alpha', 'crashed-writer', 1)
"""
        crashed = subprocess.run([sys.executable, "-c", code, str(ROOT / "scripts/core"), str(self.root)], capture_output=True)
        self.assertEqual(crashed.returncode, 91)
        self.assertTrue((self.root / ".auto-company/product-state.lock").is_dir())
        restored = subprocess.run([sys.executable, str(ROOT / "scripts/core/product_identity.py"),
                                   "--root", str(self.root), "recover-lock", "--confirm", "STOPPED"], capture_output=True, text=True)
        self.assertEqual(restored.returncode, 0, restored.stderr)
        recovered = products.recover_cycles(self.root)
        self.assertEqual(len(recovered), 1)
        self.assertEqual(recovered[0]["state"], "not_started")
        identity = products.get_identity(self.root, "alpha")
        following = self.reserve("after-crashed-writer")
        self.assertEqual(following["productId"], identity["id"])
        self.assertEqual(following["productCycleNumber"], 2)

    def test_legacy_files_are_never_rewritten_or_reinterpreted(self):
        (self.root / "logs").mkdir()
        legacy = self.root / "logs/cycle-0001-old.json"
        legacy.write_bytes(b'{"cycle_number":1,"result":"legacy"}\r\n')
        before = legacy.read_bytes()
        self.reserve("new-runtime")
        self.assertIsNone(products.cycle_projection(self.root, "cycle-0001-old"))
        self.assertEqual(legacy.read_bytes(), before)

    def test_corrupt_store_fails_closed_instead_of_resetting(self):
        self.reserve("first")
        (self.root / ".auto-company/product-state.json").write_text('{"schemaVersion":1}')
        with self.assertRaises(ValueError):
            self.reserve("second")


if __name__ == "__main__":
    unittest.main()

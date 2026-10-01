"""Showcase translation boundaries over real, read-only journal fixtures."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("showcase_preview", ROOT / "scripts/media/showcase_preview.py")
showcase = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(showcase)
sys.path.insert(0, str(ROOT / "scripts/core"))
import product_identity as products
from cycle_reports import write_report


class ShowcasePreviewTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = "projects/example"
        (self.root / self.project).mkdir(parents=True)
        row = products.reserve_cycle(self.root, self.project, "fixture-attempt", 1, "codex", "fixture-model")
        products.update_cycle(self.root, row["cycleId"], "completed")
        self.cycle_id = row["cycleId"]
        write_report(self.root, self.cycle_id, {
            "title": "Waiting for evidence", "summary": "Checks ran; human review is still pending.",
            "phase": "blocked", "blocker": "Need permission before the next action.", "final": True,
        }, self.project)
        (self.root / "logs/usage.jsonl").write_text(json.dumps({
            "schema_version": 1, "kind": "cycle_usage", "cycle_id": self.cycle_id,
            "cycle_number": 1, "project": self.project, "status": "completed",
            "started_at": "2026-09-19T01:00:00+00:00", "ended_at": "2026-09-19T01:01:00+00:00",
            "usage": {"input_tokens": 9, "output_tokens": 1, "total_tokens": 10},
        }) + "\n", encoding="utf-8")
        source = showcase.JournalSource(self.root, "zh-CN", scope=showcase.ProductScope(
            "product", product_id=row["productId"], project=self.project))
        self.snapshot = source.snapshot()
        self.translation = {
            "productId": row["productId"], "language": "zh-CN", "viewLabel": "经审校的翻译",
            "project": {"displayName": "示例", "description": "真实记录的翻译"},
            "documents": {"projects/example/DELIVERY.md": "交付说明"},
            "cycles": {self.cycle_id: {
                "sourceSha256": showcase.report_digest(self.snapshot["cycles"][0]["workReport"]),
                "title": "等待证据", "summary": "检查已执行，仍待人工审查。", "blocker": "下一步需要授权。",
            }},
        }

    def source(self, translation=None, language="zh-CN"):
        return showcase.ShowcaseSource(self.root, self.project, language,
                                       self.translation if translation is None else translation)

    def test_wrong_product_and_language_are_rejected(self):
        for change in ({"productId": "other-product"}, {"language": "en"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.source({**self.translation, **change})

    def test_missing_or_extra_cycles_are_rejected(self):
        for cycles in ({}, {**self.translation["cycles"], "cycle-extra": self.translation["cycles"][self.cycle_id]}):
            with self.subTest(cycles=list(cycles)), self.assertRaisesRegex(ValueError, "exact recorded history"):
                self.source({**self.translation, "cycles": cycles}).snapshot()

    def test_changed_source_report_is_rejected(self):
        write_report(self.root, self.cycle_id, {
            "title": "Waiting for evidence", "summary": "A new source observation.",
            "phase": "blocked", "blocker": "Need permission before the next action.", "final": True,
        }, self.project)
        with self.assertRaisesRegex(ValueError, "Original report changed"):
            self.source().snapshot()

    def test_text_and_nested_object_types_are_checked(self):
        invalid = [None, [], {**self.translation, "cycles": []}, {**self.translation, "project": None},
                   {**self.translation, "documents": []}, {**self.translation, "viewLabel": 1},
                   {**self.translation, "productId": False}, {**self.translation, "language": None},
                   {**self.translation, "project": {"displayName": []}},
                   {**self.translation, "project": {"description": {}}},
                   {**self.translation, "documents": {"path": None}},
                   {**self.translation, "cycles": {self.cycle_id: None}}]
        for key in ("title", "summary", "blocker", "sourceSha256"):
            for value in (None, False, 1, [], {}):
                item = deepcopy(self.translation)
                item["cycles"][self.cycle_id][key] = value
                invalid.append(item)
        for item in invalid:
            with self.subTest(translation=item), self.assertRaises(ValueError):
                showcase.ShowcaseSource(self.root, self.project, "zh-CN", item)

    def test_a_nonempty_source_blocker_cannot_be_erased(self):
        for empty in ("", " \t\n", "\u3000"):
            translated = deepcopy(self.translation)
            translated["cycles"][self.cycle_id]["blocker"] = empty
            original = deepcopy(self.snapshot)
            with self.subTest(empty=empty), patch.object(showcase.JournalSource, "snapshot", return_value=original):
                with self.assertRaisesRegex(ValueError, "cannot erase"):
                    self.source(translated).snapshot()
                self.assertEqual(original, self.snapshot)

    def test_omitted_blocker_keeps_the_original(self):
        translated = deepcopy(self.translation)
        del translated["cycles"][self.cycle_id]["blocker"]
        actual = self.source(translated).snapshot()
        self.assertEqual(actual["cycles"][0]["workReport"]["blocker"],
                         self.snapshot["cycles"][0]["workReport"]["blocker"])

    def test_success_changes_only_allowlisted_text_and_never_writes_original_objects(self):
        translated = deepcopy(self.translation)
        translated["cycles"][self.cycle_id].update(status="running", phase="shipped", final=False, recorded_at="changed")
        translated["project"].update(id="projects/other", stableId="other")
        source = self.source(translated)
        source_snapshot = deepcopy(self.snapshot)
        artifact = {"path": "projects/example/DELIVERY.md", "id": "delivery", "url": "/original", "sha256": "source"}
        source_snapshot["artifacts"] = [deepcopy(artifact)]
        source_snapshot["cycles"][0]["artifacts"] = [deepcopy(artifact)]
        expected = deepcopy(source_snapshot)
        before_files = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        before_translation = deepcopy(translated)
        with patch.object(showcase.JournalSource, "snapshot", return_value=source_snapshot):
            actual = source.snapshot()
        for key in ("title", "summary", "blocker"):
            expected["cycles"][0]["workReport"][key] = translated["cycles"][self.cycle_id][key]
        expected["project"].update({key: translated["project"][key] for key in ("displayName", "description")})
        expected["sourceName"] = translated["viewLabel"]
        expected["artifacts"][0]["displayLabel"] = "交付说明"
        expected["cycles"][0]["artifacts"][0]["displayLabel"] = "交付说明"
        self.assertEqual(actual, expected)
        self.assertEqual(source_snapshot["cycles"][0]["workReport"], self.snapshot["cycles"][0]["workReport"])
        self.assertNotIn("displayLabel", source_snapshot["artifacts"][0])
        self.assertEqual(translated, before_translation)
        self.assertEqual({path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}, before_files)
        actual["cycles"][0]["workReport"]["blocker"] = "caller mutation"
        self.assertNotEqual(source_snapshot["cycles"][0]["workReport"]["blocker"], "caller mutation")


if __name__ == "__main__":
    unittest.main()

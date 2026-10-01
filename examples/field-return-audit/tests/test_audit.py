import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from audit import audit, demo_request
from fixtures import (INTEGER_BOUNDARIES, attachment, database, geometry, integer_mismatch_payload,
                      integer_parent_payload, integer_payload, mutate, payload, source_hashes, uploaded)


class AuditCase(unittest.TestCase):
    def setUp(self):
        self.request = payload()


    def assert_status(self, expected, request=None):
        result = audit(request or self.request)
        self.assertEqual(result["status"], expected, json.dumps(result, ensure_ascii=False))
        self.assertTrue(result["status_label"])
        for key in ("summary", "changes", "issues", "deferred", "evidence", "limitations", "job_name"):
            self.assertIn(key, result)
        return result


    def assert_rejected(self, request):
        try:
            result = audit(request)
        except (ValueError, TypeError) as error:
            self.assertTrue(str(error))
        else:
            self.assertNotEqual(result["status"], "passed", result)



class CoreFlowTests(AuditCase):
    def test_all_integer_boundaries_keys_nonkeys_and_composite_keys_are_lossless(self):
        result = self.assert_status("passed", integer_payload())
        records = [change for change in result["changes"] if change["table"] == "records"]
        composites = [change for change in result["changes"] if change["table"] == "composite"]
        self.assertEqual(len(records), len(INTEGER_BOUNDARIES))
        self.assertEqual(len(composites), len(INTEGER_BOUNDARIES))
        for changes, key_name in ((records, "uid"), (composites, "record_uid")):
            indexed = {change["key"][key_name]["value"]: change for change in changes}
            self.assertEqual(set(indexed), {str(value) for value in INTEGER_BOUNDARIES})
            for value in INTEGER_BOUNDARIES:
                descriptor = {"type": "integer", "value": str(value)}
                change = indexed[str(value)]
                self.assertEqual(change["key"][key_name], descriptor)
                self.assertEqual(change["before"]["metric"], {"type": "integer", "value": "0"})
                self.assertEqual(change["expected"]["metric"], descriptor)
                self.assertEqual(change["actual"]["metric"], descriptor)

    def test_integer_and_same_character_text_are_distinct_keys_and_values(self):
        result = self.assert_status("passed", integer_payload())
        changes = [change for change in result["changes"] if change["table"] == "typed"]
        large = str(2 ** 53 + 1)
        integer = next(change for change in changes if change["key"]["uid"] == {"type": "integer", "value": large})
        text = next(change for change in changes if change["key"]["uid"] == large)
        self.assertEqual(integer["before"]["metric"], {"type": "integer", "value": large})
        self.assertEqual(integer["expected"]["metric"], large)
        self.assertEqual(text["before"]["metric"], large)
        self.assertEqual(text["expected"]["metric"], {"type": "integer", "value": large})

    def test_integer_to_equal_real_value_is_a_field_change(self):
        result = self.assert_status("passed", integer_payload())
        change = next(change for change in result["changes"]
                      if change["table"] == "typed" and change["key"]["uid"] == {"type": "integer", "value": "1"})
        self.assertIn("metric", change["fields"])
        self.assertEqual(change["before"]["metric"], {"type": "integer", "value": "1"})
        self.assertEqual(change["expected"]["metric"], 1.0)

    def test_integer_to_equal_real_key_requires_delete_and_insert(self):
        request = integer_payload()
        request["field"] = mutate(request["field"], "UPDATE typed SET uid=1.0 WHERE typeof(uid)='integer' AND uid=1")
        request["target"] = copy.deepcopy(request["field"])
        result = self.assert_status("passed", request)
        changes = [change for change in result["changes"] if change["table"] == "typed"]
        self.assertTrue(any(change["operation"] == "delete" and change["key"]["uid"] == {"type": "integer", "value": "1"} for change in changes))
        self.assertTrue(any(change["operation"] == "insert" and change["key"]["uid"] == 1.0 for change in changes))

    def test_large_integer_mismatch_and_relation_orphan_keep_exact_actual(self):
        result = self.assert_status("review", integer_mismatch_payload())
        mismatch = next(issue for issue in result["issues"] if issue["kind"] == "value_mismatch")
        self.assertEqual(mismatch["key"]["uid"], {"type": "integer", "value": str(2 ** 53 + 1)})
        self.assertEqual(mismatch["expected"], {"type": "integer", "value": str(2 ** 53 + 1)})
        self.assertEqual(mismatch["actual"], {"type": "integer", "value": str(2 ** 53)})
        orphan = next(issue for issue in result["issues"] if issue["kind"] == "relation_orphan")
        self.assertEqual(orphan["actual"], {"type": "integer", "value": str(-(2 ** 63))})

    def test_relation_does_not_join_integer_to_same_character_text(self):
        request = integer_payload()
        for role in ("baseline", "field", "target"):
            request[role] = mutate(request[role], "DELETE FROM typed WHERE typeof(uid)='integer' AND uid=?", (2 ** 53 + 1,))
        result = self.assert_status("review", request)
        orphans = [issue for issue in result["issues"] if issue["kind"] == "relation_orphan"]
        self.assertEqual(len(orphans), 1)
        self.assertEqual(orphans[0]["actual"], {"type": "integer", "value": str(2 ** 53 + 1)})

    def test_native_foreign_key_rowid_keeps_64_bit_integer(self):
        request = integer_payload()
        for role in ("baseline", "field", "target"):
            request[role] = mutate(request[role], """
                CREATE TABLE fk_parents(uid INTEGER PRIMARY KEY);
                CREATE TABLE fk_children(uid INTEGER PRIMARY KEY, parent_uid INTEGER REFERENCES fk_parents(uid));
                INSERT INTO fk_children VALUES(9223372036854775807,9007199254740993);
            """)
        request["config"]["tables"].extend([{"name": "fk_parents", "key": ["uid"]}, {"name": "fk_children", "key": ["uid"]}])
        result = self.assert_status("review", request)
        issue = next(issue for issue in result["issues"] if issue["kind"] == "foreign_key")
        self.assertEqual(issue["key"]["rowid"], {"type": "integer", "value": str(2 ** 63 - 1)})

    def test_blob_key_issue_does_not_reencode_descriptor_byte_metadata(self):
        request = integer_parent_payload()
        for role, note in (("baseline", "old"), ("field", "new"), ("target", "wrong")):
            request[role] = mutate(request[role], "DROP TABLE records; CREATE TABLE records(uid BLOB PRIMARY KEY,note TEXT);")
            request[role] = mutate(request[role], "INSERT INTO records VALUES(?,?)", (b"\x00\xff\x01", note))
        result = self.assert_status("review", request)
        expected = {"type": "blob", "bytes": 3, "sha256": hashlib.sha256(b"\x00\xff\x01").hexdigest()}
        self.assertEqual(result["changes"][0]["key"]["uid"], expected)
        self.assertEqual(result["issues"][0]["key"]["uid"], expected)
        self.assertIs(type(result["issues"][0]["key"]["uid"]["bytes"]), int)

    def test_geopackage_geometry_insert_update_delete_and_relations(self):
        result = self.assert_status("passed")
        self.assertTrue(result["changes"])
        text = json.dumps(result["changes"], ensure_ascii=False)
        self.assertIn("s1", text)
        self.assertIn("s2", text)
        self.assertIn("s3", text)


    def test_demo_is_complete_auditable_synthetic_request(self):
        result = audit(demo_request())
        self.assertEqual(result["status"], "passed", result)
        self.assertTrue(result["limitations"])


    def test_plain_sqlite_supported_without_geopackage(self):
        rows = [("s1", "name", "office", geometry(120, 30), "photos/a.jpg")]
        db = database(rows, [("v1", "s1", "note")], gpkg=False)
        for key in ("baseline", "field", "target"):
            self.request[key] = uploaded(key + ".sqlite", db)
        self.assert_status("passed")


    def test_legal_office_parallel_change_of_untouched_column(self):
        self.request["target"] = mutate(self.request["target"], "UPDATE sites SET team='office-parallel' WHERE uid='s1'")
        self.assert_status("passed")


    def test_same_column_office_conflict_needs_review(self):
        self.request["target"] = mutate(self.request["target"], "UPDATE sites SET name='office-conflict' WHERE uid='s1'")
        self.assertTrue(self.assert_status("review")["issues"])


    def test_geometry_wrong_bytes_needs_review(self):
        self.request["target"] = mutate(self.request["target"], "UPDATE sites SET geom=? WHERE uid='s1'", (geometry(0, 0),))
        self.assert_status("review")


    def test_missed_field_delete_needs_review(self):
        self.request["target"] = mutate(self.request["target"], "INSERT INTO sites VALUES('s2','待删除','office',NULL,'photos/b.jpg')")
        self.assert_status("review")


    def test_office_modified_field_deleted_row_needs_review(self):
        self.request["target"] = mutate(self.request["target"], "INSERT INTO sites VALUES('s2','office-changed','office',NULL,'photos/b.jpg')")
        self.assert_status("review")


    def test_office_unrelated_insert_is_legal(self):
        self.request["target"] = mutate(self.request["target"], "INSERT INTO sites VALUES('office-new','办公室新点','office',NULL,NULL)")
        self.assert_status("passed")


    def test_wrong_master_copy_needs_review(self):
        self.request["target"] = copy.deepcopy(self.request["baseline"])
        self.assert_status("review")


    def test_orphan_reference_needs_review(self):
        self.request["target"] = mutate(self.request["target"], "UPDATE visits SET site_uid='missing' WHERE uid='v3'")
        self.assert_status("review")


    def test_invalid_field_reference_not_passed(self):
        self.request["field"] = mutate(self.request["field"], "UPDATE visits SET site_uid='missing' WHERE uid='v3'")
        self.request["target"] = copy.deepcopy(self.request["field"])
        self.assert_status("review")


    def test_key_replacement_requires_delete_and_insert(self):
        self.request["field"] = mutate(self.request["field"], "UPDATE sites SET uid='renamed' WHERE uid='s1'; UPDATE visits SET site_uid='renamed' WHERE site_uid='s1';")
        self.request["target"] = copy.deepcopy(self.request["field"])
        self.assert_status("passed")


    def test_schema_change_does_not_pass(self):
        self.request["field"] = mutate(self.request["field"], "ALTER TABLE sites ADD COLUMN unseen TEXT;")
        self.request["target"] = copy.deepcopy(self.request["field"])
        self.assert_rejected(self.request)


    def test_geopackage_spatial_metadata_change_does_not_pass(self):
        self.request["target"] = mutate(self.request["target"], "UPDATE gpkg_geometry_columns SET srs_id=3857 WHERE table_name='sites'")
        self.assert_rejected(self.request)


    def test_geopackage_srs_definition_change_does_not_pass(self):
        self.request["target"] = mutate(self.request["target"], "UPDATE gpkg_spatial_ref_sys SET definition='different coordinate system' WHERE srs_id=4326")
        self.assert_rejected(self.request)


    def test_geopackage_last_change_timestamp_is_not_a_data_conflict(self):
        self.request["target"] = mutate(self.request["target"], "UPDATE gpkg_contents SET last_change='2026-10-01T12:00:00.000Z'")
        self.assert_status("passed")

    def test_same_geometry_declaration_omitted_in_all_snapshots_does_not_pass(self):
        for role in ("baseline", "field", "target"):
            self.request[role] = mutate(self.request[role], "DELETE FROM gpkg_geometry_columns WHERE table_name='sites'")
        self.assert_rejected(self.request)


    def test_duplicate_configured_key_does_not_pass(self):
        self.request["config"]["tables"][0]["key"] = ["team"]
        self.assert_rejected(self.request)


    def test_null_configured_key_does_not_pass(self):
        self.request["field"] = mutate(self.request["field"], "UPDATE sites SET uid=NULL WHERE uid='s3'")
        self.request["target"] = copy.deepcopy(self.request["field"])
        self.assert_rejected(self.request)



class EvidenceRecoveryTests(AuditCase):
    def test_missing_field_is_unconfirmed(self):
        self.request["field"] = None
        self.assert_status("unconfirmed")


    def test_missing_baseline_is_unconfirmed(self):
        self.request["baseline"] = None
        self.assert_status("unconfirmed")


    def test_missing_target_cannot_pass(self):
        self.request["target"] = None
        self.assert_status("unconfirmed")


    def test_missing_complete_declaration_is_unconfirmed(self):
        self.request["config"].pop("evidence_complete")
        self.assert_status("unconfirmed")


    def test_false_complete_declaration_is_unconfirmed(self):
        self.request["config"]["evidence_complete"] = False
        self.assert_status("unconfirmed")


    def test_truthy_string_is_not_complete_declaration(self):
        self.request["config"]["evidence_complete"] = "false"
        self.assert_rejected(self.request)


    def test_required_missing_attachment_needs_review(self):
        self.request["target_attachments"] = self.request["target_attachments"][:1]
        self.assert_status("review")


    def test_same_attachment_path_wrong_content_needs_review(self):
        self.request["target_attachments"][1] = attachment("photos/c.jpg", b"wrong content")
        self.assert_status("review")


    def test_missing_attachment_deferred_policy_not_passed(self):
        self.request["config"]["attachment_policy"] = "deferred"
        self.request["target_attachments"] = self.request["target_attachments"][:1]
        self.assertTrue(self.assert_status("deferred")["deferred"])


    def test_deferred_policy_does_not_hide_wrong_attachment_content(self):
        self.request["config"]["attachment_policy"] = "deferred"
        self.request["target_attachments"][1] = attachment("photos/c.jpg", b"wrong content")
        self.assert_status("review")


    def test_missing_field_attachment_source_is_unconfirmed(self):
        self.request["field_attachments"] = self.request["field_attachments"][:1]
        self.assert_status("unconfirmed")


    def test_missing_field_attachment_cannot_be_deferred(self):
        self.request["config"]["attachment_policy"] = "deferred"
        self.request["field_attachments"] = []
        self.assert_status("unconfirmed")


    def test_non_sqlite_bytes_rejected(self):
        self.request["field"] = uploaded("invalid.gpkg", b"not sqlite")
        self.assert_rejected(self.request)


    def test_invalid_base64_rejected(self):
        self.request["field"]["data"] = "%%%"
        self.assert_rejected(self.request)


    def test_malformed_configs_rejected(self):
        for config in ([], "bad", {"tables": []}, {"tables": [{"name": "sites", "key": []}]},
                       {"tables": [{"name": "sites", "key": "uid"}]},
                       {"tables": [{"name": "missing", "key": ["uid"]}]}):
            with self.subTest(config=config):
                request = payload()
                request["config"] = config
                self.assert_rejected(request)


    def test_attachment_paths_and_duplicates_rejected(self):
        for path in ("../secret.jpg", "/etc/passwd", "C:\\secret.jpg", "photos/../../secret.jpg", "photos\\a.jpg", ""):
            with self.subTest(path=path):
                request = payload()
                request["target_attachments"].append(attachment(path, b"synthetic"))
                self.assert_rejected(request)
        self.request["target_attachments"].append(attachment("photos/a.jpg", b"second different content"))
        self.assert_rejected(self.request)


    def test_config_identifiers_do_not_execute_sql(self):
        self.request["config"]["tables"][0]["name"] = "sites; DROP TABLE visits; --"
        self.assert_rejected(self.request)


    def test_source_requests_and_input_hashes_remain_unchanged(self):
        original = copy.deepcopy(self.request)
        hashes = source_hashes(self.request)
        self.assert_status("passed")
        self.assertEqual(self.request, original)
        self.assertEqual(source_hashes(self.request), hashes)
        result_text = json.dumps(audit(self.request), ensure_ascii=False)
        for digest in hashes.values():
            self.assertIn(digest, result_text)


    def test_combined_upload_size_is_bounded(self):
        with patch("audit.MAX_BYTES", 32):
            with self.assertRaises(ValueError):
                audit(self.request)


    def test_database_row_count_is_bounded(self):
        with patch("audit.MAX_ROWS", 1):
            with self.assertRaises(ValueError):
                audit(self.request)


    def test_database_table_count_is_bounded(self):
        with patch("audit.MAX_TABLES", 1):
            with self.assertRaises(ValueError):
                audit(self.request)


    def test_database_column_count_is_bounded(self):
        with patch("audit.MAX_COLUMNS", 2):
            with self.assertRaises(ValueError):
                audit(self.request)


    def test_success_still_exposes_evidence_limitations(self):
        result = self.assert_status("passed")
        self.assertTrue(result["limitations"])
        self.assertTrue(result["evidence"])

    def test_report_preserves_actual_policy_and_configuration(self):
        result = self.assert_status("passed")
        self.assertEqual(result["config"]["attachment_policy"], "required")
        self.assertEqual(result["config"]["relations"], self.request["config"]["relations"])
        self.assertEqual(result["evidence"]["configuration"]["attachment_columns"], self.request["config"]["attachment_columns"])




if __name__ == "__main__":
    unittest.main()

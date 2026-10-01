import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import server
from fixtures import INTEGER_BOUNDARIES, integer_mismatch_payload, integer_parent_payload, integer_payload, payload


class BrowserFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.create_server(host="127.0.0.1", port=0)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = "http://127.0.0.1:" + str(cls.httpd.server_address[1])
        cls.temporary = tempfile.TemporaryDirectory(prefix="field-return-browser-fixtures-")
        folder = Path(cls.temporary.name)
        request = payload()
        directories = {}
        for role in ("field", "target"):
            directory = folder / (role + "-attachments")
            for attachment in request[role + "_attachments"]:
                location = directory / attachment["path"]
                location.parent.mkdir(parents=True, exist_ok=True)
                location.write_bytes(base64.b64decode(attachment["data"]))
            directories[role + "_directory"] = str(directory)
        cls.fixture_path = folder / "request.json"
        cls.fixture_path.write_text(json.dumps({"request": request, **directories,
                                               "integer_request": integer_payload(),
                                               "integer_mismatch_request": integer_mismatch_payload(),
                                               "integer_parent_request": integer_parent_payload(),
                                               "integer_boundaries": [str(value) for value in INTEGER_BOUNDARIES]}), encoding="utf-8")
        cls.artifacts = ROOT / ".auto-company" / "browser-evidence" / "integer-precision-20261002-retry1"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=5)
        cls.temporary.cleanup()

    def scenario(self, name):
        result = subprocess.run([
            "node", str(ROOT / "tests" / "browser_checks.cjs"), name,
            self.base_url, str(self.fixture_path), str(self.artifacts),
        ], cwd=ROOT, capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout + "\n" + result.stderr)
        self.assertIn('"outcome":"passed"', result.stdout)

    def test_demo_evidence_declaration_and_three_exports(self):
        self.scenario("demo-export")

    def test_changed_inputs_invalidate_old_result(self):
        self.scenario("stale-result")

    def test_attachment_required_deferred_and_recovered(self):
        self.scenario("attachment-recovery")

    def test_real_file_and_directory_upload_error_recovery(self):
        self.scenario("upload-roundtrip")

    def test_request_retry_xss_render_and_standalone_report(self):
        self.scenario("retry-and-xss")

    def test_narrow_viewport_and_keyboard_core_flow(self):
        self.scenario("narrow-keyboard")

    def test_real_integer_upload_ui_and_all_downloads_remain_lossless(self):
        self.scenario("integer-precision")


if __name__ == "__main__":
    unittest.main()
